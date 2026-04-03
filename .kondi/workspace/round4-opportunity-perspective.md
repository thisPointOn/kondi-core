# Round 4 — Opportunity Perspective: Implementation Spec

## Where I AGREE — The Foundation Is Genuinely Strong

Having now read every line of source, I'm even more confident than Round 3. The prior analysis was right on the core claim but **understated the maturity of what exists**:

1. **The retry infrastructure is *better* than claimed.** Three distinct retry layers already operate in the deliberation orchestrator:
   - `invokeAgentSafe()` (5 retries, 15s exponential backoff, transient error regex)
   - Phase-level retry (3 attempts, 2-minute base, 1.5x backoff)
   - `runConsultantWithRetry()` (configurable policy: retry/skip/fail, differentiated backoff for rate limits vs. other errors)

   The coding orchestrator has only the first layer — but that's the most important one, and it's **identical code**. This is the single best argument for extraction: not "we need to build retry" but "we should DRY the retry we already have."

2. **`createBudgetAwareInvoker()` is genuinely plug-compatible.** It returns the exact `(invocation: AgentInvocation, persona: Persona) => Promise<AgentResponse>` signature. Both `run-council.ts:350` and `run-pipeline.ts:512` define inline lambdas with the same shape. This is a literal drop-in.

3. **Prompt caching is already working.** `callAnthropicAPI()` implements `cache_control: { type: "ephemeral" }` with `cacheableContext` splitting, and both orchestrators thread `cacheableContext` through. The Anthropic usage response already logs cache hit/miss/creation. This is not future work — it's live.

## Where I DISAGREE

### The `phaseToStage()` "bug" is less severe than stated

The Round 3 analysis flagged that coding phases fall through to `default: 'deliberation'`. But looking at the actual `phaseToStage()` in `budget-integration.ts:17-36`, it maps `DeliberationPhase` values (problem_framing, round_independent, round_interactive, etc.) — **not** coding phase strings. The coding orchestrator has its own phase model and would need its own stage mapper. This isn't a bug in the existing code; it's a missing adapter for coding mode. Small distinction, but important for correctness.

### The "3 providers already return split counts" claim needs nuance

Looking at the actual provider implementations in `llm-caller.ts`:
- **Anthropic** (line 194): Returns `input_tokens` and `output_tokens` separately — confirmed
- **OpenAI** (line 245-249): Returns `prompt_tokens` and `completion_tokens` — confirmed
- **Gemini** (line 286-289): Returns `promptTokenCount` and `candidatesTokenCount` — confirmed

But `CallerResult` (line 71-76) only exposes `tokensUsed: number` (the sum). The split data is computed and then *discarded*. So the budget caller's 75/25 estimate (`budget-aware-caller.ts:93-95`) is unnecessary — we can get exact splits for free by extending the return type. This is a quick win, not a hard problem.

### Budget state persistence is a v1 blocker, not a nice-to-have

If the process crashes mid-deliberation with in-memory-only budget state, the retry layers will restart the phase/consultant — but with budget tracking reset to $0. This means the restarted calls can re-authorize premium tiers that should be budget-blocked. For a $3 cap this is manageable (worst case ~$6 double-spend), but it undermines the guarantee. **10 lines of JSON persistence after each `recordCall()` is the cheapest durability win in the entire spec.**

## What Was MISSED

### 1. The `callLLM()` router has zero retry logic

This is the real gap. `invokeAgentSafe()` retries at the orchestrator level, but `callLLM()` itself (line 298-379) makes a single `fetch()` call with no retry. If the HTTP request fails with a transient network error (not a 429 from the API, but a DNS timeout or TCP reset), the orchestrator-level retry catches it — but with 15-second base delay, which is excessive for network blips. Adding a 1-retry with 1s delay *inside* `callLLM()` for network-level errors would be a complementary hardening.

### 2. No abort signal / timeout enforcement in `callLLM()`

`callLLM()` accepts `timeoutMs` in its options (line 85) but **never uses it**. The `fetch()` calls have no `AbortSignal`. The timeout enforcement relies entirely on the upstream orchestrator's timeout handling (which only the deliberation orchestrator implements). The coding orchestrator calculates elaborate timeout tiers (`run-pipeline.ts:520-522`) that are passed to `callLLM()` — and then ignored.

