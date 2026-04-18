/**
 * index.js — ShopWave Autonomous Support Resolution Agent
 * Express server with /resolve, /resolve/all, /audit, and /health endpoints.
 *
 * Concurrency: POST /resolve/all uses Promise.all() to process all 20 tickets
 * in parallel. Per-ticket errors are caught individually — one bad ticket
 * NEVER stops others.
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { reactLoop } from './agent/reactLoop.js';
import { buildAuditEntry, writeAuditLog, readAuditLog } from './logger/auditLogger.js';
import { getCache, setCache } from './lib/redis.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, 'data');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(join(__dirname, '..', 'public')));

// Request logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── Data Loader ───────────────────────────────────────────────────────────────

async function loadTickets() {
  const path = join(DATA_DIR, 'tickets.json');
  if (!existsSync(path)) {
    throw new Error(`tickets.json not found at ${path}`);
  }
  const data = await readFile(path, 'utf-8');
  return JSON.parse(data);
}

// ── Core ticket resolver ─────────────────────────────────────────────────────

/**
 * Resolves a single ticket through the ReAct loop.
 * Returns an audit log entry regardless of success or failure.
 *
 * @param {Object} ticket
 * @param {boolean} bypassCache
 * @returns {Promise<Object>} audit entry
 */
async function resolveTicket(ticket, bypassCache = false) {
  const start = Date.now();
  try {
    console.log(`\n[Resolver] Processing ticket: ${ticket.ticket_id}`);

    // --- UPSTASH REDIS HYBRID CACHE ---
    if (!bypassCache) {
      // 1. Exact Match via Ticket ID
      const ticketKey = `ticket:${ticket.ticket_id}`;
      const exactCache = await getCache(ticketKey);
      
      if (exactCache) {
        console.log(`[ReAct] ⚡ Cache HIT (ticket_id): Exact match for ${ticket.ticket_id}`);
        // ensure processing time covers cache hit duration (~10-50ms)
        exactCache.processing_time_ms = Date.now() - start;
        return buildAuditEntry(ticket, exactCache);
      }

      // 2. Semantic Match via Subject
      if (ticket.subject) {
        const normalizedSubject = ticket.subject.toLowerCase().trim();
        const subjectKey = `subject:${normalizedSubject}`;
        const semanticCache = await getCache(subjectKey);

        if (semanticCache) {
          console.log(`[ReAct] ⚡ Cache HIT (subject): Semantic match for "${normalizedSubject}"`);
          // override specific details for the current ticket
          const result = {
            ...semanticCache,
            ticket_id: ticket.ticket_id,
            processing_time_ms: Date.now() - start
          };
          return buildAuditEntry(ticket, result);
        }
      }
    }
    
    console.log(`[ReAct] ⏱ Cache MISS → calling Gemini AI Agent...`);
    // --- END CACHE ---

    const result = await reactLoop(ticket);

    // --- SAVE TO UPSTASH ---
    if (result && result.status === 'resolved') {
      const ticketKey = `ticket:${ticket.ticket_id}`;
      // TTL: 24 hours (86400 seconds)
      await setCache(ticketKey, result, 86400); 

      if (ticket.subject) {
        const normalizedSubject = ticket.subject.toLowerCase().trim();
        const subjectKey = `subject:${normalizedSubject}`;
        await setCache(subjectKey, result, 86400);
      }
    }

    return buildAuditEntry(ticket, result);
  } catch (err) {
    console.error(`[Resolver] ❌ Ticket ${ticket.ticket_id} failed: ${err.message}`);
    return buildAuditEntry(ticket, null, err);
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /health — Health check endpoint
 */
app.get('/health', (req, res) => {
  const provider = 'gemini';
  const hasKey = !!process.env.GEMINI_API_KEY;

  res.json({
    status: 'ok',
    service: 'ShopWave Support Resolution Agent',
    version: '1.0.0',
    llm_provider: provider,
    api_key_configured: hasKey,
    timestamp: new Date().toISOString(),
    endpoints: {
      'POST /resolve': 'Resolve a single ticket',
      'POST /resolve/all': 'Resolve all 20 tickets concurrently',
      'GET /audit': 'Read the latest audit log',
      'GET /tickets': 'List all tickets',
      'GET /health': 'Health check',
    },
  });
});

/**
 * GET /tickets — List all available tickets
 */
app.get('/tickets', async (req, res) => {
  try {
    const tickets = await loadTickets();
    res.json({
      count: tickets.length,
      tickets: tickets.map((t) => ({
        ticket_id: t.ticket_id,
        customer_email: t.customer_email,
        subject: t.subject,
        tier: t.tier,
        created_at: t.created_at,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /resolve — Resolve a single ticket
 *
 * Body: { ticket_id: "TKT-001" } OR pass a full ticket object
 */
app.post('/resolve', async (req, res) => {
  const startTime = Date.now();

  try {
    let ticket = req.body;

    // If only ticket_id provided, look it up
    if (req.body.ticket_id && !req.body.customer_email) {
      const tickets = await loadTickets();
      ticket = tickets.find((t) => t.ticket_id === req.body.ticket_id);
      if (!ticket) {
        return res.status(404).json({
          error: `Ticket "${req.body.ticket_id}" not found`,
        });
      }
    }

    if (!ticket || !ticket.ticket_id) {
      return res.status(400).json({
        error: 'Request body must include ticket_id or a full ticket object',
      });
    }

    console.log(`\n[API] POST /resolve — Ticket: ${ticket.ticket_id}`);
    const auditEntry = await resolveTicket(ticket);

    res.json({
      success: true,
      processing_time_ms: Date.now() - startTime,
      result: auditEntry,
    });
  } catch (err) {
    console.error(`[API] /resolve error: ${err.message}`);
    res.status(500).json({
      error: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
  }
});

/**
 * POST /resolve/all — Resolve ALL tickets concurrently
 *
 * Uses Promise.all() for parallel processing.
 * Per-ticket errors are caught individually — one failure never stops others.
 */
app.post('/resolve/all', async (req, res) => {
  const startTime = Date.now();

  try {
    const tickets = await loadTickets();
    // ── CONTROLLED BATCH CONCURRENCY ──────────────────────────────────────
    const results = [];
    const provider = process.env.LLM_PROVIDER || 'gemini';
    const concurrencyVal = parseInt(process.env.CONCURRENCY_LIMIT || '3'); // Hackathon specific concurrency
    
    console.log(`[Queue] Starting concurrent processing format for ${tickets.length} tickets`);
    console.log(`[Queue] Batch concurrency limit dynamically set to: ${concurrencyVal}`);
    
    for (let i = 0; i < tickets.length; i += concurrencyVal) {
      const batch = tickets.slice(i, i + concurrencyVal);
      const batchNumber = Math.floor(i / concurrencyVal) + 1;
      const totalBatches = Math.ceil(tickets.length / concurrencyVal);
      
      console.log(`\n[Queue] 🏃 Processing Batch ${batchNumber}/${totalBatches} (${batch.length} tickets concurrently)`);
      
      const batchPromises = batch.map(ticket => {
        return resolveTicket(ticket).catch((err) => {
          console.error(`[Queue] Ticket ${ticket.ticket_id} failed: ${err.message}`);
          return buildAuditEntry(ticket, null, err);
        });
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      if (i + concurrencyVal < tickets.length) {
        // Log dynamic cooling down message
        console.log(`[Queue] 🧊 Cooling down batch for ${provider} rate limits...`);
        // Additional safe 2000ms delay between batches
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    // Write full audit log
    const auditPath = writeAuditLog(results);
    const totalTime = Date.now() - startTime;

    const summary = {
      processed: results.length,
      resolved: results.filter((r) => r.status === 'resolved').length,
      escalated: results.filter((r) => r.status === 'escalated').length,
      failed: results.filter((r) => r.status === 'failed').length,
      total_time_ms: totalTime,
      avg_time_per_ticket_ms: Math.round(totalTime / results.length),
      audit_log: auditPath,
      results,
    };

    console.log(
      `\n[API] ✅ /resolve/all complete in ${totalTime}ms — ` +
      `${summary.resolved} resolved, ${summary.escalated} escalated, ${summary.failed} failed`
    );

    res.json(summary);
  } catch (err) {
    console.error(`[API] /resolve/all fatal error: ${err.message}`);
    res.status(500).json({
      error: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
  }
});

/**
 * GET /audit — Read the latest audit log
 */
app.get('/audit', (req, res) => {
  const log = readAuditLog();
  res.json(log);
});

// ── 404 handler ───────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    available: ['GET /health', 'GET /tickets', 'POST /resolve', 'POST /resolve/all', 'GET /audit'],
  });
});

// ── Global error handler ──────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error(`[Global Error] ${err.message}`);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ── Server startup ────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('\n' + '═'.repeat(60));
  console.log('  ShopWave Autonomous Support Resolution Agent');
  console.log('  Production-Grade ReAct Agent — Hackathon 2026');
  console.log('═'.repeat(60));
  console.log(`  🚀 Server running on http://localhost:${PORT}`);
  console.log(`  🤖 LLM Provider: gemini`);
  const providerKey = process.env.GEMINI_API_KEY;

  console.log(`  🔑 API Key: ${providerKey ? '✅ configured' : '❌ MISSING'}`);
  console.log('─'.repeat(60));
  console.log('  Endpoints:');
  console.log('    GET  /health        → Health check');
  console.log('    GET  /tickets       → List all tickets');
  console.log('    POST /resolve       → Resolve single ticket');
  console.log('    POST /resolve/all   → Resolve ALL 20 tickets');
  console.log('    GET  /audit         → View audit log');
  console.log('═'.repeat(60) + '\n');
});

export default app;
