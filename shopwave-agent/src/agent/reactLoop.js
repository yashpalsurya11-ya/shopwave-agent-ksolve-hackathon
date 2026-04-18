/**
 * reactLoop.js — Custom ReAct (Reason → Act → Observe) agent loop
 *
 * Implements the exact loop prescribed in the spec:
 *   1. REASON: Call LLM with ticket + history → get JSON action
 *   2. ACT: Execute the chosen tool (with safety guard + retry)
 *   3. OBSERVE: Append result to history
 *   Repeat until FINISH or maxSteps reached.
 *
 * Fault tolerance:
 *   - Exponential backoff retry: 500ms → 1000ms → 2000ms (max 3 attempts)
 *   - Safety guard blocks illegal actions before execution
 *   - Low confidence (<threshold) auto-escalates
 *   - maxSteps exceeded → auto-escalate with full context
 */

import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { buildPrompt, parseReActResponse } from './prompts.js';
import { assertActionSafe } from './safetyGuard.js';
import { TOOL_REGISTRY } from './tools.js';

// ── LLM Client Initialization ────────────────────────────────────────────────

const LLM_PROVIDER = 'gemini';
const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.70');

// ── LLM Call ─────────────────────────────────────────────────────────────────

/**
 * Calls the configured LLM provider (Gemini).
 * @param {Array} messages — [{role, content}, ...]
 * @returns {Promise<string>} raw LLM text response
 */
async function callLLM(messages) {
  // Respect Gemini free tier limits with a slight padding
  await new Promise(r => setTimeout(r, 2000));
  return callGemini(messages);
}

async function callGemini(messages) {
  try {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY is not set');

    const modelName = 'gemini-2.5-flash';
    console.log(`[Gemini] Calling model: ${modelName} via Google SDK`);

    const systemMsg = messages.find((m) => m.role === 'system');
    const userMsg = messages.find((m) => m.role === 'user');

    const promptText = systemMsg
      ? `${systemMsg.content}\n\n---\n\n${userMsg.content}`
      : userMsg.content;

    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: modelName });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: promptText }] }]
    });
    
    const text = result.response.text();

    // Clean JSON if Gemini wraps it in markdown code fences
    return text.replace(/```json/g, '').replace(/```/g, '').trim();
  } catch (err) {
    console.error('[Gemini Error] Full Error Details:', err.message);

    // Provide standard error mapping so isRetryable properly detects SDK errors
    if (err.status) {
      err.code = err.status.toString();
    }

    // Keeping the fallback logic but making it transparent and ONLY for specific 401/404 errors
    // while we debug the model accessibility issue.
    if (err.message.includes('401') || err.message.includes('404') || err.message.includes('API key') || err.message.includes('Not Found')) {
      console.warn('[Demo Fallback] Triggered due to API/Model error above.');
      // return JSON.stringify({...}) // Temporarily commented out to let errors propagate to the UI for better awareness
    }
    throw err;
  }
}

// ── Exponential Backoff Retry ─────────────────────────────────────────────────

/**
 * Retry a function with exponential backoff.
 * Delays: 500ms → 1000ms → 2000ms (max 3 attempts total)
 *
 * @param {Function} fn — async function to retry
 * @param {number} maxRetries
 * @returns {Promise<{result, retryCount}>}
 */