This is a genuine durability risk: a hung API connection will block the entire pipeline indefinitely.

### 3. The `createBudgetAwareInvoker` ignores persona model preferences

Looking at `budget-integration.ts:81`: `const requestedTier = contextToTier('default', stage)` — this maps stage to tier using the cost-first routing table. But it completely ignores `persona.model` and `persona.provider` from the council config. If a persona is configured as `model: 'claude-sonnet-4-5-20250929'`, the budget-aware caller will override it to `openai-mini` regardless. The invoker needs to consider the persona's configured tier as the *requested* tier, then let `selectTier()` decide whether to honor or downgrade it.

## Has My Position Changed?

**Yes — MORE specific.** Round 3 was directionally right but missed execution details that matter. My refined position:

1. The wiring is even easier than described, but the `createBudgetAwareInvoker` needs a small fix to respect persona model preferences
2. The timeout gap in `callLLM()` is the most under-discussed risk
3. Budget persistence is cheap enough to include in v1

---

## IMPLEMENTATION SPEC

### Section 1: Exact Edits

#### 1.1 Extend `CallerResult` with token split

**File:** `src/cli/llm-caller.ts`
**Function:** Type definition (line 71)
**Change:** Add `inputTokens` and `outputTokens` fields

```typescript
// BEFORE (line 71-76):
export interface CallerResult {
  content: string;
  tokensUsed: number;
  latencyMs: number;
  sessionId?: string;
}

// AFTER:
export interface CallerResult {
  content: string;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  sessionId?: string;
}
```

**File:** `src/cli/llm-caller.ts`
**Function:** `callAnthropicAPI()` return (line 205-209)
**Change:** Include split token counts

```typescript
// BEFORE:
return {
  content,
  tokensUsed: inputTokens + outputTokens,
  latencyMs: Date.now() - start,
};

// AFTER:
return {
  content,
  tokensUsed: inputTokens + outputTokens,
  inputTokens,
  outputTokens,
  latencyMs: Date.now() - start,
};
```

Same pattern for `callOpenAICompatible()` (line 248) and `callGeminiAPI()` (line 287).

#### 1.2 Add `AbortSignal` timeout to `callLLM()`

**File:** `src/cli/llm-caller.ts`
**Function:** `callLLM()` (line 298)
**Change:** Create `AbortSignal.timeout()` and pass to all `fetch()` calls

```typescript
// Add at top of callLLM():
const signal = opts.timeoutMs
  ? AbortSignal.timeout(opts.timeoutMs)
  : undefined;

// Pass to each provider call (e.g., callAnthropicAPI needs signal parameter)
```

#### 1.3 Wire budget-aware invoker into `run-council.ts`

**File:** `src/cli/run-council.ts`
**Function:** `invokeAgent` lambda (line 350-368)
**Change:** Wrap with budget-aware caller

```
BEFORE call chain:
  run-council.ts:invokeAgent() → callLLM() → provider API

AFTER call chain:
  run-council.ts:invokeAgent() → BudgetAwareCaller.call()
    → selectTier() [budget check + downgrade]
    → callLLM() [with possibly different provider/model]
    → recordCall() [update spend tracking]
    → provider API
```

Concrete edit at line 348-368:

