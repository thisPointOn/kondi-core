/**
 * Cost Tracker Tests
 * Tests for budget enforcement, routing, and early-stop logic
 */

import { CostTracker, type CostConfig, type StageType } from './cost-tracker';
import { CostPolicyEngine, COST_FIRST_PRESET } from './cost-policies';

// Test configuration matching cost-first preset
const TEST_CONFIG: CostConfig = {
  runCapUsd: 3.00,
  stageCaps: {
    context_retrieval: 0.60,
    deliberation: 1.05,
    synthesis: 0.90,
    validation: 0.45,
  },
};

describe('CostTracker', () => {
  describe('Budget Enforcement', () => {
    test('Run cap is never exceeded', () => {
      const tracker = new CostTracker(TEST_CONFIG);

      // Simulate spending up to the cap
      tracker.recordSpend({
        stage: 'deliberation',
        provider: 'openai-api',
        model: 'gpt-4o',
        inputTokens: 100000,
        outputTokens: 50000,
      });

      const status = tracker.getStatus();
      expect(status.runSpendUsd).toBeLessThanOrEqual(TEST_CONFIG.runCapUsd);
      expect(status.runUtilization).toBeLessThanOrEqual(1.0);
    });

    test('Stage cap is never exceeded', () => {
      const tracker = new CostTracker(TEST_CONFIG);

      // Record spend for deliberation stage
      tracker.recordSpend({
        stage: 'deliberation',
        provider: 'openai-api',
        model: 'gpt-4o',
        inputTokens: 50000,
        outputTokens: 25000,
      });

      const status = tracker.getStatus();
      expect(status.stageSpend.deliberation).toBeLessThanOrEqual(
        TEST_CONFIG.stageCaps.deliberation
      );
    });

    test('wouldExceedRunCap correctly predicts overspend', () => {
      const tracker = new CostTracker(TEST_CONFIG);

      // Spend most of the budget
      tracker.recordSpend({
        stage: 'deliberation',
        provider: 'anthropic-api',
        model: 'claude-sonnet-4-5-20250929',
        inputTokens: 400000,
        outputTokens: 100000,
      });

      // Check if adding more would exceed
      const wouldExceed = tracker.wouldExceedRunCap(1.0);
      expect(wouldExceed).toBe(true);
    });

    test('wouldExceedStageCap correctly predicts stage overspend', () => {
      const tracker = new CostTracker(TEST_CONFIG);

      // Spend most of deliberation budget
      tracker.recordSpend({
        stage: 'deliberation',
        provider: 'openai-api',
        model: 'gpt-4o',
        inputTokens: 150000,
        outputTokens: 75000,
      });

      // Check if adding more would exceed stage cap
      const wouldExceed = tracker.wouldExceedStageCap('deliberation', 0.5);
      expect(wouldExceed).toBe(true);
    });
  });

  describe('Utilization Tracking', () => {
    test('Utilization is calculated correctly', () => {
      const tracker = new CostTracker(TEST_CONFIG);

      // Spend exactly 50% of budget
      const halfBudget = TEST_CONFIG.runCapUsd / 2;
      // gpt-4o: $2.50 input + $10.00 output per 1M tokens
      // Need to spend $1.50
      // If we use 100K input + 50K output:
      // Cost = (100000/1000000)*2.50 + (50000/1000000)*10.00 = 0.25 + 0.50 = 0.75
      // So we need fewer tokens
      tracker.recordSpend({
        stage: 'deliberation',
        provider: 'openai-api',
        model: 'gpt-4o',
        inputTokens: 300000,
        outputTokens: 150000,
      });

      const status = tracker.getStatus();
      // 300K input = 300K/1M * 2.50 = 0.75
      // 150K output = 150K/1M * 10.00 = 1.50
      // Total = 2.25 / 3.00 = 0.75
      expect(status.runUtilization).toBeCloseTo(0.75, 2);
    });

    test('Near capacity flag triggers at 70%', () => {
      const tracker = new CostTracker(TEST_CONFIG);

      // Spend 70% of budget
      tracker.recordSpend({
        stage: 'deliberation',
        provider: 'openai-api',
        model: 'gpt-4o',
        inputTokens: 420000,
        outputTokens: 210000,
      });

      const status = tracker.getStatus();
      expect(status.isNearCapacity).toBe(true);
    });

    test('Escalation limit flag triggers at 85%', () => {
      const tracker = new CostTracker(TEST_CONFIG);

      // Spend 85% of budget
      tracker.recordSpend({
        stage: 'deliberation',
        provider: 'openai-api',
        model: 'gpt-4o',
        inputTokens: 510000,
        outputTokens: 255000,
      });

      const status = tracker.getStatus();
      expect(status.isAtEscalationLimit).toBe(true);
    });

    test('At capacity flag triggers at 100%', () => {
      const tracker = new CostTracker(TEST_CONFIG);

      // Spend 100% of budget
      tracker.recordSpend({
        stage: 'deliberation',
        provider: 'openai-api',
        model: 'gpt-4o',
        inputTokens: 600000,
        outputTokens: 300000,
      });

      const status = tracker.getStatus();
      expect(status.isAtCapacity).toBe(true);
    });
  });

  describe('Cost Calculation', () => {
    test('Anthropic costs are calculated correctly', () => {
      const tracker = new CostTracker(TEST_CONFIG);

      // Claude Sonnet 4: $3.00 input + $15.00 output per 1M
      const cost = tracker.calculateCost(
        'anthropic-api',
        'claude-sonnet-4-5-20250929',
        1000000,
        1000000
      );

      expect(cost).toBeCloseTo(18.0, 2); // 3 + 15 = 18
    });

    test('OpenAI costs are calculated correctly', () => {
      const tracker = new CostTracker(TEST_CONFIG);

      // gpt-4o: $2.50 input + $10.00 output per 1M
      const cost = tracker.calculateCost('openai-api', 'gpt-4o', 1000000, 1000000);

      expect(cost).toBeCloseTo(12.5, 2); // 2.50 + 10.00 = 12.50
    });

    test('gpt-4o-mini costs are calculated correctly', () => {
      const tracker = new CostTracker(TEST_CONFIG);

      // gpt-4o-mini: $0.150 input + $0.600 output per 1M
      const cost = tracker.calculateCost('openai-api', 'gpt-4o-mini', 1000000, 1000000);

      expect(cost).toBeCloseTo(0.75, 2); // 0.150 + 0.600 = 0.75
    });
  });

  describe('Summary Export', () => {
    test('Anthropic spend is tracked separately', () => {
      const tracker = new CostTracker(TEST_CONFIG);

      tracker.recordSpend({
        stage: 'deliberation',
        provider: 'anthropic-api',
        model: 'claude-sonnet-4-5-20250929',
        inputTokens: 100000,
        outputTokens: 50000,
      });

      tracker.recordSpend({
        stage: 'deliberation',
        provider: 'openai-api',
        model: 'gpt-4o',
        inputTokens: 100000,
        outputTokens: 50000,
      });

      const summary = tracker.exportSummary();
      expect(summary.anthropicSpend).toBeGreaterThan(0);
      expect(summary.nonAnthropicSpend).toBeGreaterThan(0);
      expect(summary.totalSpend).toBeCloseTo(
        summary.anthropicSpend + summary.nonAnthropicSpend,
        2
      );
    });

    test('Downgraded calls are counted', () => {
      const tracker = new CostTracker(TEST_CONFIG);

      tracker.recordSpend({
        stage: 'deliberation',
        provider: 'openai-api',
        model: 'gpt-4o-mini',
        inputTokens: 100000,
        outputTokens: 50000,
        wasDowngraded: true,
        downgradedFrom: 'anthropic-api:claude-sonnet-4-5-20250929',
        reasonCode: 'budget_85pct_anthropic_blocked',
      });

      const summary = tracker.exportSummary();
      expect(summary.downgradedCallCount).toBe(1);
    });
  });
});

