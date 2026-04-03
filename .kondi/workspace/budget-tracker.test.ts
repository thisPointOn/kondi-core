#!/usr/bin/env npx tsx
/**
 * Budget Tracker Tests
 *
 * Run with: npx tsx budget-tracker.test.ts
 */

import { BudgetTracker, COST_FIRST_BUDGET, MODEL_TIERS, type ModelTier } from './budget-tracker';

// Simple test runner
class TestRunner {
  private passed = 0;
  private failed = 0;
  private tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];

  test(name: string, fn: () => void | Promise<void>) {
    this.tests.push({ name, fn });
  }

  async run() {
    console.log('\n=== Running Budget Tracker Tests ===\n');

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

// Tests
const runner = new TestRunner();

runner.test('Budget tracker initializes with default config', () => {
  const tracker = new BudgetTracker();
  const config = tracker.getConfig();
  assertEquals(config.runCapUSD, 3.0, 'Run cap should be $3.00');
  assertEquals(config.stageCaps.context_retrieval, 0.6, 'Context retrieval cap should be $0.60');
  assertEquals(tracker.getRunUtilization(), 0, 'Initial utilization should be 0%');
});

runner.test('Cost calculation is accurate', () => {
  const tracker = new BudgetTracker();
  const cost = tracker.calculateCost(10000, 2000, 'openai-mini');

  // openai-mini: $0.15/1M input, $0.6/1M output
  // Expected: (10000/1M * 0.15) + (2000/1M * 0.6) = 0.0015 + 0.0012 = 0.0027
  const expected = 0.0027;
  assert(Math.abs(cost.costUSD - expected) < 0.0001, `Cost should be ~${expected}, got ${cost.costUSD}`);
});

runner.test('Recording calls updates spend correctly', () => {
  const tracker = new BudgetTracker();
  const cost = tracker.calculateCost(10000, 2000, 'openai-mini');

  tracker.recordCall('deliberation', cost);
  const state = tracker.getState();

  assert(state.totalSpendUSD > 0, 'Total spend should increase');
  assert(state.stageSpend.deliberation > 0, 'Stage spend should increase');
});

runner.test('Run cap enforcement at 100%', () => {
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

runner.test('85% gate blocks anthropic calls', () => {
  const tracker = new BudgetTracker();

  // Spend to 85%+
  while (tracker.getRunUtilization() < 85) {
    const cost = tracker.calculateCost(10000, 2000, 'openai-mid');
    tracker.recordCall('deliberation', cost);
  }

  // Pass escalation gates with low consensus, but budget should still block at 85%
  const decision = tracker.selectTier('deliberation', 'anthropic-premium', {
    consensus: 0.70, // < 0.80, so escalation gates pass
    confidence: 0.60,
  });
  assertEquals(decision.tier, 'openai-mid', 'Should downgrade anthropic to openai-mid');
  assert(decision.reasonCode.includes('85pct'), 'Should have 85% reason code');
});

runner.test('70% gate triggers downgrade', () => {
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

runner.test('Stage cap enforcement', () => {
  const tracker = new BudgetTracker();

  // Spend context_retrieval stage to near cap ($0.60)
  while (tracker.getState().stageSpend.context_retrieval < 0.55) {
    const cost = tracker.calculateCost(10000, 2000, 'openai-mid');
    tracker.recordCall('context_retrieval', cost);
  }

  const decision = tracker.selectTier('context_retrieval', 'openai-mid', {});
  assertEquals(decision.tier, 'openai-mini', 'Should downgrade due to stage cap');
  assert(decision.reasonCode.includes('stage_cap'), 'Should have stage_cap reason code');
});

runner.test('Escalation gates: low consensus allows anthropic', () => {
  const tracker = new BudgetTracker();
  const decision = tracker.selectTier('synthesis', 'anthropic-premium', {
    consensus: 0.70, // < 0.80 threshold
    confidence: 0.60,
  });

  assertEquals(decision.tier, 'anthropic-premium', 'Should allow anthropic with low consensus');
  assertEquals(decision.reasonCode, 'allowed', 'Should be allowed');
});

runner.test('Escalation gates: high risk allows anthropic', () => {
  const tracker = new BudgetTracker();
  const decision = tracker.selectTier('synthesis', 'anthropic-premium', {
    riskFlag: 'high',
    confidence: 0.60,
  });

  assertEquals(decision.tier, 'anthropic-premium', 'Should allow anthropic with high risk');
});

runner.test('Escalation gates: high confidence blocks anthropic', () => {
  const tracker = new BudgetTracker();
  const decision = tracker.selectTier('synthesis', 'anthropic-premium', {
    consensus: 0.90, // High consensus
    confidence: 0.85, // High confidence (>= 0.75)
  });

  assertEquals(decision.tier, 'openai-mid', 'Should downgrade anthropic with high confidence');
  assertEquals(decision.reasonCode, 'escalation:gates_not_met', 'Should have escalation reason');
});

runner.test('Early stop: consensus 2 rounds', () => {
  const tracker = new BudgetTracker();
  const result = tracker.shouldEarlyStop({
    consensus: 0.82,
    previousConsensus: 0.85,
    roundNumber: 2,
  });

  assertEquals(result.stop, true, 'Should stop with high consensus for 2 rounds');
  assertEquals(result.reasonCode, 'early_stop:consensus_2rounds', 'Should have correct reason');
});

runner.test('Early stop: max rounds', () => {
  const tracker = new BudgetTracker();
  const result = tracker.shouldEarlyStop({
    roundNumber: 3,
  });

  assertEquals(result.stop, true, 'Should stop at round 3');
  assertEquals(result.reasonCode, 'early_stop:max_rounds_3', 'Should have max rounds reason');
});

runner.test('Early stop: low quality gain', () => {
  const tracker = new BudgetTracker();
  const result = tracker.shouldEarlyStop({
    qualityGain: 0.05, // < 0.10 threshold
    roundNumber: 2,
  });

  assertEquals(result.stop, true, 'Should stop with low quality gain');
  assertEquals(result.reasonCode, 'early_stop:low_quality_gain', 'Should have quality gain reason');
});

runner.test('Early stop: high confidence low risk', () => {
  const tracker = new BudgetTracker();
  const result = tracker.shouldEarlyStop({
    confidence: 0.92,
    riskFlag: 'low',
    roundNumber: 2,
  });

  assertEquals(result.stop, true, 'Should stop with high confidence and low risk');
  assert(result.reasonCode.includes('high_confidence'), 'Should have confidence reason');
});

runner.test('Anthropic call tracking', () => {
  const tracker = new BudgetTracker();

  const anthropicCost = tracker.calculateCost(10000, 2000, 'anthropic-premium');
  tracker.recordCall('synthesis', anthropicCost);

  const telemetry = tracker.getTelemetry();
  assertEquals(telemetry.anthropicCalls, 1, 'Should track anthropic calls');
  assertGreaterThan(telemetry.anthropicSpend, 0, 'Should track anthropic spend');
});

runner.test('Downgrade recording', () => {
  const tracker = new BudgetTracker();

  // Trigger 70% downgrade
  while (tracker.getRunUtilization() < 70) {
    const cost = tracker.calculateCost(10000, 2000, 'openai-mid');
    tracker.recordCall('deliberation', cost);
  }

  // Pass escalation gates so we actually test the 70% downgrade path
  tracker.selectTier('deliberation', 'anthropic-premium', {
    consensus: 0.70, // Passes escalation gates
    confidence: 0.60,
  });

  const telemetry = tracker.getTelemetry();
  assertGreaterThan(telemetry.downgrades, 0, 'Should record downgrades');
  assert(telemetry.recentDowngrades.length > 0, 'Should have recent downgrades');
});

runner.test('Never exceed run cap in normal operation', () => {
  const tracker = new BudgetTracker();

  // Simulate many calls
  for (let i = 0; i < 200; i++) {
    const decision = tracker.selectTier('deliberation', 'openai-mid', {});
    if (!decision.allowed) break;

    const cost = tracker.calculateCost(5000, 1000, decision.tier);
    tracker.recordCall('deliberation', cost);
  }

  assertLessThan(tracker.getRunUtilization(), 101, 'Run utilization should never exceed 100%');
});

runner.test('Never exceed stage cap in normal operation', () => {
  const tracker = new BudgetTracker();

  // Simulate many calls to one stage
  for (let i = 0; i < 100; i++) {
    const decision = tracker.selectTier('context_retrieval', 'openai-mid', {});
    if (!decision.allowed) break;

    const cost = tracker.calculateCost(3000, 500, decision.tier);
    tracker.recordCall('context_retrieval', cost);
  }

  assertLessThan(
    tracker.getStageUtilization('context_retrieval'),
    101,
    'Stage utilization should never exceed 100%'
  );
});

// Run tests
runner.run();
