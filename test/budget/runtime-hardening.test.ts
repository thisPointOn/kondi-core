/**
 * Runtime Hardening Integration Tests
 *
 * Tests the complete runtime hardening system including:
 * 1. Budget cutoff behavior
 * 2. Downgrade transitions
 * 3. Retry idempotence
 * 4. Partial-failure recovery
 * 5. Restart durability
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BudgetTracker, type BudgetConfig, type ModelTier, MODEL_TIERS } from '../../src/budget/budget-tracker';
import { createBudgetAwareInvoker } from '../../src/budget/budget-aware-invoker';
import { saveBudgetState, loadBudgetState, clearBudgetState, type PersistedBudgetState } from '../../src/budget/persistent-budget-state';
import { withRetry, isRetryableError, calculateBackoff } from '../../src/orchestration/shared-retry';
import { mapPhaseToStage, mapStepTypeToStage } from '../../src/budget/phase-stage-map';
import type { Persona } from '../../src/council/types';

// Mock callLLM for integration tests
vi.mock('../../src/cli/llm-caller', () => ({
  callLLM: vi.fn(),
  DEFAULT_MODELS: {
    'anthropic-api': 'claude-sonnet-4-5-20250929',
    'openai-api': 'gpt-4o',
  },
}));

describe('Runtime Hardening - Budget Cutoff', () => {
  let tracker: BudgetTracker;

  beforeEach(() => {
    tracker = new BudgetTracker({
      runCapUSD: 0.05, // Very low cap for testing
      stageCaps: {
        context_retrieval: 0.01,
        deliberation: 0.02,
        synthesis: 0.015,
        validation: 0.005,
      },
    });
  });

  it('should block calls when run cap is reached (100%)', () => {
    // Simulate spend approaching 100% (runCapUSD = 0.05)
    // openai-mini: $0.15 per 1M input, $0.6 per 1M output
    // Need to spend $0.05, so: 300k input tokens + 50k output = ~$0.045 + $0.03 = ~$0.075
    const cost = tracker.calculateCost(300_000, 50_000, 'openai-mini');
    tracker.recordCall('deliberation', cost);

    // Now at ~150% utilization (over cap)
    const runUtil = tracker.getRunUtilization();
    expect(runUtil).toBeGreaterThanOrEqual(100);

    const decision = tracker.selectTier('deliberation', 'anthropic-premium');

    expect(decision.allowed).toBe(false);
    expect(decision.blocked).toBe(true);
    expect(decision.reasonCode).toContain('run_cap_100pct');
  });

  it('should downgrade at 70% run utilization', () => {
    // Simulate spend at 70% of $0.05 = $0.035
    // Use 200k input + 30k output = ~$0.03 + $0.018 = ~$0.048 (96%)
    // Let's use 155k input + 20k output = ~$0.02325 + $0.012 = ~$0.035+ (70%+)
    const cost = tracker.calculateCost(155_000, 20_000, 'openai-mini');
    tracker.recordCall('deliberation', cost);

    const runUtil = tracker.getRunUtilization();
    expect(runUtil).toBeGreaterThanOrEqual(69.5); // Allow floating point errors
    expect(runUtil).toBeLessThan(100);

    // Request anthropic-premium with escalation context (to bypass escalation gates)
    const decision = tracker.selectTier('deliberation', 'anthropic-premium', {
      riskFlag: 'high', // Bypass escalation gates
    });

    expect(decision.allowed).toBe(true);
    expect(decision.tier).toBe('openai-mid');
    expect(decision.reasonCode).toContain('70pct');
  });

  it('should block anthropic calls at 85% run utilization', () => {
    // Simulate spend at 85% of $0.05 = $0.0425
    // Use 200k input + 30k output = ~$0.03 + $0.018 = ~$0.048 (96%)
    // Use 185k input + 25k output = ~$0.02775 + $0.015 = ~$0.04275 (85.5%)
    const cost = tracker.calculateCost(185_000, 25_000, 'openai-mini');
    tracker.recordCall('deliberation', cost);

    const runUtil = tracker.getRunUtilization();
    expect(runUtil).toBeGreaterThanOrEqual(83.5); // Allow floating point errors

    // Request anthropic-premium with escalation context
    const decision = tracker.selectTier('deliberation', 'anthropic-premium', {
      riskFlag: 'high', // Bypass escalation gates
    });

    expect(decision.allowed).toBe(true);
    expect(decision.tier).toBe('openai-mid');
    expect(decision.reasonCode).toContain('85pct');
  });

  it('should enforce stage caps', () => {
    // Fill up deliberation stage cap (stageCaps.deliberation = 0.02)
    // Need to spend ~$0.019 (95% of stage cap)
    // Use 100k input + 15k output = ~$0.015 + $0.009 = ~$0.024 (120% - over cap)
    // Use 80k input + 10k output = ~$0.012 + $0.006 = ~$0.018 (90%)
    const cost = tracker.calculateCost(80_000, 10_000, 'openai-mini');
    tracker.recordCall('deliberation', cost);

    const stageUtil = tracker.getStageUtilization('deliberation');
    expect(stageUtil).toBeGreaterThan(89); // Allow rounding

    // Try another deliberation call
    const decision = tracker.selectTier('deliberation', 'anthropic-premium');

    // Should either downgrade or block
    if (decision.allowed) {
      expect(decision.tier).not.toBe('anthropic-premium');
    } else {
      expect(decision.blocked).toBe(true);
    }
  });
});

describe('Runtime Hardening - Downgrade Transitions', () => {
  let tracker: BudgetTracker;

  beforeEach(() => {
    tracker = new BudgetTracker();
  });

  it('should downgrade anthropic-premium → openai-mid → openai-mini', () => {
    // Trigger 70% downgrade (need $2.1 for 70% of $3.0 run cap)
    // anthropic-premium: $3 per 1M input, $15 per 1M output
    // Use 500k input + 100k output = ~$1.5 + $1.5 = ~$3.0 (100%) - too much
    // Use 352k input + 70k output = ~$1.056 + $1.05 = ~$2.106 (70.2%)
    const cost1 = tracker.calculateCost(352_000, 70_000, 'anthropic-premium');
    tracker.recordCall('deliberation', cost1);

    const runUtil = tracker.getRunUtilization();
    expect(runUtil).toBeGreaterThanOrEqual(69.5); // Allow floating point errors

    // Request anthropic-premium
    const decision1 = tracker.selectTier('deliberation', 'anthropic-premium');
    expect(decision1.tier).toBe('openai-mid');

    // Request openai-mid
    const decision2 = tracker.selectTier('deliberation', 'openai-mid');
    expect(decision2.tier).toBe('openai-mini');
  });

  it('should track downgrade events', () => {
    // Trigger downgrade by reaching 70% utilization
    const cost = tracker.calculateCost(352_000, 70_000, 'anthropic-premium');
    tracker.recordCall('deliberation', cost);

    const decision = tracker.selectTier('deliberation', 'anthropic-premium', {
      riskFlag: 'high', // Bypass escalation gates to trigger budget-based downgrade
    });

    const telemetry = tracker.getTelemetry();
    expect(telemetry.downgrades).toBeGreaterThan(0);
    expect(telemetry.recentDowngrades.length).toBeGreaterThan(0);
    expect(telemetry.recentDowngrades[0].fromTier).toBe('anthropic-premium');
    expect(telemetry.recentDowngrades[0].toTier).toBe('openai-mid');
  });

  it('should respect escalation gates for anthropic-premium', () => {
    // Without escalation context, should downgrade
    const decision1 = tracker.selectTier('deliberation', 'anthropic-premium');
    expect(decision1.tier).not.toBe('anthropic-premium');

    // With escalation context (high risk), should allow
    const decision2 = tracker.selectTier('deliberation', 'anthropic-premium', {
      riskFlag: 'high',
    });
    expect(decision2.tier).toBe('anthropic-premium');
  });
});

describe('Runtime Hardening - Retry Idempotence', () => {
  it('should retry retryable errors', async () => {
    let attempts = 0;

    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Rate limit exceeded');
        }
        return 'success';
      },
      {
        maxRetries: 3,
        baseDelayMs: 10, // Fast for testing
        maxDelayMs: 100,
      }
    );

    expect(result.result).toBe('success');
    expect(result.attempts).toBe(3);
    expect(result.hadRetries).toBe(true);
  });

  it('should not retry non-retryable errors', async () => {
    let attempts = 0;

    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error('Invalid input');
        },
        {
          maxRetries: 3,
          baseDelayMs: 10,
        }
      )
    ).rejects.toThrow('Invalid input');

    expect(attempts).toBe(1); // Only one attempt
  });

  it('should detect retryable error patterns', () => {
    expect(isRetryableError(new Error('Rate limit exceeded'))).toBe(true);
    expect(isRetryableError(new Error('429 Too Many Requests'))).toBe(true);
    expect(isRetryableError(new Error('503 Service Unavailable'))).toBe(true);
    expect(isRetryableError(new Error('ETIMEDOUT'))).toBe(true);
    expect(isRetryableError(new Error('network error'))).toBe(true);

    expect(isRetryableError(new Error('Invalid input'))).toBe(false);
    expect(isRetryableError(new Error('Not found'))).toBe(false);
  });

  it('should apply exponential backoff with jitter', () => {
    const delay0 = calculateBackoff(0, 1000, 30000);
    const delay1 = calculateBackoff(1, 1000, 30000);
    const delay2 = calculateBackoff(2, 1000, 30000);

    // Exponential growth (with jitter, so approximate)
    expect(delay0).toBeGreaterThan(800);
    expect(delay0).toBeLessThan(1200);

    expect(delay1).toBeGreaterThan(1600);
    expect(delay1).toBeLessThan(2400);

    expect(delay2).toBeGreaterThan(3200);
    expect(delay2).toBeLessThan(4800);
  });

  it('should respect timeout in retry loop', async () => {
    const startTime = Date.now();

    await expect(
      withRetry(
        async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          throw new Error('timeout test');
        },
        {
          maxRetries: 5,
          baseDelayMs: 100,
          timeoutMs: 500,
        }
      )
    ).rejects.toThrow();

    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeLessThan(700); // Should timeout before all retries
  });
});

describe('Runtime Hardening - Partial Failure Recovery', () => {
  it('should recover from transient failures without losing the whole run', async () => {
    let callCount = 0;

    const operation = async () => {
      callCount++;

      // Fail on first two calls, succeed on third
      if (callCount <= 2) {
        throw new Error('503 Service Unavailable');
      }

      return { result: 'success', callCount };
    };

    const result = await withRetry(operation, {
      maxRetries: 3,
      baseDelayMs: 10,
    });

    expect(result.result.result).toBe('success');
    expect(result.result.callCount).toBe(3);
    expect(result.hadRetries).toBe(true);
  });

  it('should preserve state across retry attempts', async () => {
    const state = { value: 0 };
    let attempts = 0;

    await withRetry(
      async () => {
        attempts++;
        state.value += 10;

        if (attempts < 2) {
          throw new Error('rate limit');
        }

        return state.value;
      },
      {
        maxRetries: 2,
        baseDelayMs: 10,
      }
    );

    // State should accumulate across attempts
    expect(state.value).toBe(20);
  });
});

describe('Runtime Hardening - Restart Durability', () => {
  beforeEach(() => {
    clearBudgetState();
  });

  afterEach(() => {
    clearBudgetState();
  });

  it('should persist budget state to disk', () => {
    const state: PersistedBudgetState = {
      version: 1,
      runId: 'test-run-123',
      timestamp: new Date().toISOString(),
      totalSpendUSD: 0.5,
      stageSpend: {
        context_retrieval: 0.1,
        deliberation: 0.25,
        synthesis: 0.1,
        validation: 0.05,
      },
      callCount: 10,
      anthropicCalls: 3,
      anthropicSpend: 0.3,
    };

    saveBudgetState(state);

    const loaded = loadBudgetState();
    expect(loaded).not.toBeNull();
    expect(loaded?.totalSpendUSD).toBe(0.5);
    expect(loaded?.stageSpend.deliberation).toBe(0.25);
    expect(loaded?.anthropicCalls).toBe(3);
  });

  it('should restore budget state on startup', () => {
    // Persist some state
    const state: PersistedBudgetState = {
      version: 1,
      runId: 'test-run-456',
      timestamp: new Date().toISOString(),
      totalSpendUSD: 1.2,
      stageSpend: {
        context_retrieval: 0.3,
        deliberation: 0.5,
        synthesis: 0.3,
        validation: 0.1,
      },
      callCount: 20,
      anthropicCalls: 5,
      anthropicSpend: 0.8,
    };

    saveBudgetState(state);

    // Create new invoker with restore
    const invoker = createBudgetAwareInvoker({
      verbose: false,
      restoreState: true,
    });

    const telemetry = invoker.getTelemetry();

    // Should restore spend
    expect(telemetry.totalSpendUSD).toBeGreaterThan(0);
  });

  it('should preserve per-stage spend on restore (not collapse to one stage)', () => {
    const state: PersistedBudgetState = {
      version: 1,
      runId: 'test-run-789',
      timestamp: new Date().toISOString(),
      totalSpendUSD: 0.8,
      stageSpend: {
        context_retrieval: 0.2,
        deliberation: 0.3,
        synthesis: 0.2,
        validation: 0.1,
      },
      callCount: 15,
      anthropicCalls: 4,
      anthropicSpend: 0.5,
    };

    saveBudgetState(state);

    const invoker = createBudgetAwareInvoker({
      verbose: false,
      restoreState: true,
    });

    const tracker = invoker.getTracker();
    const restoredState = tracker.getState();

    // All stages should have their spend restored
    expect(restoredState.stageSpend.context_retrieval).toBeGreaterThan(0);
    expect(restoredState.stageSpend.deliberation).toBeGreaterThan(0);
    expect(restoredState.stageSpend.synthesis).toBeGreaterThan(0);
    expect(restoredState.stageSpend.validation).toBeGreaterThan(0);

    // Total should match
    const total =
      restoredState.stageSpend.context_retrieval +
      restoredState.stageSpend.deliberation +
      restoredState.stageSpend.synthesis +
      restoredState.stageSpend.validation;

    expect(total).toBeCloseTo(0.8, 2);
  });

  it('should handle corrupt state files gracefully', () => {
    // Manually write corrupt state
    const fs = require('fs');
    const path = require('path');
    const statePath = path.join(process.cwd(), '.kondi', 'runtime', 'budget-state.json');

    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, 'CORRUPT JSON{{{', 'utf-8');

    const loaded = loadBudgetState();
    expect(loaded).toBeNull(); // Should return null for corrupt file

    // Clean up
    clearBudgetState();
  });

  it('should handle missing state files gracefully', () => {
    clearBudgetState();

    const loaded = loadBudgetState();
    expect(loaded).toBeNull();
  });
});

describe('Runtime Hardening - Phase/Step Mapping', () => {
  it('should map deliberation phases to budget stages', () => {
    expect(mapPhaseToStage('created')).toBe('context_retrieval');
    expect(mapPhaseToStage('problem_framing')).toBe('context_retrieval');
    expect(mapPhaseToStage('round_independent')).toBe('deliberation');
    expect(mapPhaseToStage('deciding')).toBe('deliberation');
    expect(mapPhaseToStage('reviewing')).toBe('synthesis');
    expect(mapPhaseToStage('testing')).toBe('validation');
    expect(mapPhaseToStage('completed')).toBe('synthesis');
  });

  it('should map pipeline step types to budget stages', () => {
    expect(mapStepTypeToStage('analysis')).toBe('context_retrieval');
    expect(mapStepTypeToStage('council')).toBe('deliberation');
    expect(mapStepTypeToStage('coding')).toBe('deliberation');
    expect(mapStepTypeToStage('review')).toBe('validation');
    expect(mapStepTypeToStage('enrich')).toBe('synthesis');
    expect(mapStepTypeToStage('gate')).toBe('validation');
  });

  it('should handle unknown phases with safe default', () => {
    // Unknown phase should default to 'deliberation' with warning
    const result = mapPhaseToStage('unknown_phase' as any);
    expect(result).toBe('deliberation');
  });

  it('should handle unknown step types with safe default', () => {
    // Unknown step type should default to 'deliberation' with warning
    const result = mapStepTypeToStage('unknown_step' as any);
    expect(result).toBe('deliberation');
  });
});

describe('Runtime Hardening - End-to-End Integration', () => {
  beforeEach(() => {
    clearBudgetState();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearBudgetState();
  });

  const createMockPersona = (): Persona => ({
    id: 'test-persona',
    name: 'Test',
    avatar: '🧪',
    role: 'worker',
    provider: 'anthropic-api',
    model: 'claude-sonnet-4-5-20250929',
    systemPrompt: 'You are a test persona.',
    preferredDeliberationRole: 'worker',
    activeSessionId: null,
    temperature: 0.7,
  });

  it('should block calls via invoke() when budget cap is exhausted', async () => {
    const { callLLM } = await import('../../src/cli/llm-caller');

    // Mock callLLM to return a successful response
    vi.mocked(callLLM).mockResolvedValue({
      content: 'Test response',
      tokensUsed: 1000,
      latencyMs: 100,
    });

    // Create invoker with very low cap
    const invoker = createBudgetAwareInvoker({
      verbose: false,
      restoreState: false,
    });

    const tracker = invoker.getTracker();

    // Exhaust the budget (default cap is $3.0)
    // Spend $3.1 to exceed the cap
    const expensiveCost = tracker.calculateCost(500_000, 100_000, 'anthropic-premium');
    tracker.recordCall('deliberation', expensiveCost); // ~$3.0

    const telemetry = tracker.getTelemetry();
    expect(telemetry.runUtilization).toBeGreaterThanOrEqual(100);

    // Try to invoke another call - should be blocked
    const mockPersona = createMockPersona();

    await expect(
      invoker.invoke({
        stage: 'deliberation',
        requestedTier: 'anthropic-premium',
        persona: mockPersona,
        invocation: {
          systemPrompt: 'Test',
          userMessage: 'Test',
        },
      })
    ).rejects.toThrow(/Budget exceeded/);

    // callLLM should NOT have been called because budget blocked it
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('should downgrade and invoke successfully when approaching budget cap', async () => {
    const { callLLM } = await import('../../src/cli/llm-caller');

    // Mock callLLM to return a successful response with realistic token usage
    vi.mocked(callLLM).mockResolvedValue({
      content: 'Test response from downgraded tier',
      tokensUsed: 2000,
      latencyMs: 150,
    });

    const invoker = createBudgetAwareInvoker({
      verbose: false,
      restoreState: false,
    });

    const tracker = invoker.getTracker();

    // Spend to 72% of budget (default $3.0 cap, so spend $2.16)
    // This should trigger downgrade from anthropic-premium
    const cost = tracker.calculateCost(360_000, 72_000, 'anthropic-premium');
    tracker.recordCall('deliberation', cost);

    const telemetry1 = tracker.getTelemetry();
    expect(telemetry1.runUtilization).toBeGreaterThan(70);
    expect(telemetry1.runUtilization).toBeLessThan(85);

    const mockPersona = createMockPersona();

    // Invoke with anthropic-premium request
    const result = await invoker.invoke({
      stage: 'deliberation',
      requestedTier: 'anthropic-premium',
      persona: mockPersona,
      invocation: {
        systemPrompt: 'Test system prompt',
        userMessage: 'Test message',
      },
      escalationContext: {
        riskFlag: 'high', // Bypass escalation gates to test budget-based downgrade
      },
    });

    // Should have downgraded to openai-mid (70% threshold)
    expect(result.downgraded).toBe(true);
    expect(result.actualTier).toBe('openai-mid');
    expect(result.actualProvider).toBe('openai-api');
    expect(result.reasonCode).toContain('70pct');

    // callLLM should have been called with downgraded tier
    expect(callLLM).toHaveBeenCalledTimes(1);
    expect(callLLM).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai-api',
        model: 'gpt-4o',
      })
    );

    // Budget should have been updated
    const telemetry2 = tracker.getTelemetry();
    expect(telemetry2.totalSpendUSD).toBeGreaterThan(telemetry1.totalSpendUSD);
  });

  it('should complete full invoke chain: retry → recordCall → persist → enforce', async () => {
    const { callLLM } = await import('../../src/cli/llm-caller');

    let callCount = 0;

    // Mock callLLM to fail twice then succeed (test retry chain)
    vi.mocked(callLLM).mockImplementation(async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error('503 Service Unavailable'); // Retryable error
      }
      return {
        content: 'Success after retries',
        tokensUsed: 1500,
        latencyMs: 200,
      };
    });

    const invoker = createBudgetAwareInvoker({
      verbose: false,
      restoreState: false,
    });

    const mockPersona = createMockPersona();

    // Invoke should retry and succeed
    const result = await invoker.invoke({
      stage: 'context_retrieval',
      requestedTier: 'anthropic-premium',
      persona: mockPersona,
      invocation: {
        systemPrompt: 'Test',
        userMessage: 'Test',
      },
      escalationContext: {
        riskFlag: 'high', // Allow anthropic-premium
      },
    });

    // Should have succeeded after retries
    expect(result.content).toBe('Success after retries');
    expect(result.hadRetries).toBe(true);
    expect(result.attempts).toBe(3);
    expect(callCount).toBe(3);

    // Budget should have been recorded
    const tracker = invoker.getTracker();
    const telemetry = tracker.getTelemetry();
    expect(telemetry.totalSpendUSD).toBeGreaterThan(0);
    expect(telemetry.anthropicCalls).toBe(1);

    // State should have been persisted
    const persistedState = loadBudgetState();
    expect(persistedState).not.toBeNull();
    expect(persistedState?.totalSpendUSD).toBeCloseTo(telemetry.totalSpendUSD, 4);
    expect(persistedState?.anthropicCalls).toBe(1);
  });

  it('should enforce downgrade transitions through full invoke path (anthropic → openai-mid → openai-mini)', async () => {
    const { callLLM } = await import('../../src/cli/llm-caller');

    // Mock callLLM to always succeed
    vi.mocked(callLLM).mockResolvedValue({
      content: 'Response',
      tokensUsed: 1000,
      latencyMs: 100,
    });

    const invoker = createBudgetAwareInvoker({
      verbose: false,
      restoreState: false,
    });

    const tracker = invoker.getTracker();
    const mockPersona = createMockPersona();

    // First call: spend to 72% (trigger 70% downgrade)
    const cost1 = tracker.calculateCost(360_000, 72_000, 'anthropic-premium');
    tracker.recordCall('deliberation', cost1);

    // Invoke 1: Should downgrade from anthropic-premium to openai-mid
    const result1 = await invoker.invoke({
      stage: 'deliberation',
      requestedTier: 'anthropic-premium',
      persona: mockPersona,
      invocation: { systemPrompt: 'Test', userMessage: 'Test' },
      escalationContext: { riskFlag: 'high' },
    });

    expect(result1.actualTier).toBe('openai-mid');
    expect(result1.downgraded).toBe(true);

    // Spend more to trigger openai-mid downgrade (reach 70%+ again for openai-mid tier)
    // Current spend: ~$2.16 + result1 cost
    // Need to reach higher utilization to force openai-mid → openai-mini
    // Let's add more spend to push utilization higher
    const cost2 = tracker.calculateCost(50_000, 10_000, 'openai-mid');
    tracker.recordCall('deliberation', cost2);

    // Invoke 2: Request openai-mid, should downgrade to openai-mini at high utilization
    const result2 = await invoker.invoke({
      stage: 'deliberation',
      requestedTier: 'openai-mid',
      persona: { ...mockPersona, provider: 'openai-api', model: 'gpt-4o' },
      invocation: { systemPrompt: 'Test', userMessage: 'Test' },
    });

    // At high utilization, openai-mid should downgrade to openai-mini
    expect(result2.actualTier).toBe('openai-mini');

    // Verify transitions were recorded
    const telemetry = tracker.getTelemetry();
    expect(telemetry.downgrades).toBeGreaterThan(0);
  });

  it('should handle first-call phase attribution correctly (pre-onPhaseChange)', async () => {
    const { callLLM } = await import('../../src/cli/llm-caller');

    vi.mocked(callLLM).mockResolvedValue({
      content: 'Response',
      tokensUsed: 1000,
      latencyMs: 100,
    });

    const invoker = createBudgetAwareInvoker({
      verbose: false,
      restoreState: false,
    });

    const mockPersona = createMockPersona();

    // Simulate first call before any onPhaseChange has been called
    // In run-council.ts, currentPhase is initialized to 'created'
    // This should map to 'context_retrieval' stage
    const result = await invoker.invoke({
      stage: 'context_retrieval', // Explicitly test the initial phase mapping
      requestedTier: 'anthropic-premium',
      persona: mockPersona,
      invocation: {
        systemPrompt: 'Test',
        userMessage: 'Test',
      },
      escalationContext: {
        riskFlag: 'high',
      },
    });

    expect(result.content).toBe('Response');

    // Verify that the call was recorded to the correct stage
    const tracker = invoker.getTracker();
    const state = tracker.getState();

    expect(state.stageSpend.context_retrieval).toBeGreaterThan(0);
    expect(state.totalSpendUSD).toBeGreaterThan(0);

    // Verify that phase mapping works correctly for 'created' phase
    const mappedStage = mapPhaseToStage('created' as any);
    expect(mappedStage).toBe('context_retrieval');
  });

  it('should restore state and continue budget enforcement across restarts', async () => {
    const { callLLM } = await import('../../src/cli/llm-caller');

    vi.mocked(callLLM).mockResolvedValue({
      content: 'Response',
      tokensUsed: 1000,
      latencyMs: 100,
    });

    // First session: spend some budget
    const invoker1 = createBudgetAwareInvoker({
      verbose: false,
      restoreState: false,
    });

    const tracker1 = invoker1.getTracker();
    const cost = tracker1.calculateCost(200_000, 40_000, 'anthropic-premium');
    tracker1.recordCall('deliberation', cost);

    // Manually persist state
    const state1 = tracker1.getState();
    saveBudgetState({
      version: 1,
      runId: 'test-restart',
      timestamp: new Date().toISOString(),
      totalSpendUSD: state1.totalSpendUSD,
      stageSpend: state1.stageSpend,
      callCount: state1.callHistory.length,
      anthropicCalls: state1.anthropicCalls,
      anthropicSpend: state1.anthropicSpend,
    });

    // Second session: restore state and continue
    const invoker2 = createBudgetAwareInvoker({
      verbose: false,
      restoreState: true,
    });

    const tracker2 = invoker2.getTracker();
    const telemetry2 = tracker2.getTelemetry();

    // Should have restored previous spend
    expect(telemetry2.totalSpendUSD).toBeCloseTo(state1.totalSpendUSD, 4);
    expect(telemetry2.anthropicCalls).toBe(state1.anthropicCalls);

    // Make a new call - should add to restored budget
    const mockPersona = createMockPersona();
    await invoker2.invoke({
      stage: 'synthesis',
      requestedTier: 'openai-mini',
      persona: { ...mockPersona, provider: 'openai-api', model: 'gpt-4o-mini' },
      invocation: { systemPrompt: 'Test', userMessage: 'Test' },
    });

    const telemetry3 = tracker2.getTelemetry();
    expect(telemetry3.totalSpendUSD).toBeGreaterThan(telemetry2.totalSpendUSD);
  });
});
