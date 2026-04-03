# End-to-End Runtime Integration Tests - Complete

## Overview
This revision adds comprehensive end-to-end integration tests that exercise the full budget-aware invocation chain through `createBudgetAwareInvoker().invoke()` with mocked `callLLM` dependencies. All tests verify the complete flow: retry wrapper → `recordCall()` → immediate persistence → enforcement behavior.

## Test Results
```
Test Files  1 passed (1)
Tests       29 passed (29)
Duration    3.65s
```

## New Integration Tests Added

### 1. Budget Cap Exhaustion via invoke() (Blocking)
**File:** `test/budget/runtime-hardening.test.ts:510-557`

Tests that when the budget cap is exhausted (100% utilization), calls to `invoke()` are blocked before reaching `callLLM()`.

**Verified behavior:**
- Budget is exhausted by recording $3.0+ spend (100%+ of default $3.0 cap)
- Call to `invoke()` throws `Budget exceeded` error
- `callLLM` is NOT called (budget enforcement blocks at decision layer)
- Error message includes reason code

**Key assertions:**
```typescript
expect(telemetry.runUtilization).toBeGreaterThanOrEqual(100);
await expect(invoker.invoke(...)).rejects.toThrow(/Budget exceeded/);
expect(callLLM).not.toHaveBeenCalled();
```

### 2. Downgrade via invoke() (Full Path)
**File:** `test/budget/runtime-hardening.test.ts:559-602`

Tests that approaching the budget cap triggers downgrade through the full invoke path, with `callLLM` actually being called with downgraded tier.

**Verified behavior:**
- Spend 72% of budget to trigger 70% downgrade threshold
- Request `anthropic-premium` tier
- Invoke downgrades to `openai-mid` and calls `callLLM` with downgraded tier
- Budget is updated after call
- Downgrade metadata is recorded

**Key assertions:**
```typescript
expect(result.downgraded).toBe(true);
expect(result.actualTier).toBe('openai-mid');
expect(result.reasonCode).toContain('70pct');
expect(callLLM).toHaveBeenCalledWith(expect.objectContaining({
  provider: 'openai-api',
  model: 'gpt-4o',
}));
```

### 3. Full Chain: Retry → recordCall → Persist → Enforce
**File:** `test/budget/runtime-hardening.test.ts:604-651`

Tests the complete invocation chain including retry logic, budget recording, and state persistence.

**Verified behavior:**
- Mock `callLLM` to fail twice (503 errors) then succeed
- Retry logic kicks in (retryable error detection)
- Call succeeds after 3 attempts
- Budget is recorded with Anthropic-specific counters
- State is immediately persisted to disk
- Persisted state matches tracker telemetry

**Key assertions:**
```typescript
expect(result.hadRetries).toBe(true);
expect(result.attempts).toBe(3);
expect(telemetry.anthropicCalls).toBe(1);
expect(persistedState?.totalSpendUSD).toBeCloseTo(telemetry.totalSpendUSD, 4);
expect(persistedState?.anthropicCalls).toBe(1);
```

### 4. Multi-Tier Downgrade Cascade
**File:** `test/budget/runtime-hardening.test.ts:653-698`

Tests downgrade transitions through the full invoke path: anthropic-premium → openai-mid → openai-mini.

**Verified behavior:**
- Spend to 72% utilization
- Invoke with `anthropic-premium` request → downgrades to `openai-mid`
- Continue spending
- Invoke with `openai-mid` request → downgrades to `openai-mini`
- All transitions are recorded in telemetry

**Key assertions:**
```typescript
expect(result1.actualTier).toBe('openai-mid');
expect(result1.downgraded).toBe(true);
expect(result2.actualTier).toBe('openai-mini');
expect(telemetry.downgrades).toBeGreaterThan(0);
```

### 5. First-Call Phase Attribution
**File:** `test/budget/runtime-hardening.test.ts:700-735`

Tests that the first call before any `onPhaseChange` callback is correctly attributed to the initial phase/stage.

**Verified behavior:**
- Call `invoke()` with `context_retrieval` stage (matching initial phase 'created')
- Budget is recorded to correct stage
- Phase mapping from 'created' → 'context_retrieval' is verified

