#!/usr/bin/env npx tsx
/**
 * Runtime Hardening Integration Tests
 *
 * Tests for budget integration, downgrade behavior, retry logic,
 * partial-failure recovery, and restart durability.
 *
 * Run with: npx tsx runtime-hardening.test.ts
 */

import { BudgetTracker, COST_FIRST_BUDGET, MODEL_TIERS, type ModelTier } from '../../src/budget/budget-tracker';
import { createBudgetAwareInvoker } from '../../src/budget/budget-aware-invoker';
import { loadBudgetState, saveBudgetState, clearBudgetState, createRunId, type PersistedBudgetState } from '../../src/budget/persistent-budget-state';
import { withRetry, isRetryableError, calculateBackoff } from '../../src/orchestration/shared-retry';
import { mapPhaseToStage, mapStepTypeToStage } from '../../src/budget/phase-stage-map';

// Simple test runner
class TestRunner {
  private passed = 0;
  private failed = 0;
  private tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];

  test(name: string, fn: () => void | Promise<void>) {
    this.tests.push({ name, fn });
  }

  async run() {
    console.log('\n=== Running Runtime Hardening Tests ===\n');

    for (const { name, fn } of this.tests) {
      try {
        await fn();
        this.passed++;
        console.log(`✓ ${name}`);
      } catch (error) {
        this.failed++;
        console.log(`✗ ${name}`);
        console.log(`  Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    console.log(`\n=== Results: ${this.passed} passed, ${this.failed} failed ===\n`);
    process.exit(this.failed > 0 ? 1 : 0);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEquals(actual: any, expected: any, message?: string) {
  if (actual !== expected) {
    throw new Error(
      `${message || 'Assertion failed'}: expected ${expected}, got ${actual}`
    );
  }
}

function assertGreaterThan(actual: number, threshold: number, message?: string) {
  if (actual <= threshold) {
    throw new Error(
      `${message || 'Assertion failed'}: expected ${actual} > ${threshold}`
    );
  }
}

function assertLessThan(actual: number, threshold: number, message?: string) {
  if (actual >= threshold) {
    throw new Error(
      `${message || 'Assertion failed'}: expected ${actual} < ${threshold}`
    );
  }
}

const runner = new TestRunner();

// ============================================================================
// Test 1: Budget Cutoff — Cap Reached Blocks Further Calls
// ============================================================================

runner.test('Budget cutoff: 100% cap blocks further calls', () => {
  const tracker = new BudgetTracker();

  // Simulate spending to 100%
  for (let i = 0; i < 100; i++) {
    const cost = tracker.calculateCost(10000, 2000, 'openai-mid');
    tracker.recordCall('deliberation', cost);
    if (tracker.getRunUtilization() >= 100) break;
  }

  const decision = tracker.selectTier('deliberation', 'openai-mid', {});
  assertEquals(decision.allowed, false, 'Should block calls at 100% cap');
  assertEquals(decision.reasonCode, 'budget:run_cap_100pct', 'Should have correct reason code');
});

// ============================================================================
// Test 2: Downgrade — Tier/Provider/Model Transitions Under Budget Pressure
// ============================================================================

runner.test('Downgrade: anthropic → openai-mid at 85% utilization', () => {
  const tracker = new BudgetTracker();

  // Spend to 85%+
  while (tracker.getRunUtilization() < 85) {
    const cost = tracker.calculateCost(10000, 2000, 'openai-mid');
    tracker.recordCall('deliberation', cost);
  }

  // Pass escalation gates with low consensus
  const decision = tracker.selectTier('deliberation', 'anthropic-premium', {
    consensus: 0.70, // < 0.80, so escalation gates pass
    confidence: 0.60,
  });

  assertEquals(decision.tier, 'openai-mid', 'Should downgrade anthropic to openai-mid');
  assert(decision.reasonCode.includes('85pct'), 'Should have 85% reason code');
});

runner.test('Downgrade: openai-mid → openai-mini at 70% utilization', () => {
  const tracker = new BudgetTracker();

  // Spend to 70%+
  while (tracker.getRunUtilization() < 70) {
    const cost = tracker.calculateCost(10000, 2000, 'openai-mid');
    tracker.recordCall('deliberation', cost);
  }

  const decision = tracker.selectTier('deliberation', 'openai-mid', {});
  assertEquals(decision.tier, 'openai-mini', 'Should downgrade openai-mid to openai-mini');
  assert(decision.reasonCode.includes('70pct'), 'Should have 70% reason code');
});

// ============================================================================
// Test 3: Retry Idempotence — Retries Do Not Duplicate Side Effects
// ============================================================================

runner.test('Retry idempotence: retries tracked correctly', async () => {
  let callCount = 0;
  let failuresUntilSuccess = 2;

  const result = await withRetry(
    async () => {
      callCount++;
      if (callCount <= failuresUntilSuccess) {
        throw new Error('Rate limit exceeded'); // Retryable error
      }
      return 'success';
    },
    { maxRetries: 3 }
  );

  assertEquals(result.result, 'success', 'Should eventually succeed');
  assertEquals(result.attempts, 3, 'Should take 3 attempts (2 failures + 1 success)');
  assert(result.hadRetries, 'Should have retries');
  assertEquals(callCount, 3, 'Should make exactly 3 calls (no duplicate side effects)');
});

runner.test('Retry: non-retryable error fails immediately', async () => {
  let callCount = 0;

  try {
    await withRetry(
      async () => {
        callCount++;
        throw new Error('Invalid input'); // Non-retryable error
      },
      { maxRetries: 3 }
    );
    assert(false, 'Should have thrown error');
  } catch (error) {
    assertEquals(callCount, 1, 'Should only make 1 call for non-retryable error');
    assert(error instanceof Error && error.message === 'Invalid input', 'Should throw original error');
  }
});

// ============================================================================
// Test 4: Partial-Failure Recovery — Transient Failure Recovers
// ============================================================================

runner.test('Partial-failure recovery: transient error recovers', async () => {
  let attemptCount = 0;

  const result = await withRetry(
    async () => {
      attemptCount++;
      if (attemptCount === 1) {
        throw new Error('Timeout'); // Transient retryable error
      }
      return { data: 'success', tokens: 1000 };
    },
    { maxRetries: 2 }
  );

  assertEquals(result.result.data, 'success', 'Should recover from transient failure');
  assertEquals(result.attempts, 2, 'Should take 2 attempts');
  assert(result.hadRetries, 'Should have retries');
});

// ============================================================================
// Test 5: Restart Durability — Persisted State Survives Restart
// ============================================================================

runner.test('Restart durability: persisted state survives restart', () => {
  // Clear any existing state
  clearBudgetState();

  const runId = createRunId();

  // Create initial state
  const initialState: PersistedBudgetState = {
    version: 1,
    runId,
    timestamp: new Date().toISOString(),
    totalSpendUSD: 1.5,
    stageSpend: {
      context_retrieval: 0.3,
      deliberation: 0.8,
      synthesis: 0.3,
      validation: 0.1,
    },
    callCount: 15,
    anthropicCalls: 3,
    anthropicSpend: 0.75,
  };

  // Save state
  saveBudgetState(initialState);

  // Load state (simulating restart)
  const loadedState = loadBudgetState();

  assert(loadedState !== null, 'Should load state');
  assertEquals(loadedState.totalSpendUSD, 1.5, 'Should preserve total spend');
  assertEquals(loadedState.callCount, 15, 'Should preserve call count');
  assertEquals(loadedState.anthropicCalls, 3, 'Should preserve anthropic calls');
  assertEquals(loadedState.stageSpend.deliberation, 0.8, 'Should preserve stage spend');

  // Clean up
  clearBudgetState();
});

runner.test('Restart durability: corrupted state handles gracefully', async () => {
  // Clear any existing state
  clearBudgetState();

  // Manually write corrupted state
  const fs = await import('node:fs');
  const path = await import('node:path');
  const statePath = path.join(process.cwd(), '.kondi', 'runtime', 'budget-state.json');

  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, 'invalid json{{{', 'utf-8');
  } catch (err) {
    // Skip test if can't write
    return;
  }

  // Load state (should handle gracefully)
  const loadedState = loadBudgetState();

  assertEquals(loadedState, null, 'Should return null for corrupted state');

  // Clean up
  clearBudgetState();
});

// ============================================================================
// Phase/Stage Mapping Tests
// ============================================================================

runner.test('Phase-to-stage mapping: all phases map correctly', () => {
  assertEquals(mapPhaseToStage('problem_framing'), 'context_retrieval');
  assertEquals(mapPhaseToStage('round_independent'), 'deliberation');
  assertEquals(mapPhaseToStage('deciding'), 'deliberation');
  assertEquals(mapPhaseToStage('reviewing'), 'synthesis');
  assertEquals(mapPhaseToStage('code_reviewing'), 'validation');
  assertEquals(mapPhaseToStage('completed'), 'synthesis');
});

runner.test('Step-type-to-stage mapping: all types map correctly', () => {
  assertEquals(mapStepTypeToStage('council'), 'deliberation');
  assertEquals(mapStepTypeToStage('analysis'), 'context_retrieval');
  assertEquals(mapStepTypeToStage('coding'), 'deliberation');
  assertEquals(mapStepTypeToStage('review'), 'validation');
  assertEquals(mapStepTypeToStage('enrich'), 'synthesis');
});

// ============================================================================
// Retry Utility Tests
// ============================================================================

runner.test('Retry: retryable error detection', () => {
  assert(isRetryableError(new Error('Rate limit exceeded')), 'Should detect rate limit error');
  assert(isRetryableError(new Error('429 Too Many Requests')), 'Should detect 429 error');
  assert(isRetryableError(new Error('ETIMEDOUT')), 'Should detect timeout error');
  assert(isRetryableError(new Error('Network error occurred')), 'Should detect network error');
  assert(!isRetryableError(new Error('Invalid input')), 'Should not detect invalid input as retryable');
  assert(!isRetryableError(new Error('Unauthorized')), 'Should not detect auth error as retryable');
});

runner.test('Retry: exponential backoff calculation', () => {
  // Attempt 0: ~1s (1000ms base)
  const delay0 = calculateBackoff(0, 1000, 30000);
  assert(delay0 >= 800 && delay0 <= 1200, `Attempt 0 delay should be ~1s, got ${delay0}ms`);

  // Attempt 1: ~2s (2000ms)
  const delay1 = calculateBackoff(1, 1000, 30000);
  assert(delay1 >= 1600 && delay1 <= 2400, `Attempt 1 delay should be ~2s, got ${delay1}ms`);

  // Attempt 2: ~4s (4000ms)
  const delay2 = calculateBackoff(2, 1000, 30000);
  assert(delay2 >= 3200 && delay2 <= 4800, `Attempt 2 delay should be ~4s, got ${delay2}ms`);

  // Attempt 5: capped at 30s
  const delay5 = calculateBackoff(5, 1000, 30000);
  assert(delay5 <= 36000, `Attempt 5 delay should be capped at ~30s, got ${delay5}ms`);
});

// ============================================================================
// Integration Test: Full Budget Lifecycle
// ============================================================================

runner.test('Integration: budget lifecycle with persistence', () => {
  // Clear state
  clearBudgetState();

  const tracker = new BudgetTracker();

  // Simulate some calls
  for (let i = 0; i < 5; i++) {
    const cost = tracker.calculateCost(5000, 1000, 'openai-mini');
    tracker.recordCall('deliberation', cost);
  }

  const state = tracker.getState();

  // Save state
  const persistedState: PersistedBudgetState = {
    version: 1,
    runId: createRunId(),
    timestamp: new Date().toISOString(),
    totalSpendUSD: state.totalSpendUSD,
    stageSpend: state.stageSpend,
    callCount: state.callHistory.length,
    anthropicCalls: state.anthropicCalls,
    anthropicSpend: state.anthropicSpend,
  };

  saveBudgetState(persistedState);

  // Verify persistence
  const loaded = loadBudgetState();
  assert(loaded !== null, 'Should load state');
  assertEquals(loaded.totalSpendUSD, state.totalSpendUSD, 'Should match total spend');

  // Clean up
  clearBudgetState();
});

// Run all tests
runner.run();
