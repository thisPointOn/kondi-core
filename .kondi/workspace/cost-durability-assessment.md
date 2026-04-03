# Cost & Durability Assessment — Opportunity-Forward Analysis

**Analyst:** General Consultant (Optimist lens)  
**Date:** 2026-04-02  
**Scope:** Runtime cost controls, retry/fallback durability, token amplification, test coverage

---

## Executive Summary

The kondi-council codebase has **strong architectural bones** for cost control and durability. The budget system (`.kondi/workspace/budget-tracker.ts`, `budget-aware-caller.ts`, `budget-integration.ts`) is well-designed with tier-based downgrade logic, stage caps, escalation gates, and early-stop heuristics. The coding orchestrator already has transient-retry with exponential backoff (5 retries, 15s base). **The gap is integration, not invention** — the budget machinery exists but isn't wired into the production runtime path. This is a tractable, bounded problem.

---

## Assessment of Key Challenges

### 1. CRITICAL: Budget enforcement exists but is disconnected from runtime

**Evidence (verified by code inspection):**
- `budget-tracker.ts` (workspace) — complete `BudgetTracker` class with `selectTier()`, `shouldEarlyStop()`, stage caps, downgrade logic
- `budget-aware-caller.ts` (workspace) — `BudgetAwareCaller` wrapping `callLLM()` with cost recording
- `budget-integration.ts` (workspace) — `createBudgetAwareInvoker()` factory that maps phases to stages
- `src/cli/llm-caller.ts` — production `callLLM()` has **zero** imports from budget modules
- `src/council/deliberation-orchestrator.ts` — `invokeAgentSafe()` calls `this.config.invokeAgent()` with no budget gate
- `src/council/coding-orchestrator.ts` — same pattern, no budget interception

**Grep proof:** `import.*budget` across `src/` returns **zero results**. The only "budget" references in `src/` are `contextTokenBudget` (a prompt-size limiter, not a cost control).

**The opportunity:** The integration surface is clean. `budget-integration.ts` already provides `createBudgetAwareInvoker()` — a drop-in replacement for the `AgentInvoker` type. Wiring it in is a ~50-line change in the CLI runner where `invokeAgent` is constructed.

### 2. HIGH: Retry/fallback is solid in CodingOrchestrator, absent in DeliberationOrchestrator

**Evidence:**
- `coding-orchestrator.ts` lines 962-993: `invokeAgentSafe()` has proper transient retry — 5 retries, 15s exponential backoff, matches 429/529/rate-limit/overloaded patterns. Additionally, lines 306-329 have phase-level rate-limit recovery (120s base, 1.5x backoff, 3 attempts) that re-enters the workflow from the current phase.
- `deliberation-orchestrator.ts`: The same method name exists but I confirmed it has a **different, simpler** implementation. The deliberation path runs through `runFullDeliberation() → continueDeliberation() → runIndependentRound()` etc., and while there's a loop guard (`maxLoopIterations`), individual agent calls lack the same structured retry.

**The opportunity:** The retry pattern in `CodingOrchestrator.invokeAgentSafe()` is production-ready and can be extracted into a shared utility. Both orchestrators use the same `AgentInvoker` interface, so a retry-wrapping decorator is straightforward.

### 3. HIGH: Token amplification from multi-persona prompts

**Evidence:**
- `prompts.ts` `buildPersonaSystemPrompt()` (line 51-101): Each persona call includes full system prompt + identity block + council context + shared context + guidelines + turn-specific instructions
- `buildConversationContext()` (line 106-131): Includes last 10 messages as full text
- `buildIndependentAnalysisPrompt()` (line 870-898): Full context content passed to every consultant
- Context bootstrapping in both orchestrators injects full directory scan into `cacheableContext`
- Multi-round deliberation: each round sends full ledger context via `formatEntriesForContext()`

**The silver lining:** Anthropic prompt caching is already implemented in `callAnthropicAPI()` (lines 145-209) with `cache_control: { type: "ephemeral" }`. The `cacheableContext` parameter is threaded through both orchestrators. Cache hit logging shows savings percentage. This means the bootstrap context (often the largest piece) gets ~90% input token cost reduction on hits.

**Remaining opportunity:** The `maxWordsPerResponse` limiter exists (coding-orchestrator line 934-950) but is only applied in the coding path. Applying it in the deliberation path too would reduce output token costs. Also, `buildManagerRoundSummaryPrompt()` exists but may not always be used to compress inter-round context — forcing it would reduce input growth.

### 4. HIGH: Test coverage is prototype-grade

**Evidence:**
- `package.json` line 16: `"test": "npx tsx src/cli/run-council.ts --task 'test' --dry-run"` — this is a smoke test, not a test suite
- `budget-tracker.test.ts` exists in workspace but isn't referenced from any test runner
- No test files found under `src/` matching `*.test.ts` or `*.spec.ts`

**The opportunity:** The budget tracker already has a test file. The orchestrators have clear, testable contracts (phase transitions are defined as static tables, `invokeAgentSafe` has clear retry semantics). A focused test matrix targeting budget cutoffs, retry behavior, and early-stop conditions is achievable in a single sprint.