**Key assertions:**
```typescript
expect(state.stageSpend.context_retrieval).toBeGreaterThan(0);
expect(mapPhaseToStage('created' as any)).toBe('context_retrieval');
```

### 6. Restart Durability with Continued Enforcement
**File:** `test/budget/runtime-hardening.test.ts:737-783`

Tests that budget state persists across restarts and continues enforcing caps from restored state.

**Verified behavior:**
- First session: record some spend and persist state
- Second session: restore state and verify restored values
- Make new call in second session
- Budget accumulates correctly from restored baseline

**Key assertions:**
```typescript
expect(telemetry2.totalSpendUSD).toBeCloseTo(state1.totalSpendUSD, 4);
expect(telemetry2.anthropicCalls).toBe(state1.anthropicCalls);
expect(telemetry3.totalSpendUSD).toBeGreaterThan(telemetry2.totalSpendUSD);
```

## Code Changes

### 1. Runtime Phase Initialization (run-council.ts)
**File:** `src/cli/run-council.ts:360-362`

Added explicit documentation for initial phase value:
```typescript
// Track current phase dynamically for budget stage mapping
// Initialize to 'created' to ensure first call (before onPhaseChange) maps to 'context_retrieval'
let currentPhase: string = 'created';
```

**Rationale:** Ensures deterministic phase attribution for first call before any `onPhaseChange` callback fires. 'created' phase maps to 'context_retrieval' stage, which is appropriate for initial context gathering.

### 2. Pipeline Phase Initialization (run-pipeline.ts)
**File:** `src/cli/run-pipeline.ts:519-521`

Added explicit documentation for initial step type:
```typescript
// Track current step type for budget stage mapping
// Initialize to 'council' to ensure first call (before step execution) maps to 'deliberation'
let currentStepType: string = 'council';
```

**Rationale:** Ensures deterministic phase attribution for first call. 'council' step type maps to 'deliberation' stage, which is appropriate for pipeline execution start.

### 3. Test Mocking Infrastructure
**File:** `test/budget/runtime-hardening.test.ts:22-30`

Added vitest mocking for `callLLM`:
```typescript
vi.mock('../../src/cli/llm-caller', () => ({
  callLLM: vi.fn(),
  DEFAULT_MODELS: { ... },
}));
```

**Rationale:** Allows integration tests to call the full `invoke()` path without making actual API calls, while still testing retry logic, error handling, budget recording, and persistence.

## Coverage Matrix

All 5 required test scenarios are now covered with end-to-end integration tests:

| Scenario | Coverage | Test Location |
|----------|----------|---------------|
| 1. Budget cutoff blocks calls | ✅ Full invoke path | Lines 510-557 |
| 2. Downgrade transitions | ✅ Full invoke path with fixtures | Lines 559-602, 653-698 |
| 3. Retry idempotence | ✅ Full chain with retry | Lines 604-651 |
| 4. Partial-failure recovery | ✅ Full chain with transient errors | Lines 604-651 |
| 5. Restart durability | ✅ Persist → restore → continue | Lines 737-783 |

**Additional coverage:**
- First-call phase attribution (deterministic initial mapping)
- Multi-tier downgrade cascade (anthropic → openai-mid → openai-mini)
- Budget recording to correct stages

## Verification Commands

```bash
# Run all runtime hardening tests
npm test -- test/budget/runtime-hardening.test.ts

# Run specific integration test
npm test -- -t "should block calls via invoke"
npm test -- -t "should downgrade and invoke successfully"
npm test -- -t "full invoke chain"

# Run all budget tests
npm test -- test/budget/

# Type check
npx tsc --noEmit
```

## Test Execution Time
- **Total duration:** 3.65s
- **29 tests:** All passing
- **No flaky tests:** All tests use mocked dependencies and deterministic fixtures

## Known Issues
None. All 29 tests pass consistently.

## References
- Budget tracker: `src/budget/budget-tracker.ts`
- Budget-aware invoker: `src/budget/budget-aware-invoker.ts`
- Persistent state: `src/budget/persistent-budget-state.ts`
- Phase mapping: `src/budget/phase-stage-map.ts`
- Shared retry: `src/orchestration/shared-retry.ts`
