/**
 * safetyGuard.js — Programmatic safety enforcement for ShopWave agent
 *
 * Enforces hard rules that CANNOT be overridden by LLM reasoning:
 * 1. issueRefund is BLOCKED if checkRefundEligibility was not called
 * 2. issueRefund is BLOCKED if eligibility check returned ineligible
 * 3. Validates all tool inputs for required parameters
 */

/**
 * Checks whether the agent's pending action is safe to execute.
 * Throws a descriptive error if the action should be blocked.
 *
 * @param {string} action — the tool name about to be called
 * @param {Object} actionInput — the tool's input parameters
 * @param {Array} history — the tool call history so far in this ticket session
 * @throws {Error} if the action is blocked by a safety rule
 */
export function assertActionSafe(action, actionInput, history) {
  switch (action) {
    case 'issueRefund':
      enforceRefundGate(actionInput, history);
      break;

    case 'escalate':
      assertEscalateInput(actionInput);
      break;

    case 'sendReply':
      assertSendReplyInput(actionInput);
      break;

    case 'getOrder':
      if (!actionInput.orderId) {
        throw new Error('safetyGuard: getOrder requires orderId parameter');
      }
      break;

    case 'checkRefundEligibility':
      if (!actionInput.orderId) {
        throw new Error(
          'safetyGuard: checkRefundEligibility requires orderId parameter'
        );
      }
      break;

    case 'getCustomer':
      if (!actionInput.email) {
        throw new Error('safetyGuard: getCustomer requires email parameter');
      }
      break;

    case 'getProduct':
      if (!actionInput.productId) {
        throw new Error('safetyGuard: getProduct requires productId parameter');
      }
      break;

    case 'searchKnowledgeBase':
      if (!actionInput.query) {
        throw new Error(
          'safetyGuard: searchKnowledgeBase requires query parameter'
        );
      }
      break;

    default:
      throw new Error(`safetyGuard: Unknown tool "${action}" — blocking execution`);
  }
}

/**
 * The refund gate — the most critical safety check.
 * issueRefund can ONLY proceed if:
 * 1. checkRefundEligibility was called for the same orderId in this session
 * 2. The eligibility result was not explicitly ineligible
 */
function enforceRefundGate(actionInput, history) {
  const { orderId, amount } = actionInput;

  if (!orderId) {
    throw new Error('safetyGuard: issueRefund requires orderId parameter');
  }
  if (amount === undefined || amount === null || amount <= 0) {
    throw new Error(
      'safetyGuard: issueRefund requires a positive amount parameter'
    );
  }

  // Find eligibility check in history for this specific order
  const eligibilityCall = history.find(
    (h) =>
      h.action === 'checkRefundEligibility' &&
      h.input?.orderId === orderId &&
      h.output !== null &&
      h.output !== undefined
  );

  if (!eligibilityCall) {
    throw new Error(
      `safetyGuard: BLOCKED issueRefund for ${orderId} — ` +
      `checkRefundEligibility has not been called for this order in the current session. ` +
      `This is a mandatory prerequisite to prevent irreversible errors.`
    );
  }

  // Check if eligibility result explicitly says ineligible
  const eligibilityOutput = eligibilityCall.output;
  if (
    eligibilityOutput &&
    typeof eligibilityOutput === 'object' &&
    eligibilityOutput.eligible === false
  ) {
    throw new Error(
      `safetyGuard: BLOCKED issueRefund for ${orderId} — ` +
      `checkRefundEligibility returned ineligible: ${eligibilityOutput.reason || 'No reason provided'}. ` +
      `Cannot issue refund against an ineligible order.`
    );
  }

  // Check for refund amount sanity vs. order amount
  if (eligibilityOutput?.order?.amount && amount > eligibilityOutput.order.amount * 1.1) {
    throw new Error(
      `safetyGuard: BLOCKED issueRefund for ${orderId} — ` +
      `Requested refund amount $${amount} exceeds order total $${eligibilityOutput.order.amount} by more than 10%. ` +
      `Suspicious transaction blocked.`
    );
  }
}

function assertEscalateInput(actionInput) {
  if (!actionInput.ticketId) {
    throw new Error('safetyGuard: escalate requires ticketId parameter');
  }
  if (!actionInput.summary) {
    throw new Error('safetyGuard: escalate requires summary parameter');
  }
  const validPriorities = ['low', 'medium', 'high', 'urgent'];
  if (!validPriorities.includes(actionInput.priority)) {
    // Auto-correct to medium rather than blocking
    actionInput.priority = 'medium';
  }
}

function assertSendReplyInput(actionInput) {
  if (!actionInput.ticketId) {
    throw new Error('safetyGuard: sendReply requires ticketId parameter');
  }
  if (!actionInput.message || actionInput.message.trim().length < 10) {
    throw new Error(
      'safetyGuard: sendReply requires a meaningful message (min 10 chars)'
    );
  }
}

/**
 * Returns a summary of which safety-sensitive tools were called.
 * Used by auditLogger to capture the safety footprint.
 * @param {Array} history
 * @returns {Object}
 */
export function getSafetySnapshot(history) {
  return {
    eligibilityChecked: history.some(
      (h) => h.action === 'checkRefundEligibility'
    ),
    refundIssued: history.some((h) => h.action === 'issueRefund'),
    escalated: history.some((h) => h.action === 'escalate'),
    replySent: history.some((h) => h.action === 'sendReply'),
    totalToolCalls: history.length,
    toolCallSequence: history.map((h) => h.action),
  };
}
