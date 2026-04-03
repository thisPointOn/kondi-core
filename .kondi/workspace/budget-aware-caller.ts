/**
 * Budget-Aware LLM Caller
 *
 * Wraps the LLM caller with budget enforcement and cost tracking.
 * Implements routing, downgrade logic, and telemetry.
 */

import { BudgetTracker, StageType, ModelTier, MODEL_TIERS, CallCost } from './budget-tracker';
import { callLLM, type CallerResult } from '../../src/cli/llm-caller';

export interface BudgetAwareCallOpts {
  stage: StageType;
  requestedTier: ModelTier;
  systemPrompt: string;
  userMessage: string;
  workingDir?: string;
  skipTools?: boolean;
  timeoutMs?: number;
  enableCache?: boolean;
  cacheableContext?: string;
  maxTokens?: number;
  // Escalation context for anthropic-premium gating
  escalationContext?: {
    consensus?: number;
    confidence?: number;
    riskFlag?: 'high' | 'medium' | 'low';
    disagreement?: number;
    roundNumber?: number;
  };
}

export interface BudgetAwareResult extends CallerResult {
  actualTier: ModelTier;
  actualProvider: string;
  actualModel: string;
  costUSD: number;
  reasonCode: string;
  downgraded: boolean;
}

/**
 * Budget-aware LLM caller
 */
export class BudgetAwareCaller {
  private tracker: BudgetTracker;
  private verbose: boolean;

  constructor(tracker: BudgetTracker, verbose: boolean = true) {
    this.tracker = tracker;
    this.verbose = verbose;
  }

  /**
   * Call LLM with budget enforcement
   */
  async call(opts: BudgetAwareCallOpts): Promise<BudgetAwareResult> {
    const { stage, requestedTier, escalationContext } = opts;

    // Check budget and determine tier
    const decision = this.tracker.selectTier(stage, requestedTier, escalationContext || {});

    // If blocked, throw error
    if (!decision.allowed) {
      throw new Error(`Budget exceeded: ${decision.reasonCode}`);
    }

    const actualTier = decision.tier;
    const tierConfig = MODEL_TIERS[actualTier];
    const downgraded = actualTier !== requestedTier;

    // Log downgrade
    if (downgraded && this.verbose) {
      console.log(
        `[Budget] Downgraded ${requestedTier} → ${actualTier} (${decision.reasonCode})`
      );
    }

    // Call LLM
    const result = await callLLM({
      provider: tierConfig.provider,
      model: tierConfig.model,
      systemPrompt: opts.systemPrompt,
      userMessage: opts.userMessage,
      workingDir: opts.workingDir,
      skipTools: opts.skipTools,
      timeoutMs: opts.timeoutMs,
      enableCache: opts.enableCache,
      cacheableContext: opts.cacheableContext,
      maxTokens: opts.maxTokens,
    });

    // Calculate actual cost (estimate based on tokens used)
    // Note: CallerResult.tokensUsed is total tokens, we estimate 75% input, 25% output
    const inputTokens = Math.floor(result.tokensUsed * 0.75);
    const outputTokens = Math.floor(result.tokensUsed * 0.25);
    const cost = this.tracker.calculateCost(inputTokens, outputTokens, actualTier);

    // Record call
    this.tracker.recordCall(stage, cost, decision.reasonCode);

    // Log telemetry
    if (this.verbose) {
      const telemetry = this.tracker.getTelemetry();
      console.log(
        `[Budget] Spend: $${telemetry.totalSpendUSD.toFixed(4)} ` +
        `(${telemetry.runUtilization.toFixed(1)}% of run cap) | ` +
        `Stage ${stage}: ${telemetry.stageUtilization[stage].toFixed(1)}% | ` +
        `Anthropic: ${telemetry.anthropicCalls} calls, $${telemetry.anthropicSpend.toFixed(4)}`
      );
    }

    return {
      ...result,
      actualTier,
      actualProvider: tierConfig.provider,
      actualModel: tierConfig.model,
      costUSD: cost.costUSD,
      reasonCode: decision.reasonCode,
      downgraded,
    };
  }

  /**
   * Get current telemetry
   */
  getTelemetry() {
    return this.tracker.getTelemetry();
  }

  /**
   * Get budget tracker
   */
  getTracker(): BudgetTracker {
    return this.tracker;
  }
}

/**
 * Create a budget-aware caller with default cost-first settings
 */
export function createCostFirstCaller(verbose: boolean = true): BudgetAwareCaller {
  const tracker = new BudgetTracker();
  return new BudgetAwareCaller(tracker, verbose);
}
