/**
 * prompts.js — System prompt + ReAct format template for ShopWave Agent
 * Defines the LLM's persona, available tools, and strict JSON output format.
 */

export const SYSTEM_PROMPT = `You are ShopWave's Autonomous Support Agent. Resolve tickets step-by-step using tools.

## TOOLS
1. getOrder(orderId)
2. checkRefundEligibility(orderId)
3. getCustomer(email)
4. getProduct(productId)
5. searchKnowledgeBase(query)
6. issueRefund(orderId, amount) - PRE-REQ: checkRefundEligibility
7. sendReply(ticketId, message)
8. escalate(ticketId, summary, priority)

## POLICIES
- Return windows: Electronics/Watches (15 days), Standard (30 days), Accessories (60 days).
- VIPs: Exceptions allowed; check customer notes.
- Damaged/Wrong item: Full refund allowed immediately.
- Warranty: Escalate if return window expired but warranty active.
- Verified identity (getCustomer) is required before actions.

## RESPONSE FORMAT (JSON)
Action: {"thought":"...","action":"toolName","actionInput":{...}}
Finish: {"thought":"...","action":"FINISH","finalAnswer":"...","resolution_type":"...","confidence":0.95}

## RULES
- ALWAYS call checkRefundEligibility before issueRefund.
- Address customer by name. Aim to finish in <5 steps.
- If unsure or high-risk, escalate.`;

/**
 * Build the full prompt for a given ReAct step.
 * @param {Object} ticket — the ticket being processed
 * @param {Array} history — array of { thought, action, input, output } objects
 * @returns {Array} messages array for the LLM
 */
export function buildPrompt(ticket, history) {
  const userMessage = `## TICKET TO RESOLVE

Ticket ID: ${ticket.ticket_id}
Customer Email: ${ticket.customer_email}
Subject: ${ticket.subject}
Message: ${ticket.body}
Source: ${ticket.source}
Created At: ${ticket.created_at}
Priority Tier: ${ticket.tier}

## TOOL CALL HISTORY SO FAR
${
  history.length === 0
    ? 'No tool calls yet. This is the first step.'
    : history
        .map(
          (h, i) => `
Step ${i + 1}:
  Thought: ${h.thought}
  Action: ${h.action}
  Input: ${JSON.stringify(h.input)}
  Output: ${JSON.stringify(h.output)}`
        )
        .join('\n')
}

## INSTRUCTION
Based on the ticket and tool history above, provide your next action as a JSON object.
If you have enough information to fully resolve this ticket, return a FINISH action with finalAnswer.
If you need more information or need to take an action, return the appropriate tool call.
Remember: issueRefund requires a prior checkRefundEligibility call in this session.

Respond with ONLY valid JSON — no explanation, no markdown, no extra text.`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ];
}

/**
 * Parse the LLM's raw text response into a structured ReAct object.
 * Handles common issues like markdown code fences, trailing commas, etc.
 * @param {string} rawResponse
 * @returns {Object} parsed ReAct step
 */
export function parseReActResponse(rawResponse) {
  let cleaned = rawResponse.trim();

  // Strip markdown code fences if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  // Extract first JSON object (handle any trailing text)
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  try {
    const parsed = JSON.parse(cleaned);

    // Validate required fields
    if (!parsed.thought || !parsed.action) {
      throw new Error('Missing required fields: thought, action');
    }

    if (parsed.action === 'FINISH') {
      if (!parsed.finalAnswer) {
        throw new Error('FINISH action missing finalAnswer');
      }
      if (typeof parsed.confidence !== 'number') {
        parsed.confidence = 0.75; // default if missing
      }
      parsed.resolution_type = parsed.resolution_type || 'reply_sent';
    } else {
      if (!parsed.actionInput) {
        parsed.actionInput = {};
      }
    }

    return parsed;
  } catch (err) {
    // Attempt partial extraction for common LLM formatting errors
    const actionMatch = cleaned.match(/"action"\s*:\s*"([^"]+)"/);
    const thoughtMatch = cleaned.match(/"thought"\s*:\s*"([^"]+)"/);

    if (actionMatch && thoughtMatch) {
      return {
        thought: thoughtMatch[1],
        action: 'escalate',
        actionInput: {
          ticketId: 'UNKNOWN',
          summary: `LLM response parsing failed. Raw response: ${rawResponse.slice(0, 200)}`,
          priority: 'medium',
        },
        _parseError: err.message,
      };
    }

    throw new Error(
      `Failed to parse LLM response: ${err.message}. Raw: ${rawResponse.slice(0, 300)}`
    );
  }
}