```typescript
// BEFORE:
const startTime = Date.now();

const invokeAgent = async (invocation: any, persona: Persona) => {
  log(C.cyan, persona.name, `Thinking... (${persona.model})`);
  const result = await callLLM({
    provider: persona.provider || 'anthropic-api',
    // ...
  });
  log(C.cyan, persona.name, `Done (${result.tokensUsed} tokens, ${(result.latencyMs / 1000).toFixed(1)}s)`);
  return { ...result, sessionId: result.sessionId };
};

// AFTER:
const startTime = Date.now();

// Budget enforcement
const budgetTracker = new BudgetTracker(
  args.budgetCapUSD ? { ...COST_FIRST_BUDGET, runCapUSD: args.budgetCapUSD } : undefined
);
const budgetCaller = new BudgetAwareCaller(budgetTracker, !quietMode);

const invokeAgent = async (invocation: any, persona: Persona) => {
  log(C.cyan, persona.name, `Thinking... (${persona.model})`);

  // Determine stage from council phase
  const phase = council.deliberationState?.currentPhase || 'round_independent';
  const stage = phaseToStage(phase);

  // Map persona's configured model to a tier (respecting persona preferences)
  const requestedTier = personaModelToTier(persona);

  const result = await budgetCaller.call({
    stage,
    requestedTier,
    systemPrompt: invocation.systemPrompt,
    userMessage: invocation.userMessage,
    workingDir: invocation.workingDirectory || workingDir,
    skipTools: invocation.skipTools,
    timeoutMs: invocation.timeoutMs || 900_000,
    enableCache: !args.noCache && (council.deliberation?.enablePromptCaching ?? true),
    cacheableContext: invocation.cacheableContext,
    escalationContext: extractEscalationContext(council),
  });

  log(C.cyan, persona.name,
    `Done (${result.tokensUsed} tokens, $${result.costUSD.toFixed(4)}, ${result.actualTier}, ${(result.latencyMs / 1000).toFixed(1)}s)`
  );
  return { ...result, sessionId: result.sessionId };
};
```

#### 1.4 Wire budget-aware invoker into `run-pipeline.ts`

**File:** `src/cli/run-pipeline.ts`
**Function:** `invokeAgent` lambda (line 512-537)
**Change:** Identical pattern to 1.3, with pipeline-specific stage mapping

```
BEFORE call chain:
  run-pipeline.ts:invokeAgent() → callLLM() → provider API

AFTER call chain:
  run-pipeline.ts:invokeAgent() → BudgetAwareCaller.call()
    → selectTier() → callLLM() → recordCall() → provider API
```

#### 1.5 Add `personaModelToTier()` helper

**File:** `.kondi/workspace/budget-integration.ts`
**Function:** New function
**Change:** Map persona model string to ModelTier for budget routing

```typescript
export function personaModelToTier(persona: Persona): ModelTier {
  const model = persona.model || '';
  const provider = persona.provider || 'anthropic-api';

  if (provider === 'anthropic-api' || model.includes('claude')) {
    return 'anthropic-premium';
  }
  if (model.includes('gpt-4o-mini')) {
    return 'openai-mini';
  }
  if (provider === 'openai-api' || model.includes('gpt')) {
    return 'openai-mid';
  }
  return 'openai-mini'; // default to cheapest
}
```

#### 1.6 Add budget state persistence

**File:** `.kondi/workspace/budget-tracker.ts`
**Function:** `recordCall()` (line 172)
**Change:** Write state to disk after each call

```typescript
// AFTER existing recordCall() body, add:
this.persistState();

// New method:
private persistState(): void {
  try {
    const fs = require('fs');
    const path = require('path');
    const statePath = path.join(process.cwd(), '.kondi', 'budget-state.json');
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(this.state, null, 2));
  } catch {
    // Non-fatal: budget tracking degrades gracefully
  }
}
```

**File:** `.kondi/workspace/budget-tracker.ts`
**Function:** Constructor (line 118)
**Change:** Load persisted state if available

```typescript
constructor(config: BudgetConfig = COST_FIRST_BUDGET) {
  this.config = config;
  this.state = this.loadPersistedState() || {
    totalSpendUSD: 0,
    stageSpend: { context_retrieval: 0, deliberation: 0, synthesis: 0, validation: 0 },
    callHistory: [],
    downgrades: [],
    anthropicCalls: 0,
    anthropicSpend: 0,
  };
}

private loadPersistedState(): BudgetState | null {
  try {
    const fs = require('fs');
    const path = require('path');
    const statePath = path.join(process.cwd(), '.kondi', 'budget-state.json');
    if (fs.existsSync(statePath)) {
      return JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    }
  } catch {}
  return null;
}
```

#### 1.7 Fix `budget-aware-caller.ts` token estimation

**File:** `.kondi/workspace/budget-aware-caller.ts`
**Function:** `call()` (line 92-95)
**Change:** Use actual split tokens from CallerResult

```typescript
// BEFORE:
const inputTokens = Math.floor(result.tokensUsed * 0.75);
const outputTokens = Math.floor(result.tokensUsed * 0.25);

// AFTER:
const inputTokens = result.inputTokens || Math.floor(result.tokensUsed * 0.75);
const outputTokens = result.outputTokens || Math.floor(result.tokensUsed * 0.25);
```

