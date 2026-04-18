/**
 * tools.js — All 8 ShopWave agent tools with realistic failure simulation
 *
 * Tools are async functions that simulate real e-commerce backend behavior
 * including network timeouts, malformed responses, and partial data.
 *
 * Failure rates (production-realistic):
 *   getOrder               → 20% timeout (rejects after 2s)
 *   checkRefundEligibility → 15% malformed JSON
 *   getCustomer            → 10% partial data (missing fields)
 *   getProduct             → 5% null response
 *   searchKnowledgeBase    → occasionally returns empty array
 *   issueRefund            → throws if eligibility not confirmed (via safetyGuard)
 *   sendReply              → returns sent_at + delivery_status
 *   escalate               → routes to human agent queue
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '..', 'data');

// ── Data loaders (cached in-process) ─────────────────────────────────────────

function loadJSON(filename) {
  try {
    return JSON.parse(readFileSync(join(DATA_DIR, filename), 'utf-8'));
  } catch (err) {
    throw new Error(`Failed to load ${filename}: ${err.message}`);
  }
}

const ORDERS = loadJSON('orders.json');
const CUSTOMERS = loadJSON('customers.json');
const PRODUCTS = loadJSON('products.json');
const KNOWLEDGE_BASE = loadJSON('knowledge_base.json');

// ── Failure simulation helpers ────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldFail(probability) {
  return Math.random() < probability;
}

/**
 * Validates that a tool output matches expected shape.
 * Throws a descriptive error if critical fields are missing.
 */
function validateOutputShape(toolName, output, requiredFields) {
  if (output === null || output === undefined) {
    throw new Error(`${toolName}: Tool returned null/undefined response`);
  }
  for (const field of requiredFields) {
    if (!(field in output)) {
      throw new Error(
        `${toolName}: Invalid response shape — missing required field "${field}". Got: ${JSON.stringify(output)}`
      );
    }
  }
  return output;
}

// ── Tool 1: getOrder ──────────────────────────────────────────────────────────

/**
 * Fetches order details by order ID.
 * 20% chance of timeout (rejects with ETIMEDOUT after 2 seconds).
 *
 * @param {string} orderId
 * @returns {Promise<Object>} order object
 */
export async function getOrder({ orderId }) {
  // Simulate 20% timeout
  if (shouldFail(0.20)) {
    await sleep(2000);
    const err = new Error(`getOrder: Request timed out for orderId "${orderId}"`);
    err.code = 'ETIMEDOUT';
    err.retryable = true;
    throw err;
  }

  // Small network delay
  await sleep(Math.random() * 300 + 100);

  const order = ORDERS.find((o) => o.order_id === orderId);

  if (!order) {
    return {
      found: false,
      order_id: orderId,
      error: `No order found with ID "${orderId}"`,
    };
  }

  const result = { found: true, ...order };
  return validateOutputShape('getOrder', result, ['found', 'order_id', 'status']);
}

// ── Tool 2: checkRefundEligibility ───────────────────────────────────────────

/**
 * Checks if an order is eligible for a refund.
 * 15% chance of returning malformed/partial JSON.
 *
 * @param {string} orderId
 * @returns {Promise<Object>} eligibility result
 */
export async function checkRefundEligibility({ orderId }) {
  await sleep(Math.random() * 400 + 100);

  // 15% malformed JSON simulation
  if (shouldFail(0.15)) {
    const err = new Error(
      `checkRefundEligibility: Received malformed response from eligibility service for "${orderId}"`
    );
    err.code = 'MALFORMED_RESPONSE';
    err.retryable = true;
    throw err;
  }

  const order = ORDERS.find((o) => o.order_id === orderId);

  if (!order) {
    return {
      eligible: false,
      orderId,
      reason: 'Order not found in system',
      order: null,
    };
  }

  const today = new Date('2024-03-15'); // Fixed date for deterministic testing
  const returnDeadline = order.return_deadline ? new Date(order.return_deadline) : null;

  // Already refunded
  if (order.refund_status === 'refunded') {
    return {
      eligible: false,
      orderId,
      reason: 'Refund has already been processed for this order',
      refund_already_issued: true,
      order,
    };
  }

  // Not delivered
  if (order.status === 'processing' || order.status === 'shipped') {
    return {
      eligible: false,
      orderId,
      reason: `Order is in "${order.status}" status — cannot refund before delivery`,
      order,
    };
  }

  // Return window check
  if (returnDeadline && today > returnDeadline) {
    return {
      eligible: false,
      orderId,
      reason: `Return window expired on ${order.return_deadline}`,
      return_deadline: order.return_deadline,
      order,
      warranty_may_apply: true,
    };
  }

  return {
    eligible: true,
    orderId,
    reason: 'Order is within return window and qualifies for refund',
    max_refund_amount: order.amount,
    return_deadline: order.return_deadline,
    order,
  };
}

// ── Tool 3: getCustomer ───────────────────────────────────────────────────────

/**
 * Fetches customer profile by email.
 * 10% chance of partial data (missing address/notes fields).
 *
 * @param {string} email
 * @returns {Promise<Object>} customer object
 */
export async function getCustomer({ email }) {
  await sleep(Math.random() * 250 + 50);

  const customer = CUSTOMERS.find(
    (c) => c.email.toLowerCase() === email.toLowerCase()
  );

  if (!customer) {
    return {
      found: false,
      email,
      error: `No customer found with email "${email}"`,
    };
  }

  // 10% partial data — simulate fields being stripped mid-transit
  if (shouldFail(0.10)) {
    return {
      found: true,
      customer_id: customer.customer_id,
      name: customer.name,
      email: customer.email,
      tier: customer.tier,
      _partial: true,
      _warning: 'Some customer fields were unavailable — partial data returned',
    };
  }

  return { found: true, ...customer };
}