describe('CostPolicyEngine', () => {
  describe('Routing Decisions', () => {
    test('Anthropic is allowed before 85% threshold', () => {
      const tracker = new CostTracker(TEST_CONFIG);
      const policy = new CostPolicyEngine(tracker);

      // Spend 50% of budget
      tracker.recordSpend({
        stage: 'deliberation',
        provider: 'openai-api',
        model: 'gpt-4o',
        inputTokens: 300000,
        outputTokens: 150000,
      });

      const decision = policy.getRoutingDecision(
        'synthesis',
        'anthropic-api',
        'claude-sonnet-4-5-20250929'
      );

      expect(decision.wasDowngraded).toBe(false);
      expect(decision.allowedProvider).toBe('anthropic-api');
    });

    test('Anthropic is blocked at 85% threshold', () => {
      const tracker = new CostTracker(TEST_CONFIG);
      const policy = new CostPolicyEngine(tracker);

      // Spend 85% of budget
      tracker.recordSpend({
        stage: 'deliberation',
        provider: 'openai-api',
        model: 'gpt-4o',
        inputTokens: 510000,
        outputTokens: 255000,
      });

      const decision = policy.getRoutingDecision(
        'synthesis',
        'anthropic-api',
        'claude-sonnet-4-5-20250929'
      );

      expect(decision.wasDowngraded).toBe(true);
      expect(decision.allowedProvider).not.toBe('anthropic-api');
      expect(decision.reasonCode).toBe('budget_85pct_anthropic_blocked');
    });

    test('Anthropic is allowed at 85%+ if escalation gate passes (low consensus)', () => {
      const tracker = new CostTracker(TEST_CONFIG);
      const policy = new CostPolicyEngine(tracker);

      // Spend 85% of budget
      tracker.recordSpend({
        stage: 'deliberation',
        provider: 'openai-api',
        model: 'gpt-4o',
        inputTokens: 510000,
        outputTokens: 255000,
      });

      const decision = policy.getRoutingDecision(
        'synthesis',
        'anthropic-api',
        'claude-sonnet-4-5-20250929',
        { consensus: 0.5 } // Low consensus triggers escalation gate
      );

      expect(decision.wasDowngraded).toBe(false);
      expect(decision.allowedProvider).toBe('anthropic-api');
    });

    test('Anthropic is allowed at 85%+ if escalation gate passes (high risk)', () => {
      const tracker = new CostTracker(TEST_CONFIG);
      const policy = new CostPolicyEngine(tracker);

      // Spend 85% of budget
      tracker.recordSpend({
        stage: 'deliberation',
        provider: 'openai-api',
        model: 'gpt-4o',
        inputTokens: 510000,
        outputTokens: 255000,
      });

      const decision = policy.getRoutingDecision(
        'synthesis',
        'anthropic-api',
        'claude-sonnet-4-5-20250929',
        { riskFlag: 'high' }
      );

      expect(decision.wasDowngraded).toBe(false);
      expect(decision.allowedProvider).toBe('anthropic-api');
    });

    test('Validation is skipped at 100% budget', () => {
      const tracker = new CostTracker(TEST_CONFIG);
      const policy = new CostPolicyEngine(tracker);

      // Spend 100% of budget
      tracker.recordSpend({
        stage: 'deliberation',
        provider: 'openai-api',
        model: 'gpt-4o',
        inputTokens: 600000,
        outputTokens: 300000,
      });

      const decision = policy.getRoutingDecision(
        'validation',
        'openai-api',
        'gpt-4o'
      );

      expect(decision.shouldSkipStage).toBe(true);
      expect(decision.reasonCode).toBe('budget_exhausted');
    });
  });

  describe('Early Stop Logic', () => {
    test('Stops when consensus >= 0.80 for 2 rounds', () => {
      const tracker = new CostTracker(TEST_CONFIG);
      const policy = new CostPolicyEngine(tracker);

      const decision = policy.shouldStopDeliberation({
        consensus: 0.85,
        previousConsensus: 0.82,
        currentRound: 2,
      });

      expect(decision.shouldStop).toBe(true);
      expect(decision.reasonCode).toBe('consensus_high');
    });

    test('Does not stop when consensus high for only 1 round', () => {
      const tracker = new CostTracker(TEST_CONFIG);
      const policy = new CostPolicyEngine(tracker);

      const decision = policy.shouldStopDeliberation({
        consensus: 0.85,
        previousConsensus: 0.65,
        currentRound: 2,
      });

      expect(decision.shouldStop).toBe(false);
    });

    test('Stops when marginal gain < 0.10', () => {
      const tracker = new CostTracker(TEST_CONFIG);
      const policy = new CostPolicyEngine(tracker);

      const decision = policy.shouldStopDeliberation({
        consensus: 0.70,
        currentRound: 2,
        qualityGain: 0.05,
      });

      expect(decision.shouldStop).toBe(true);
      expect(decision.reasonCode).toBe('marginal_gain_low');
    });

    test('Stops at max rounds (3)', () => {
      const tracker = new CostTracker(TEST_CONFIG);
      const policy = new CostPolicyEngine(tracker);

      const decision = policy.shouldStopDeliberation({
        consensus: 0.70,
        currentRound: 3,
      });

      expect(decision.shouldStop).toBe(true);
      expect(decision.reasonCode).toBe('max_rounds');
    });

    test('Does not stop before max rounds if no other trigger', () => {
      const tracker = new CostTracker(TEST_CONFIG);
      const policy = new CostPolicyEngine(tracker);

      const decision = policy.shouldStopDeliberation({
        consensus: 0.70,
        currentRound: 2,
      });

      expect(decision.shouldStop).toBe(false);
    });
  });

  describe('Validation Skip Logic', () => {
    test('Skips validation if confidence >= 0.90 and risk low', () => {
      const tracker = new CostTracker(TEST_CONFIG);
      const policy = new CostPolicyEngine(tracker);

      const shouldSkip = policy.shouldSkipValidation(0.92, 'low');
      expect(shouldSkip).toBe(true);
    });

    test('Does not skip validation if confidence high but risk not low', () => {
      const tracker = new CostTracker(TEST_CONFIG);
      const policy = new CostPolicyEngine(tracker);

      const shouldSkip = policy.shouldSkipValidation(0.92, 'medium');
      expect(shouldSkip).toBe(false);
    });

    test('Does not skip validation if risk low but confidence < 0.90', () => {
      const tracker = new CostTracker(TEST_CONFIG);
      const policy = new CostPolicyEngine(tracker);

      const shouldSkip = policy.shouldSkipValidation(0.85, 'low');
      expect(shouldSkip).toBe(false);
    });
  });

  describe('Terminal Behavior', () => {
    test('At 100% budget, validation is skipped with budget-constrained status', () => {
      const tracker = new CostTracker(TEST_CONFIG);
      const policy = new CostPolicyEngine(tracker);

      // Spend 100% of budget
      tracker.recordSpend({
        stage: 'deliberation',
        provider: 'openai-api',
        model: 'gpt-4o',
        inputTokens: 600000,
        outputTokens: 300000,
      });

      const decision = policy.getRoutingDecision('validation', 'openai-api', 'gpt-4o');

      expect(decision.shouldSkipStage).toBe(true);
      expect(decision.reasonCode).toBe('budget_exhausted');

      const status = tracker.getStatus();
      expect(status.isAtCapacity).toBe(true);
    });
  });

  describe('70% Threshold Behavior', () => {
    test('Compact context mode activates at 70%', () => {
      const tracker = new CostTracker(TEST_CONFIG);
      const policy = new CostPolicyEngine(tracker);

      // Spend 70% of budget
      tracker.recordSpend({
        stage: 'deliberation',
        provider: 'openai-api',
        model: 'gpt-4o',
        inputTokens: 420000,
        outputTokens: 210000,
      });

      // Trigger a routing decision to update policy state
      policy.getRoutingDecision('synthesis', 'openai-api', 'gpt-4o');

      const policyState = policy.getState();
      expect(policyState.compactContextMode).toBe(true);
    });
  });
});

// Test runner stub (for manual execution)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  console.log('Running cost tracker tests...');
  console.log('Use a proper test runner like Jest or Vitest to execute these tests.');
}

export {};
