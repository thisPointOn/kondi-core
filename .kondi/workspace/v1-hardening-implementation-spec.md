# V1 Hardening Implementation Spec
## Cost-First Budget Enforcement + Durable Completion

### Executive Summary

**This is a ~3 day integration project, not a build project.** The budget system (`budget-tracker.ts`, `budget-aware-caller.ts`, `budget-integration.ts`) is complete and type-compatible with the production `AgentInvoker` interface. Both orchestrators already have production-grade retry with exponential backoff. The work is: connect, unify, test.

---

## Part 1: Budget Injection (1 day)

### Target: `src/cli/run-council.ts` lines 350-368

This is **the single injection point**. The `invokeAgent` closure at line 350 is where `callLLM()` gets called with raw persona config. This closure is passed into both `DeliberationOrchestrator` and `CodingOrchestrator` via the `callbacks` object (line 371).

#### Exact Change

```typescript
// BEFORE (line 350-368):
const invokeAgent = async (invocation: any, persona: Persona) => {
  log(C.cyan, persona.name, `Thinking... (${persona.model})`);
  const result = await callLLM({
    provider: persona.provider || 'anthropic-api',
    systemPrompt: invocation.systemPrompt,
    userMessage: invocation.userMessage,
    model: persona.model,
    // ...
  });
  return { ...result, sessionId: result.sessionId };
};

// AFTER:
import { createCostFirstCaller } from '../.kondi/workspace/budget-aware-caller';
import { createBudgetAwareInvoker, formatTelemetryForCLI } from '../.kondi/workspace/budget-integration';

const budgetCaller = createCostFirstCaller(!quietMode);
const budgetInvoker = createBudgetAwareInvoker(budgetCaller, council);

const invokeAgent = async (invocation: any, persona: Persona) => {
  log(C.cyan, persona.name, `Thinking... (${persona.model})`);
  const result = await budgetInvoker(invocation, persona);
  if (!quietMode) log(C.dim, 'Budget', formatTelemetryForCLI(budgetCaller.getTracker()));
  return result;
};
```

#### Why This Works

- `createBudgetAwareInvoker()` returns a function matching the `AgentInvoker` type signature: `(invocation: AgentInvocation, persona: Persona) => Promise<AgentResponse>`
- Both orchestrators receive it through `config.invokeAgent` — zero changes to orchestrator code
- Budget decisions (tier selection, downgrade, cap enforcement) happen transparently before `callLLM()`

#### Secondary injection: `src/cli/run-pipeline.ts` line 512

Same pattern — the pipeline executor also constructs an `invokeAgent` closure. Wrap identically.

### Files to Edit

| File | Change | Lines |
|------|--------|-------|
| `src/cli/run-council.ts` | Wrap `invokeAgent` with budget invoker | ~20 lines changed |
| `src/cli/run-pipeline.ts` | Same wrap for pipeline path | ~15 lines changed |
| `.kondi/workspace/budget-integration.ts` | Fix `createBudgetAwareInvoker` to pass through persona provider when `pinProvider` is set | ~10 lines added |

### Pin-Provider Escape Hatch

Add to `Persona` type (or council config):
```typescript
// In budget-integration.ts createBudgetAwareInvoker():
if (persona.pinProvider) {
  // Skip budget routing, still track cost
  const result = await callLLM({ provider: persona.provider, model: persona.model, ... });
  budgetCaller.getTracker().recordCall(stage, calculatedCost, 'pinned');
  return result;
}
```

---

## Part 2: Unified Retry Contract (0.5 day)

### Current State (already good!)

Both orchestrators have nearly identical retry logic:
- **DeliberationOrchestrator** `invokeAgentSafe()` (line 2202): 5 retries, 15s base, exponential backoff, matches 429/529/rate-limit/overloaded, plus timeout retry (1 attempt)
- **CodingOrchestrator** `invokeAgentSafe()` (line 866): 5 retries, 15s base, exponential backoff, matches 429/529/rate-limit/overloaded (no timeout retry)

### Recommended Extraction

Create `src/council/retry-policy.ts`:

```typescript
export interface RetryPolicy {
  maxTransientRetries: number;  // default: 5
  baseDelayMs: number;          // default: 15_000
  timeoutRetries: number;       // default: 1
  transientPattern: RegExp;     // /\b(429|529|rate.limit|overloaded|too many requests)\b/i
  timeoutPattern: RegExp;       // /\btimed?\s*out\b/i
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxTransientRetries: 5,
  baseDelayMs: 15_000,
  timeoutRetries: 1,
  transientPattern: /\b(429|529|rate.limit|overloaded|too many requests)\b/i,
  timeoutPattern: /\btimed?\s*out\b/i,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  callbacks?: {
    onRetry?: (attempt: number, delayMs: number, error: Error) => void;
    onTimeout?: (attempt: number, error: Error) => void;
  }
): Promise<T> {
  let timeoutRetries = 0;
  for (let attempt = 0; attempt <= policy.maxTransientRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const isTransient = policy.transientPattern.test(errMsg);
      const isTimeout = policy.timeoutPattern.test(errMsg);

      if (isTimeout && timeoutRetries < policy.timeoutRetries) {
        timeoutRetries++;
        callbacks?.onTimeout?.(timeoutRetries, error as Error);
        continue;
      }
      if (isTransient && attempt < policy.maxTransientRetries) {
        const delayMs = policy.baseDelayMs * Math.pow(2, attempt);
        callbacks?.onRetry?.(attempt + 1, delayMs, error as Error);
        await new Promise(r => setTimeout(r, delayMs));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Retry exhausted'); // unreachable
}
```