// ── Tool 4: getProduct ────────────────────────────────────────────────────────

/**
 * Fetches product details by product ID.
 * 5% chance of null response (upstream catalog service outage).
 *
 * @param {string} productId
 * @returns {Promise<Object|null>} product object or null
 */
export async function getProduct({ productId }) {
  await sleep(Math.random() * 200 + 50);

  // 5% null response
  if (shouldFail(0.05)) {
    const err = new Error(
      `getProduct: Catalog service returned null for productId "${productId}" — service may be degraded`
    );
    err.code = 'NULL_RESPONSE';
    err.retryable = true;
    throw err;
  }

  const product = PRODUCTS.find((p) => p.product_id === productId);

  if (!product) {
    return {
      found: false,
      product_id: productId,
      error: `No product found with ID "${productId}"`,
    };
  }

  return { found: true, ...product };
}

// ── Tool 5: searchKnowledgeBase ───────────────────────────────────────────────

/**
 * Searches the internal knowledge base for relevant articles.
 * Occasionally returns empty array (no matches / indexing delay).
 *
 * @param {string} query
 * @returns {Promise<Array>} array of matching KB articles
 */
export async function searchKnowledgeBase({ query }) {
  await sleep(Math.random() * 300 + 100);

  if (!query || query.trim().length === 0) {
    return [];
  }

  const queryLower = query.toLowerCase();
  const keywords = queryLower.split(/\s+/).filter((w) => w.length > 2);

  const results = KNOWLEDGE_BASE.filter((article) => {
    const searchText =
      `${article.title} ${article.content} ${article.category}`.toLowerCase();
    return keywords.some((kw) => searchText.includes(kw));
  });

  // Occasionally return empty array (5% chance) — simulates indexing delays
  if (shouldFail(0.05) && results.length > 0) {
    return [];
  }

  return results.slice(0, 3); // Return top 3 matches max
}

// ── Tool 6: issueRefund ───────────────────────────────────────────────────────

/**
 * Issues a refund — IRREVERSIBLE action.
 * safetyGuard.js enforces that checkRefundEligibility was called first.
 * This tool trusts the guard has been applied upstream.
 *
 * @param {string} orderId
 * @param {number} amount
 * @returns {Promise<Object>} refund confirmation
 */
export async function issueRefund({ orderId, amount }) {
  await sleep(Math.random() * 500 + 200);

  const order = ORDERS.find((o) => o.order_id === orderId);

  if (!order) {
    throw new Error(
      `issueRefund: Cannot issue refund — order "${orderId}" not found`
    );
  }

  if (order.refund_status === 'refunded') {
    throw new Error(
      `issueRefund: Refund already issued for order "${orderId}"`
    );
  }

  // Mutate in-memory (simulates DB write; JSON file not mutated for idempotency)
  order.refund_status = 'refunded';

  const refundId = `REF-${orderId}-${Date.now()}`;
  const processedAt = new Date().toISOString();
  const expectedCredit = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  return {
    success: true,
    refund_id: refundId,
    order_id: orderId,
    amount_refunded: amount,
    currency: 'USD',
    processed_at: processedAt,
    expected_credit_by: expectedCredit,
    method: 'original_payment_method',
    status: 'processing',
    message: `Refund of $${amount.toFixed(2)} initiated successfully`,
  };
}

// ── Tool 7: sendReply ─────────────────────────────────────────────────────────

/**
 * Sends a reply to the customer via the ticketing system.
 *
 * @param {string} ticketId
 * @param {string} message
 * @returns {Promise<Object>} delivery confirmation
 */
export async function sendReply({ ticketId, message }) {
  await sleep(Math.random() * 300 + 100);

  return {
    success: true,
    ticket_id: ticketId,
    sent_at: new Date().toISOString(),
    delivery_status: 'delivered',
    channel: 'email',
    message_preview: message.slice(0, 80) + (message.length > 80 ? '...' : ''),
  };
}

// ── Tool 8: escalate ──────────────────────────────────────────────────────────

/**
 * Escalates the ticket to a human agent with context.
 *
 * @param {string} ticketId
 * @param {string} summary
 * @param {string} priority — 'low' | 'medium' | 'high' | 'urgent'
 * @returns {Promise<Object>} escalation confirmation
 */
export async function escalate({ ticketId, summary, priority = 'medium' }) {
  await sleep(Math.random() * 200 + 100);

  const queueMap = {
    low: 'general-support',
    medium: 'senior-support',
    high: 'team-lead',
    urgent: 'emergency-escalation',
  };

  const escalationId = `ESC-${ticketId}-${Date.now()}`;
  const estimatedResponse = {
    low: '24 hours',
    medium: '4 hours',
    high: '1 hour',
    urgent: '15 minutes',
  };

  return {
    success: true,
    escalation_id: escalationId,
    ticket_id: ticketId,
    assigned_queue: queueMap[priority] || 'senior-support',
    priority,
    summary_preview: summary.slice(0, 100),
    escalated_at: new Date().toISOString(),
    estimated_response: estimatedResponse[priority] || '4 hours',
    status: 'queued',
  };
}

// ── Tool registry ─────────────────────────────────────────────────────────────

export const TOOL_REGISTRY = {
  getOrder,
  checkRefundEligibility,
  getCustomer,
  getProduct,
  searchKnowledgeBase,
  issueRefund,
  sendReply,
  escalate,
};