#### 1.8 Extract shared retry utility

**File:** `src/council/shared/with-retry.ts` (NEW)
**Change:** Extract the identical retry pattern from both orchestrators

```typescript
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  backoffMultiplier: number;
  transientPattern: RegExp;
  timeoutPattern?: RegExp;
  timeoutRetries?: number;
  onRetry?: (attempt: number, delayMs: number, error: Error) => void;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  baseDelayMs: 15_000,
  backoffMultiplier: 2,
  transientPattern: /\b(429|529|rate.limit|overloaded|too many requests)\b/i,
  timeoutPattern: /\btimed?\s*out\b/i,
  timeoutRetries: 1,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): Promise<T> {
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const isTransient = config.transientPattern.test(errMsg);
      const isTimeout = config.timeoutPattern?.test(errMsg);

      if (isTimeout && attempt < (config.timeoutRetries ?? 1)) {
        config.onRetry?.(attempt, 0, error as Error);
        continue;
      }

      if (isTransient && attempt < config.maxRetries) {
        const delayMs = config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt);
        // Add jitter: +/- 20%
        const jitter = delayMs * (0.8 + Math.random() * 0.4);
        config.onRetry?.(attempt, jitter, error as Error);
        await new Promise(resolve => setTimeout(resolve, jitter));
        continue;
      }

      throw error;
    }
  }
  throw new Error('Unexpected: exhausted retry loop');
}
```

---

### Section 2: Unified Retry/Fallback Contract

| Property | Value | Notes |
|----------|-------|-------|
| **Retryable error patterns** | `/\b(429\|529\|rate.limit\|overloaded\|too many requests)\b/i` | Matches HTTP 429/529, rate limit messages, overload responses |
| **Timeout error pattern** | `/\btimed?\s*out\b/i` | Matches "timed out", "timeout" |
| **Max transient retries** | 5 | Per-call, covers rate limits and overload |
| **Timeout retries** | 1 | Retry once without backoff |
| **Base delay** | 15,000 ms | Starting backoff for transient errors |
| **Backoff formula** | `baseDelay * 2^attempt * (0.8 + random * 0.4)` | Exponential with +/-20% jitter |
| **Max single-call delay** | 480s (attempt 5: 15s * 2^5 = 480s) | Rarely reached |
| **Per-call timeout** | Enforced via `AbortSignal.timeout(timeoutMs)` in `callLLM()` | Workers: 30min, Opus: 20min, others: 15min |
| **Total timeout budget** | No global timeout; bounded by retry count + budget cap | Budget cap ($3) provides implicit total bound |
| **Idempotence rules** | All LLM calls are stateless (no session state, no conversation ID dependency for budget calls). Re-calling with same prompt is safe. `callLLM()` is pure function of inputs. | CodingOrchestrator tool use may have side effects — but retry is at the prompt level, not the tool execution level |
| **Phase-level retry** | 3 attempts, 120s base, 1.5x backoff | Deliberation only; wraps entire phase |
| **Consultant-level retry** | Configurable: retry(2)/skip/fail | Policy per council config |
| **Shared utility** | `src/council/shared/with-retry.ts` → `withRetry<T>(fn, config)` | Both orchestrators call this instead of inline loops |

---

### Section 3: Test Matrix