### Files to Edit

| File | Change |
|------|--------|
| `src/council/retry-policy.ts` | New file (~60 lines) |
| `src/council/deliberation-orchestrator.ts` | Replace inline retry loop in `invokeAgentSafe()` with `withRetry()` call |
| `src/council/coding-orchestrator.ts` | Same replacement, gains timeout retry it currently lacks |

---

## Part 3: Token Cost Reduction (0.5 day)

### Already Partially Implemented

- `maxWordsPerResponse` is injected in both orchestrators (deliberation line 2288, coding line 946)
- Prompt caching is live via `cacheableContext` threading

### Missing: Round Summaries for Context Compression

In `deliberation-orchestrator.ts`, the `buildManagerRoundSummaryPrompt()` exists but isn't used to compress context for rounds 3+. Add after round 2:

```typescript
// In runDeliberation(), after round evaluation:
if (currentRound >= 2) {
  // Replace full round history with manager's summary
  const summary = await this.getManagerRoundSummary(councilId, currentRound);
  // Use summary instead of full ledger entries for next round's context
}
```

### Missing: Budget-Triggered Compact Mode

`budget-integration.ts` line 139 has `shouldUseCompactContext()` (triggers at 70% spend). Wire into orchestrators to reduce `maxTokens` and enable aggressive summarization:

```typescript
if (shouldUseCompactContext(budgetTracker)) {
  invocation = { ...invocation, maxTokens: 4000 }; // halve from 8000
}
```

---

## Part 4: Test Matrix (1 day)

### Unit Tests (`src/__tests__/budget/`)

| Test | What It Proves |
|------|---------------|
| `budget-tracker.selectTier.test.ts` | Tier downgrade at 70%, 85%, 100% thresholds |
| `budget-tracker.stageCap.test.ts` | Stage cap enforcement blocks calls correctly |
| `budget-tracker.earlyStop.test.ts` | Early-stop fires at round 3, consensus threshold, low quality gain |
| `budget-tracker.escalation.test.ts` | Anthropic-premium only allowed when gates met |
| `budget-aware-caller.test.ts` | Cost recording accuracy, downgrade logging |

### Integration Tests (`src/__tests__/integration/`)

| Test | What It Proves |
|------|---------------|
| `budget-injection.test.ts` | `createBudgetAwareInvoker` correctly intercepts `callLLM` path |
| `retry-idempotence.test.ts` | Mock 429 → retry → success; same invocation params on retry |
| `partial-failure-recovery.test.ts` | Budget blocked mid-deliberation → graceful stop with partial output |
| `provider-downgrade-e2e.test.ts` | Full run: starts anthropic → downgrades to openai-mid → openai-mini as spend grows |

### Test Infrastructure

```typescript
// Mock callLLM for testing:
const mockCallLLM = jest.fn().mockResolvedValue({
  content: 'test response',
  tokensUsed: 5000,
  latencyMs: 1000,
});

// Inject via budget-aware-caller constructor or dependency injection
```

---

## Call Chain Summary

```
run-council.ts
  └─ createCostFirstCaller() → BudgetAwareCaller
  └─ createBudgetAwareInvoker(caller, council) → AgentInvoker
  └─ new DeliberationOrchestrator({ invokeAgent: budgetInvoker })
       └─ invokeAgentSafe(invocation, persona, context)
            └─ withRetry(() => config.invokeAgent(invocation, persona))
                 └─ budgetInvoker(invocation, persona)
                      └─ BudgetAwareCaller.call()
                           └─ BudgetTracker.selectTier() → decide tier
                           └─ callLLM({ provider: tier.provider, model: tier.model })
                           └─ BudgetTracker.recordCall() → update spend
```

---

## Known Issues to Fix Before Integration

1. **`budget-integration.ts`** — The `t.runUtilization` reference in `formatTelemetryForCLI` (previously reported as having a space typo) — verify and fix
2. **Token split heuristic** in `budget-aware-caller.ts` line 93-95: `75% input / 25% output` estimate is crude. Use actual `usage.input_tokens` and `usage.output_tokens` from `CallerResult` (requires extending `CallerResult` to carry both values separately)
3. **Cost-first routing defaults everything to `openai-mini`** for deliberation — this may produce low-quality council outputs. Recommend `openai-mid` for deliberation stage in the default preset.

---

## Priority Order

1. Wire budget into `run-council.ts` (unblocks everything)
2. Fix token split heuristic (cost accuracy)
3. Extract retry into shared module (code quality + CodingOrchestrator gains timeout retry)
4. Add compact context mode at 70% budget
5. Write test matrix
6. Round summary compression for rounds 3+
