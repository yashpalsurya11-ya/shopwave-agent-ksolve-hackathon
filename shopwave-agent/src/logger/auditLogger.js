/**
 * auditLogger.js — Structured JSON audit logging for ShopWave agent
 *
 * Writes one entry per ticket to outputs/audit_log.json.
 * Conforms to the exact schema specified in the hackathon brief.
 * Thread-safe: uses append-within-array approach to avoid race conditions
 * when processing tickets concurrently with Promise.all().
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUTPUTS_DIR = join(__dirname, '..', '..', 'outputs');
const AUDIT_LOG_PATH = join(OUTPUTS_DIR, 'audit_log.json');

// Ensure outputs directory exists
try {
  if (!existsSync(OUTPUTS_DIR)) {
    mkdirSync(OUTPUTS_DIR, { recursive: true });
  }
} catch (e) {
  console.warn(`[AuditLogger] Warning: Could not create outputs directory (likely read-only FS): ${e.message}`);
}

/**
 * Transforms a raw reactLoop result into the canonical audit log entry.
 *
 * @param {Object} ticket — original ticket object
 * @param {Object} result — result from reactLoop()
 * @param {Error|null} error — caught error (if ticket processing failed entirely)
 * @returns {Object} — audit log entry conforming to the spec schema
 */
export function buildAuditEntry(ticket, result, error = null) {
  if (error) {
    // Catastrophic failure — ticket processing crashed outside reactLoop
    return {
      ticket_id: ticket?.ticket_id || 'UNKNOWN',
      customer_email: ticket?.customer_email || 'UNKNOWN',
      subject: ticket?.subject || 'UNKNOWN',
      status: 'failed',
      confidence_score: 0,
      resolution_type: 'failed',
      tool_calls: [],
      reasoning_trace: 'Ticket processing crashed before ReAct loop could execute',
      final_reply: null,
      processing_time_ms: 0,
      error_encountered: error.message,
      timestamp: new Date().toISOString(),
      llm_provider: process.env.LLM_PROVIDER || 'openai',
    };
  }

  // Normal result from reactLoop
  const toolCalls = (result.toolCallLog || []).map((tc) => ({
    tool: tc.tool,
    input: tc.input,
    output: tc.output,
    duration_ms: tc.duration_ms,
    success: tc.success,
    retry_count: tc.retry_count,
    error: tc.error || null,
    step: tc.step,
  }));

  return {
    ticket_id: result.ticket_id || ticket.ticket_id,
    customer_email: ticket.customer_email,
    subject: ticket.subject,
    status: result.status || 'resolved',
    confidence_score: result.confidence ?? 0,
    resolution_type: result.resolution_type || 'reply_sent',
    tool_calls: toolCalls,
    reasoning_trace: result.reasoning_trace || result.thought || '',
    final_reply: result.finalAnswer || null,
    processing_time_ms: result.processing_time_ms || 0,
    error_encountered: result.error || null,
    timestamp: new Date().toISOString(),
    llm_provider: process.env.LLM_PROVIDER || 'openai',
    ...(result.escalation_context && { escalation_context: result.escalation_context }),
  };
}

/**
 * Writes the complete audit log for all processed tickets.
 * Overwrites the file each time /resolve/all is called.
 * Each entry includes the full tool call chain and reasoning trace.
 *
 * @param {Array<Object>} entries — array of audit log entries (from buildAuditEntry)
 */
export function writeAuditLog(entries) {
  const log = {
    run_id: `RUN-${Date.now()}`,
    run_timestamp: new Date().toISOString(),
    llm_provider: process.env.LLM_PROVIDER || 'openai',
    total_tickets: entries.length,
    resolved_count: entries.filter((e) => e.status === 'resolved').length,
    escalated_count: entries.filter((e) => e.status === 'escalated').length,
    failed_count: entries.filter((e) => e.status === 'failed').length,
    entries,
  };

  writeFileSync(AUDIT_LOG_PATH, JSON.stringify(log, null, 2), 'utf-8');
  console.log(
    `\n[AuditLogger] ✅ Wrote ${entries.length} entries to ${AUDIT_LOG_PATH}`
  );

  // Summary to stdout
  console.log(`[AuditLogger] Summary:`);
  console.log(`  ✅ Resolved:  ${log.resolved_count}`);
  console.log(`  ⚠️  Escalated: ${log.escalated_count}`);
  console.log(`  ❌ Failed:    ${log.failed_count}`);

  return AUDIT_LOG_PATH;
}

/**
 * Reads the current audit log (for GET /audit endpoint).
 * @returns {Object} the full audit log or empty structure
 */
export function readAuditLog() {
  if (!existsSync(AUDIT_LOG_PATH)) {
    return { message: 'No audit log found. Run POST /resolve/all first.' };
  }
  try {
    return JSON.parse(readFileSync(AUDIT_LOG_PATH, 'utf-8'));
  } catch (err) {
    return { error: `Failed to read audit log: ${err.message}` };
  }
}
