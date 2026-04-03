# Optimist Review — Runtime Hardening (Round 2)

**Verdict: STRONG DELIVERY — the prior gaps are closed. Two smaller refinements remain, neither blocking.**

## What Improved Since Last Review

The worker addressed the two gaps I flagged:

1. **E2E integration tests now call `invoke()` with mocked `callLLM`.** Six new tests (lines 515-840) exercise the full chain: `invoke()` → `withRetry()` → mocked `callLLM` → `recordCall()` → `persistState()`. The downgrade test (line 560) asserts on `actualTier`, `actualProvider`, and the actual `callLLM` arguments — this is real integration coverage, not just unit-level decision tests. The cascade test (line 680) proves the full anthropic → openai-mid → openai-mini path.

2. **First-call phase attribution is documented** in both `run-council.ts` (line 361) and `run-pipeline.ts` (line 520), with safe initial values that map to deterministic budget stages.

29/29 tests passing. All 5 required test scenarios are covered with genuine invoke-chain tests.

## Two Remaining Refinements (Non-blocking)

### 1. Token cost split is hardcoded at 75/25 (input/output)
`budget-aware-invoker.ts:144-146` estimates 75% input, 25% output tokens. For synthesis-heavy phases where output dominates, this **underestimates cost** (output tokens are 3-5x pricier). Budget enforcement will be looser than intended — runs could overshoot caps by ~15-30% in output-heavy scenarios. Not a showstopper, but worth fixing: either surface separate input/output counts from `callLLM`, or use a more conservative 60/40 split.

### 2. Persistence tests lack filesystem isolation
`saveBudgetState()`/`loadBudgetState()` write to real `.kondi/runtime/` or `$TMPDIR`. No per-test temp directory or fs mock. Tests may leave artifacts or conflict in parallel CI. Low risk in practice but easy to fix with a test-scoped temp dir.

## Bottom Line

The architecture is clean, the wiring is live in both runtimes, persistence is crash-safe, retry is unified, and the test matrix is complete. The two items above are iterate-next refinements, not blockers. **This is ready to ship.**

**Score: 9/10**
