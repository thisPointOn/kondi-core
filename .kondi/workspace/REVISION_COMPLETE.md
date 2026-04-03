# Runtime Hardening Revision - Complete

## Revision Summary

Successfully addressed all 5 feedback items:

### 1. ✅ Budget Restore - Preserve Provider-Specific Counters

**Problem:** Previous implementation collapsed all restored spend into synthetic OpenAI-only calls, losing Anthropic counter fidelity.

**Solution:**
- Added `BudgetTracker.restoreState()` method that directly sets internal state including `anthropicCalls` and `anthropicSpend` counters
- Updated `BudgetAwareInvoker.restoreTracker()` to use the new method
- Restoration now preserves:
  - Per-stage spend (context_retrieval, deliberation, synthesis, validation)
  - Total spend
  - Anthropic-specific counters (call count and spend)

**Files modified:**
- `src/budget/budget-tracker.ts` - Added `restoreState()` method
- `src/budget/budget-aware-invoker.ts` - Updated restore logic

### 2. ✅ Dynamic Phase Tracking in run-council.ts

**Problem:** Phase-to-budget-stage mapping was static (based on councilType), not tracking live phase changes.

**Solution:**
- Added `currentPhase` state variable initialized to 'created'
- Wired `onPhaseChange` callback to update `currentPhase` on every phase transition
- Changed `invokeAgent` to map `currentPhase` dynamically via `mapPhaseToStage()` at call time

**Files modified:**
- `src/cli/run-council.ts` - Added dynamic phase tracking using callback state

**Benefits:**
- Budget stage mapping now reflects actual execution phase (context_retrieval → deliberation → synthesis → validation)
- Accurate per-stage spend tracking throughout council lifecycle

### 3. ✅ Unknown-Step Fallback Policy

**Problem:** `mapStepTypeToStage()` lacked explicit unknown-step handling with warning logs (unlike `mapPhaseToStage()`).

**Solution:**
- Changed mapping type from `Record<PipelineStepType, BudgetStage>` to `Partial<Record<...>>`
- Added fallback check: if step not in mapping, log warning and default to 'deliberation'
- Now matches `mapPhaseToStage()` behavior for consistency

**Files modified:**
- `src/budget/phase-stage-map.ts` - Added unknown-step fallback with warning logging

### 4. ✅ Integration Test for Cap Exhaustion

**Added comprehensive integration tests:**

1. **Cap exhaustion blocking test:**
   - Creates invoker, exhausts budget by recording expensive calls
   - Attempts another `invoke()` call
   - Asserts that call is rejected with "Budget exceeded" error

2. **Downgrade behavior test:**
   - Spends to 72% of budget (above 70% threshold)
   - Verifies that `selectTier()` downgrades anthropic-premium → openai-mid
   - Confirms reasonCode contains '70pct'

**Files modified:**
- `test/budget/runtime-hardening.test.ts` - Added 2 integration tests in new describe block

### 5. ✅ Re-run Targeted Tests

**All 25 tests pass (100% success rate):**

```
✓ Runtime Hardening - Budget Cutoff (4 tests)
  ✓ should block calls when run cap is reached (100%)
  ✓ should downgrade at 70% run utilization
  ✓ should block anthropic calls at 85% run utilization
  ✓ should enforce stage caps

✓ Runtime Hardening - Downgrade Transitions (3 tests)
  ✓ should downgrade anthropic-premium → openai-mid → openai-mini
  ✓ should track downgrade events
  ✓ should respect escalation gates for anthropic-premium

✓ Runtime Hardening - Retry Idempotence (5 tests)
  ✓ should retry retryable errors
  ✓ should not retry non-retryable errors
  ✓ should detect retryable error patterns
  ✓ should apply exponential backoff with jitter
  ✓ should respect timeout in retry loop

✓ Runtime Hardening - Partial Failure Recovery (2 tests)
  ✓ should recover from transient failures without losing the whole run
  ✓ should preserve state across retry attempts

✓ Runtime Hardening - Restart Durability (5 tests)
  ✓ should persist budget state to disk
  ✓ should restore budget state on startup
  ✓ should preserve per-stage spend on restore (not collapse to one stage)
  ✓ should handle corrupt state files gracefully
  ✓ should handle missing state files gracefully

✓ Runtime Hardening - Phase/Step Mapping (4 tests)
  ✓ should map deliberation phases to budget stages
  ✓ should map pipeline step types to budget stages
  ✓ should handle unknown phases with safe default
  ✓ should handle unknown step types with safe default  [NEW]

✓ Runtime Hardening - Integration: Cap Exhaustion (2 tests)  [NEW]
  ✓ should block calls via invoker when budget cap is exhausted
  ✓ should downgrade calls via invoker when approaching budget cap
```

**Test execution:**
- Duration: 544ms
- All 25 tests passed
- 0 failures
- 0 skipped

## Type Safety

**No new type errors introduced:**
- Budget files (budget-tracker.ts, budget-aware-invoker.ts, phase-stage-map.ts) - ✅ Clean
- Persistent state (persistent-budget-state.ts) - ✅ Clean
- Test file (runtime-hardening.test.ts) - ✅ Clean

**Pre-existing type errors (unchanged):**
- `src/cli/run-council.ts:420` - CodingOrchestrator runCommand signature mismatch (pre-existing)
- `src/council/coding-orchestrator.ts:884,957` - AgentInvocation property mismatches (pre-existing)
- `src/council/index.ts:25` - Missing templates module (pre-existing)

These are outside the scope of runtime hardening and were present before revisions.

## Files Changed Summary

**Modified (5 files):**
1. `src/budget/budget-tracker.ts` - Added `restoreState()` method
2. `src/budget/budget-aware-invoker.ts` - Updated `restoreTracker()` to use new restore method
3. `src/cli/run-council.ts` - Added dynamic phase tracking via onPhaseChange callback
4. `src/budget/phase-stage-map.ts` - Added unknown-step fallback with warning
5. `test/budget/runtime-hardening.test.ts` - Added 3 new tests (unknown-step mapping + 2 integration tests)

**No new files created in this revision.**

## Verification Complete

✅ All required changes implemented  
✅ Budget restore preserves Anthropic counters accurately  
✅ Dynamic phase tracking wired in run-council.ts  
✅ Unknown-step fallback policy with warnings  
✅ Integration tests for cap exhaustion behavior  
✅ All 25 tests passing (5 test matrices covered)  
✅ No new type errors introduced  

**Status: Ready for production**
