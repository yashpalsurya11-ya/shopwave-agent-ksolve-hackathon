# ShopWave Failure Modes

> Documented failure scenarios and how the ShopWave Autonomous Support Agent handles each one.

---

## Failure Mode 1: Tool Timeout

**Scenario**: `getOrder()` or other read tools fail to respond within 2 seconds due to upstream service degradation.

**Detection**:
- Error code: `ETIMEDOUT`
- Error property: `retryable: true`

**Strategy**: Exponential backoff retry

| Attempt | Delay   | Cumulative Wait |
|---------|---------|-----------------|
| 1st     | 0ms     | 0ms             |
| 2nd     | 500ms   | 500ms           |
| 3rd     | 1000ms  | 1500ms          |
| (fail)  | 2000ms  | 3500ms          |

**Implementation** (`reactLoop.js → withRetry()`):
```js
const delays = [500, 1000, 2000];
for (let attempt = 0; attempt < maxRetries; attempt++) {
  try {
    return await fn();
  } catch (err) {
    if (!isRetryable(err)) throw err;
    await sleep(delays[attempt]);
  }
}
```

**Final outcome**: After 3 failed retries, the error is propagated to the ReAct loop. The LLM sees the tool failure in its `observation` and can either try an alternative tool or call `escalate()`. If it cannot recover, the agent auto-escalates with full context.

**Audit log**: `error_encountered` is populated; `retry_count` on the tool call entry shows the number of retries attempted.

---

## Failure Mode 2: Malformed JSON from Tool

**Scenario**: `checkRefundEligibility()` returns a garbled response (15% probability) — simulating upstream service parsing failures.

**Detection**:
- Error code: `MALFORMED_RESPONSE`
- Thrown as a retryable error

**Strategy**: 
1. Retry up to 3 times (same backoff as timeout)
2. If all retries fail, the error is added to the tool history as `{ error: "...", success: false }`
3. LLM sees the failure in its observation and attempts partial extraction or alternative approach
4. `parseReActResponse()` also has its own fallback for malformed LLM output:

```js
// In prompts.js parseReActResponse()
const actionMatch = cleaned.match(/"action"\s*:\s*"([^"]+)"/);
const thoughtMatch = cleaned.match(/"thought"\s*:\s*"([^"]+)"/);
if (actionMatch && thoughtMatch) {
  // Construct minimal valid response
  return { thought: ..., action: 'escalate', actionInput: {...} };
}
```

**Final outcome**: If malformed responses persist across all retries AND the agent cannot reach a confident conclusion, it escalates to a human agent with the partial information gathered.

**Audit log**: `tool_calls[].success = false`, `tool_calls[].error` captures the exact parse failure message, `status = "escalated"`.

---

## Failure Mode 3: Low Confidence Score

**Scenario**: The LLM agent reaches a conclusion but its confidence score is below the threshold (default: 0.70). This occurs for:
- Ambiguous tickets with missing information (TKT-020: "my thing is broken")
- Social engineering attempts requiring careful verification (TKT-018)
- Tickets where policy is unclear or contradictory
- Unknown customers with no order history

**Detection**:
```js
if (parsed.action === 'FINISH' && parsed.confidence < CONFIDENCE_THRESHOLD) {
  return buildEscalatedResult(ticket, history, ..., {
    reason: `Low confidence (${parsed.confidence}) — auto-escalated per policy`
  });
}
```

**Threshold**: Configurable via `CONFIDENCE_THRESHOLD` env var (default: `0.70`).

**LLM Confidence Scoring Guidelines** (enforced via system prompt):
| Range | Meaning |
|-------|---------|
| 0.95+ | Clear-cut: policy is obvious, all data verified |
| 0.80–0.94 | Normal resolution: complete data, standard policy |
| 0.70–0.79 | Grey area: some ambiguity, but policy supports decision |
| < 0.70 | **Auto-escalate** — uncertain, anomalous, or risky |

**Final outcome**: Agent auto-escalates with:
- The LLM's draft answer (for human reference)
- Full tool call history
- The confidence score
- The reason for low confidence

**Audit log**: `confidence_score < 0.70`, `status = "escalated"`, `resolution_type = "escalated"`.

---

## Failure Mode 4: Safety Guard Violation

**Scenario**: The LLM attempts to call `issueRefund()` without first calling `checkRefundEligibility()` in the same session. This could result in an irreversible erroneous refund.

**Detection** (`safetyGuard.js`):
```js
const eligibilityCall = history.find(
  h => h.action === 'checkRefundEligibility' && h.input?.orderId === orderId
);
if (!eligibilityCall) {
  throw new Error(`safetyGuard: BLOCKED issueRefund — eligibility not checked`);
}
```

**Final outcome**: The action is blocked before execution. The agent immediately escalates to a human agent with `priority: "high"`. The LLM cannot bypass this — it is a programmatic hard block.

**Audit log**: `status = "escalated"`, `error_encountered` contains the safety guard message.

---

## Failure Mode 5: Non-Existent Order / Customer Not Found

**Scenario**: Customer provides a non-existent order ID (TKT-017: ORD-9999) or the email is not in the system (TKT-016: unknown.user@email.com).

**Strategy**: 
- `getOrder()` returns `{ found: false, error: "..." }` 
- `getCustomer()` returns `{ found: false, error: "..." }`
- LLM sees this in its observation and responds appropriately
- No action can be taken without verified identity

**Final outcome**: Agent sends a professional reply asking for correct order details. For repeated threats (TKT-017 mentions "lawyer"), the response is professional but firm — no special treatment.

---

## Failure Mode 6: Max Steps Exceeded

**Scenario**: Agent enters a reasoning loop and cannot resolve the ticket within `maxSteps` (default: 10) iterations.

**Strategy**:
```js
while (step < maxSteps) { ... }
// Falls through to:
return buildEscalatedResult(ticket, ..., {
  reason: `Max steps (${maxSteps}) exceeded — agent could not resolve`
});
```

**Final outcome**: Auto-escalate with the complete tool call history so the human agent has full context on what was tried.

---

## Failure Mode 7: LLM API Error

**Scenario**: OpenAI/Gemini API returns an error (rate limit, network issue, invalid key).

**Strategy**: The LLM call is NOT wrapped in the tool retry backoff (to avoid burning API quota on rate limits). Instead, the error is caught at the step level and the ticket is immediately escalated.

**Final outcome**: Per-ticket catch in `Promise.all()` ensures all other tickets continue processing. The failing ticket is marked `status: "failed"` in the audit log.