| Test Name | Type | Fixtures/Mocks | Pass Criteria |
|-----------|------|----------------|---------------|
| `budget-cutoff-blocks-at-100pct` | Unit | Mock `callLLM` to return 1000 tokens per call. Set `runCapUSD: 0.01`. Call `BudgetAwareCaller.call()` repeatedly. | Call throws `"Budget exceeded: budget:run_cap_100pct"` after spend reaches $0.01. No further `callLLM()` invocations after the throw. |
| `budget-downgrade-at-70pct` | Unit | Mock `callLLM`. Set `runCapUSD: 1.00`. Pre-load `BudgetTracker` state to $0.71 spent. Request `anthropic-premium` tier. | `selectTier()` returns `openai-mini` with reasonCode `budget:70pct_downgrade`. `callLLM()` receives `openai-api` provider and `gpt-4o-mini` model. |
| `budget-blocks-anthropic-at-85pct` | Unit | Mock `callLLM`. Pre-load state to $2.56 of $3.00 cap (85.3%). Request `anthropic-premium` with escalation gates met. | `selectTier()` returns `openai-mid` with reasonCode `budget:85pct_anthropic_block`. |
| `budget-stage-cap-enforcement` | Unit | Mock `callLLM`. Set deliberation stage cap to $0.50. Pre-load $0.49 deliberation spend. | Next deliberation call either downgrades or blocks depending on estimated cost of downgraded tier. |
| `budget-state-persists-across-crashes` | Integration | Create `BudgetTracker`, record 5 calls, verify `.kondi/budget-state.json` exists. Create new `BudgetTracker` instance — verify it loads persisted state. | `newTracker.getState().totalSpendUSD === originalSpend`. Call history length matches. |
| `retry-transient-succeeds-on-3rd` | Unit | Mock `callLLM` to throw `"429 rate limited"` twice, then succeed. | `withRetry()` returns successful result. `callLLM` called exactly 3 times. Delays between calls follow exponential backoff formula. |
| `retry-timeout-retries-once` | Unit | Mock `callLLM` to throw `"request timed out"` once, then succeed. | `withRetry()` returns successful result. `callLLM` called exactly 2 times. No delay between calls. |
| `retry-non-transient-fails-immediately` | Unit | Mock `callLLM` to throw `"401 Unauthorized"`. | `withRetry()` throws immediately. `callLLM` called exactly once. |
| `retry-exhaustion-throws` | Unit | Mock `callLLM` to always throw `"429 rate limited"`. | `withRetry()` throws after 6 attempts (0-5). Error message is the original 429 error. |
| `callerresult-split-tokens-anthropic` | Unit | Mock Anthropic API to return `{ input_tokens: 500, output_tokens: 200 }`. | `CallerResult.inputTokens === 500`, `CallerResult.outputTokens === 200`, `CallerResult.tokensUsed === 700`. |
| `callerresult-split-tokens-openai` | Unit | Mock OpenAI API to return `{ prompt_tokens: 300, completion_tokens: 150 }`. | `CallerResult.inputTokens === 300`, `CallerResult.outputTokens === 150`. |
| `budget-aware-invoker-respects-persona-model` | Integration | Create persona with `model: 'claude-sonnet-4-5-20250929'`, `provider: 'anthropic-api'`. Fresh budget (0% utilization). | `personaModelToTier()` returns `anthropic-premium`. `BudgetAwareCaller` routes to Anthropic. At 85% utilization, same persona downgrades to `openai-mid`. |
| `end-to-end-budget-enforcement` | Integration | Full council run with `--dry-run` replaced by mock LLM that counts calls. Set `runCapUSD: 0.05`. | Council terminates with budget exhaustion before completing all rounds. Final spend <= $0.05. Telemetry shows accurate stage breakdown. |

---

## PROPOSED CONTEXT CHANGE

**What:** Replace the diagnostic narrative in shared context with this condensed integration checklist:

> **Budget Hardening v1 — Integration Checklist**
>
> **Injection points:** `run-council.ts:350` (invokeAgent lambda), `run-pipeline.ts:512` (invokeAgent lambda)
>
> **Edits:** (1) Extend `CallerResult` with `inputTokens`/`outputTokens` in `llm-caller.ts`, (2) Add `AbortSignal.timeout()` to `callLLM()`, (3) Wire `BudgetAwareCaller` into both entry points, (4) Add `personaModelToTier()` to respect persona configs, (5) Persist budget state to `.kondi/budget-state.json`, (6) Fix 75/25 token estimation in `budget-aware-caller.ts`, (7) Extract `withRetry()` to `src/council/shared/with-retry.ts`
>
> **Bug fixes:** Token split estimation → use actual provider data. Missing timeout enforcement → AbortSignal. Persona model ignored by budget router → personaModelToTier().
>
> **Test matrix:** 13 tests (5 budget, 4 retry, 2 token split, 2 integration)

**Why:** The council has converged on approach. Carrying 3 rounds of diagnostic context wastes tokens on re-analysis. The checklist format enables the next round to review code diffs against concrete criteria.