### 5. MEDIUM: Config sprawl without cost policy defaults

**Evidence:**
- `src/council/types.ts` line 699: `contextTokenBudget` defaults to 80000 tokens
- `src/council/factory.ts` line 145: same default
- Council configs under `configs/councils/` can specify any provider/model per persona
- No field in the council config schema for `runCapUSD`, `stageCaps`, or tier routing

**The opportunity:** The `BudgetConfig` type already defines the right shape. Adding it to the council validation schema (`src/council/validation.ts`) as an optional field with sensible defaults (like the existing `COST_FIRST_BUDGET`) means every council automatically gets cost protection.

### 6. MEDIUM: Integration adapters don't share execution contract

**Evidence:** Integrations under `integrations/` (langgraph-js, mastra, openai-agents-sdk) each have their own `node_modules` and presumably their own calling patterns. They don't import from `src/cli/llm-caller.ts`.

**Assessment:** This is less critical than it appears. The integrations are adapters for *external* frameworks, not the core runtime. The cost/durability controls need to be solid in `src/` — integrations inherit protection if they use the council API rather than raw LLM calls.

---

## Recommended Approach

**Priority order (highest ROI first):**

### Phase 1: Wire budget into runtime (1-2 days)
1. In the CLI runner where `invokeAgent` is constructed, wrap it with `createBudgetAwareInvoker()` from `budget-integration.ts`
2. Add `BudgetConfig` as an optional field to council types and validation schema
3. Thread `BudgetTracker.getTelemetry()` into the existing CLI status display

### Phase 2: Unify retry/fallback (1 day)
1. Extract `invokeAgentSafe()` retry logic from `CodingOrchestrator` into a shared `src/council/retry.ts`
2. Have both orchestrators use the shared retry wrapper
3. Add provider fallback: if Anthropic returns 5xx after retries, fall back to OpenAI (the budget tier system already supports this — just need a `catch` → `callLLM with fallback provider`)

### Phase 3: Token cost reduction (1 day)
1. Apply `maxWordsPerResponse` in DeliberationOrchestrator's `invokeAgentSafe`
2. Force round summaries (`buildManagerRoundSummaryPrompt`) as context for rounds 3+ instead of full ledger
3. Add a `compactMode` flag (triggered at 70% budget per existing logic) that truncates context

### Phase 4: Test matrix (2 days)
1. Unit tests for `BudgetTracker`: cap enforcement, tier selection, downgrade paths, early-stop conditions
2. Integration test: mock `callLLM`, run a 3-round deliberation, verify budget tracking
3. Failure tests: simulate 429s, verify retry/fallback, verify budget isn't double-charged on retries

---

## Risks and Concerns

| Risk | Severity | Mitigation |
|------|----------|------------|
| Budget integration changes call semantics (provider/model selection moves from persona config to budget policy) | Medium | Make budget enforcement opt-in via config flag; when absent, use persona's provider/model as today |
| Prompt caching depends on 5-minute TTL — long deliberations may miss cache | Low | Already handled: cache miss creates new entry. Cost is write penalty (~1.25x), not full re-read |
| `budget-integration.ts` has a typo on line 153 (`t.runUtil ization` — space in property name) | Low | Fix before integrating |
| Retry delays (up to 15s × 2^5 = 480s) could make workflows feel stuck | Medium | Add `onAgentTimeout` callback (already in orchestrator config) to surface wait status in UI |

---

## Tradeoffs to Consider

1. **Cost control vs. quality ceiling:** The cost-first routing defaults everything to `openai-mini`. This is great for cost but may produce lower-quality deliberation. Consider a "quality-first" preset that starts at `anthropic-premium` with aggressive downgrade, vs. the current "cost-first" that starts cheap and only escalates.

2. **Retry persistence vs. fail-fast:** The current CodingOrchestrator retries up to 5 times with exponential backoff (max ~8 minutes total wait). For interactive CLI users, this is a long time. Consider a `--fail-fast` flag that reduces retries to 1 for development/testing.

3. **Per-persona provider vs. budget-controlled routing:** Today, each persona can have its own provider (Anthropic, OpenAI, Gemini). Budget routing overrides this. Users who specifically want Claude for the "manager" persona may be surprised when budget downgrades it to GPT-4o-mini. Clear logging (already in `BudgetAwareCaller`) mitigates this, but consider a `pinProvider: true` persona option that exempts specific roles from downgrade.

4. **Integration adapter scope:** Hardening the core `src/` path is sufficient for now. Integrations that bypass `callLLM()` are outside the cost control boundary by design — document this clearly rather than trying to enforce budget across all adapters.

---

## PROPOSED CONTEXT CHANGE

**What:** Add the contents of `.kondi/workspace/budget-integration.ts` and `.kondi/workspace/budget-aware-caller.ts` to the shared analysis context, since they contain the actual integration surface that connects the budget system to the runtime.

**Why:** Other consultants analyzing durability and cost need to see that the integration code *already exists* and just needs wiring — this changes the recommendation from "build budget system" to "connect budget system," which is a much smaller and lower-risk scope of work.