async function withRetry(fn, maxRetries = 3) {
  const delays = [5000, 15000, 30000]; // Exponential backoff for 429s
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await fn();
      return { result, retryCount: attempt };
    } catch (err) {
      lastError = err;

      // Only retry on retryable errors
      if (!isRetryable(err)) {
        throw err;
      }

      if (attempt < maxRetries - 1) {
        const delay = delays[attempt] || 2000;
        console.warn(
          `[retry] Attempt ${attempt + 1}/${maxRetries} failed for reason: ${err.message}. ` +
          `Retrying in ${delay}ms...`
        );
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

function isRetryable(err) {
  // Retry on rate limits (429), model overloads (503), timeouts, and malformed responses
  const retryableCodes = ['ETIMEDOUT', 'MALFORMED_RESPONSE', 'NULL_RESPONSE', 'ECONNRESET'];
  if (err.retryable === true) return true;
  if (retryableCodes.includes(err.code)) return true;
  
  const msg = err.message || '';
  if (msg.includes('429') || msg.includes('Too Many Requests')) return true;
  if (msg.includes('503') || msg.includes('Service Unavailable')) return true;
  if (msg.includes('timed out')) return true;
  if (msg.includes('malformed')) return true;
  if (msg.includes('ETIMEDOUT')) return true;
  
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Tool Executor ─────────────────────────────────────────────────────────────

/**
 * Executes a tool by name with retry logic and safety guard.
 * @param {string} action — tool name
 * @param {Object} actionInput — tool parameters
 * @param {Array} history — current session history (for safety guard)
 * @returns {Promise<{output, duration_ms, retryCount}>}
 */
async function executeTool(action, actionInput, history) {
  const toolFn = TOOL_REGISTRY[action];

  if (!toolFn) {
    throw new Error(`executeTool: Unknown tool "${action}" — not in registry`);
  }

  // Safety guard — throws if action is blocked
  assertActionSafe(action, actionInput, history);

  const startTime = Date.now();

  const { result: output, retryCount } = await withRetry(() =>
    toolFn(actionInput)
  );

  const duration_ms = Date.now() - startTime;

  return { output, duration_ms, retryCount };
}

// ── Main ReAct Loop ───────────────────────────────────────────────────────────

/**
 * The core ReAct loop — processes a single ticket end-to-end.
 *
 * @param {Object} ticket — the ticket object
 * @param {number} maxSteps — maximum reasoning steps (default 10)
 * @returns {Promise<Object>} result with finalAnswer, toolCallCount, toolCallLog, etc.
 */
export async function reactLoop(ticket, maxSteps = parseInt(process.env.MAX_REACT_STEPS || '10')) {
  const history = []; // { thought, action, input, output, duration_ms, retryCount }
  const toolCallLog = []; // Detailed audit entries
  let step = 0;
  const loopStartTime = Date.now();

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`[ReAct] Starting ticket: ${ticket.ticket_id}`);
  console.log(`[ReAct] Subject: "${ticket.subject}"`);
  console.log(`${'─'.repeat(60)}`);

  while (step < maxSteps) {
    step++;
    console.log(`\n[ReAct] Step ${step}/${maxSteps}`);

    // ── 1. REASON ─────────────────────────────────────────────
    let parsed;
    try {
      // --- HISTORY TRIMMING (Keep context lean) ---
      // If history is too long, truncate previous outputs to save tokens
      const recentHistory = history.map((h, idx) => {
        if (idx < history.length - 2) {
          return { ...h, output: `(Truncated...) ${JSON.stringify(h.output).slice(0, 100)}` };
        }
        return h;
      });

      const messages = buildPrompt(ticket, recentHistory);
      const llmRaw = await callLLM(messages);
      console.log(`[ReAct] LLM raw (${llmRaw.length} chars): ${llmRaw.slice(0, 120)}...`);
      parsed = parseReActResponse(llmRaw);
    } catch (llmErr) {
      console.error(`[ReAct] LLM/parse error at step ${step}: ${llmErr.message}`);

      // LLM failure — escalate gracefully
      return buildEscalatedResult(ticket, history, toolCallLog, loopStartTime, {
        reason: `LLM call failed: ${llmErr.message}`,
        step,
      });
    }

    console.log(`[ReAct] Thought: ${parsed.thought?.slice(0, 100)}...`);
    console.log(`[ReAct] Action: ${parsed.action}`);

    // ── 2. CHECK FOR FINISH ───────────────────────────────────
    if (parsed.action === 'FINISH') {
      const confidence = parsed.confidence ?? 0;

      // Auto-escalate if confidence too low
      if (confidence < CONFIDENCE_THRESHOLD) {
        console.warn(
          `[ReAct] Confidence ${confidence} < threshold ${CONFIDENCE_THRESHOLD} — auto-escalating`
        );
        return buildEscalatedResult(ticket, history, toolCallLog, loopStartTime, {
          reason: `Low confidence (${confidence}) — auto-escalated per policy`,
          llmFinalAnswer: parsed.finalAnswer,
          step,
        });
      }

      const processing_time_ms = Date.now() - loopStartTime;
      console.log(`[ReAct] ✅ FINISH — confidence: ${confidence}, resolution: ${parsed.resolution_type}`);

      return {
        ticket_id: ticket.ticket_id,
        action: 'FINISH',
        finalAnswer: parsed.finalAnswer,
        resolution_type: parsed.resolution_type || 'reply_sent',
        confidence: confidence,
        reasoning_trace: parsed.thought,
        toolCallCount: history.length,
        toolCallLog,
        processing_time_ms,
        status: 'resolved',
      };
    }

    const toolCallEntry = {
      tool: parsed.action,
      input: parsed.actionInput,
      output: null,
      duration_ms: 0,
      success: false,
      retry_count: 0,
      error: null,
      step,
    };

    // ── STEP 2: ACT (TOOL EXECUTION) ───────────────────────────────────
    try {
      if (parsed.action === 'FINISH') {
        return {
          finalAnswer: parsed.finalAnswer,
          thought: parsed.thought,
          resolution_type: parsed.resolution_type,
          confidence: parsed.confidence,
          toolCallCount: history.length,
          toolCallLog,
          processing_time_ms: Date.now() - loopStartTime,
        };
      }

      // --- LOOP GUARD ---
      const repeatCount = history.filter(h => h.action === parsed.action && JSON.stringify(h.input) === JSON.stringify(parsed.actionInput)).length;
      if (repeatCount >= 2) {
        console.warn(`[Loop Guard] Detected repeating action "${parsed.action}" with same input. Escalating.`);
        return {
          finalAnswer: `I noticed I was repeating the same action (${parsed.action}) without progress. Escalating to a human for review.`,
          thought: `Loop Guard triggered: repeated ${parsed.action} twice with identical input.`,
          resolution_type: 'escalated',
          status: 'escalated',
          confidence: 0,
          toolCallCount: history.length,
          toolCallLog,
          processing_time_ms: Date.now() - loopStartTime,
          escalate_immediately: true
        };
      }

      const { output, duration_ms, retryCount } = await executeTool(
        parsed.action,
        parsed.actionInput,
        history
      );

      toolCallEntry.output = output;
      toolCallEntry.duration_ms = duration_ms;
      toolCallEntry.success = true;
      toolCallEntry.retry_count = retryCount;

      console.log(
        `[ReAct] ✓ ${parsed.action} completed in ${duration_ms}ms` +
        (retryCount > 0 ? ` (${retryCount} retries)` : '')
      );

      // ── 4. OBSERVE ─────────────────────────────────────────
      history.push({
        thought: parsed.thought,
        action: parsed.action,
        input: parsed.actionInput,
        output,
      });

    } catch (toolErr) {
      toolCallEntry.error = toolErr.message;
      toolCallEntry.success = false;

      console.error(
        `[ReAct] ✗ ${parsed.action} failed: ${toolErr.message}`
      );

      // Safety violations are non-retryable — escalate immediately
      if (toolErr.message.includes('safetyGuard')) {
        toolCallLog.push(toolCallEntry);
        return buildEscalatedResult(ticket, history, toolCallLog, loopStartTime, {
          reason: `Safety violation: ${toolErr.message}`,
          step,
          priority: 'high',
        });
      }

      // Tool failure — add to history with error so LLM can react
      history.push({
        thought: parsed.thought,
        action: parsed.action,
        input: parsed.actionInput,
        output: { error: toolErr.message, success: false },
      });
    }

    toolCallLog.push(toolCallEntry);
  }

  // ── Max steps exceeded ────────────────────────────────────────────────────
  console.warn(`[ReAct] Max steps (${maxSteps}) exceeded for ${ticket.ticket_id} — escalating`);
  return buildEscalatedResult(ticket, history, toolCallLog, loopStartTime, {
    reason: `Max steps (${maxSteps}) exceeded — agent could not resolve`,
    step: maxSteps,
  });
}

// ── Helper: Build Escalated Result ──────────────────────────────────────────

function buildEscalatedResult(ticket, history, toolCallLog, loopStartTime, ctx) {
  const processing_time_ms = Date.now() - loopStartTime;
  const priority = ctx.priority || 'medium';

  const summary =
    `Ticket ${ticket.ticket_id} auto-escalated. ` +
    `Reason: ${ctx.reason}. ` +
    `Steps taken: ${history.length}. ` +
    `Last tool: ${history[history.length - 1]?.action || 'none'}. ` +
    (ctx.llmFinalAnswer ? `LLM draft: ${ctx.llmFinalAnswer.slice(0, 200)}` : '');

  return {
    ticket_id: ticket.ticket_id,
    action: 'FINISH',
    finalAnswer: ctx.llmFinalAnswer || `Your request (${ticket.subject}) requires further review by our team. We'll respond within 4 hours.`,
    resolution_type: 'escalated',
    confidence: 0.0,
    reasoning_trace: ctx.reason,
    toolCallCount: history.length,
    toolCallLog,
    processing_time_ms,
    status: 'escalated',
    escalation_context: {
      reason: ctx.reason,
      priority,
      summary,
    },
  };
}
