/**
 * Budget Tracker — Cost-First Policy v1
 *
 * Tracks spend at run and stage levels, enforces hard caps,
 * implements downgrade logic and early-stop rules.
 */

export type StageType = 'context_retrieval' | 'deliberation' | 'synthesis' | 'validation';
export type ModelTier = 'anthropic-premium' | 'openai-mid' | 'openai-mini' | 'fallback';

export interface BudgetConfig {
  runCapUSD: number;
  stageCaps: Record<StageType, number>;
}

export interface ModelPricing {
  inputPer1M: number;  // USD per 1M input tokens
  outputPer1M: number; // USD per 1M output tokens
}

export interface ModelTierConfig {
  tier: ModelTier;
  provider: string;
  model: string;
  pricing: ModelPricing;
}

export interface CallCost {
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  tier: ModelTier;
  model: string;
  provider: string;
}

export interface BudgetState {
  totalSpendUSD: number;
  stageSpend: Record<StageType, number>;
  callHistory: Array<{
    timestamp: string;
    stage: StageType;
    cost: CallCost;
    reasonCode?: string;
  }>;
  downgrades: Array<{
    timestamp: string;
    fromTier: ModelTier;
    toTier: ModelTier;
    reasonCode: string;
    threshold: string;
  }>;
  anthropicCalls: number;
  anthropicSpend: number;
}

export interface DowngradeDecision {
  allowed: boolean;
  tier: ModelTier;
  reasonCode: string;
  blocked?: boolean;
}

// Model tier hierarchy with pricing (as of April 2026)
export const MODEL_TIERS: Record<ModelTier, ModelTierConfig> = {
  'anthropic-premium': {
    tier: 'anthropic-premium',
    provider: 'anthropic-api',
    model: 'claude-sonnet-4-5-20250929',
    pricing: { inputPer1M: 3.0, outputPer1M: 15.0 },
  },
  'openai-mid': {
    tier: 'openai-mid',
    provider: 'openai-api',
    model: 'gpt-4o',
    pricing: { inputPer1M: 2.5, outputPer1M: 10.0 },
  },
  'openai-mini': {
    tier: 'openai-mini',
    provider: 'openai-api',
    model: 'gpt-4o-mini',
    pricing: { inputPer1M: 0.15, outputPer1M: 0.6 },
  },
  'fallback': {
    tier: 'fallback',
    provider: 'openai-api',
    model: 'gpt-4o-mini',
    pricing: { inputPer1M: 0.15, outputPer1M: 0.6 },
  },
};

// Cost-first preset defaults
export const COST_FIRST_BUDGET: BudgetConfig = {
  runCapUSD: 3.0,
  stageCaps: {
    context_retrieval: 0.6,  // 20%
    deliberation: 1.05,       // 35%
    synthesis: 0.9,           // 30%
    validation: 0.45,         // 15%
  },
};

// Default routing per stage (cost-first policy)
export const COST_FIRST_ROUTING: Record<StageType, ModelTier> = {
  context_retrieval: 'openai-mini',
  deliberation: 'openai-mini',
  synthesis: 'openai-mid',
  validation: 'openai-mid',
};

/**
 * Budget Tracker class
 */
export class BudgetTracker {
  private config: BudgetConfig;
  private state: BudgetState;

  constructor(config: BudgetConfig = COST_FIRST_BUDGET) {
    this.config = config;
    this.state = {
      totalSpendUSD: 0,
      stageSpend: {
        context_retrieval: 0,
        deliberation: 0,
        synthesis: 0,
        validation: 0,
      },
      callHistory: [],
      downgrades: [],
      anthropicCalls: 0,
      anthropicSpend: 0,
    };
  }

  /**
   * Get current budget utilization percentage
   */
  getRunUtilization(): number {
    return (this.state.totalSpendUSD / this.config.runCapUSD) * 100;
  }

  /**
   * Get stage utilization percentage
   */
  getStageUtilization(stage: StageType): number {
    const cap = this.config.stageCaps[stage];
    const spent = this.state.stageSpend[stage];
    return (spent / cap) * 100;
  }

  /**
   * Calculate cost of a call
   */
  calculateCost(inputTokens: number, outputTokens: number, tier: ModelTier): CallCost {
    const config = MODEL_TIERS[tier];
    const inputCost = (inputTokens / 1_000_000) * config.pricing.inputPer1M;
    const outputCost = (outputTokens / 1_000_000) * config.pricing.outputPer1M;

    return {
      inputTokens,
      outputTokens,
      costUSD: inputCost + outputCost,
      tier,
      model: config.model,
      provider: config.provider,
    };
  }

  /**
   * Record a call and update spend
   */
  recordCall(stage: StageType, cost: CallCost, reasonCode?: string): void {
    this.state.totalSpendUSD += cost.costUSD;
    this.state.stageSpend[stage] += cost.costUSD;

    if (cost.provider === 'anthropic-api') {
      this.state.anthropicCalls++;
      this.state.anthropicSpend += cost.costUSD;
    }

    this.state.callHistory.push({
      timestamp: new Date().toISOString(),
      stage,
      cost,
      reasonCode,
    });
  }

  /**
   * Check if a call would exceed stage cap
   */
  wouldExceedStageCap(stage: StageType, estimatedCost: number): boolean {
    const cap = this.config.stageCaps[stage];
    const projected = this.state.stageSpend[stage] + estimatedCost;
    return projected > cap;
  }

  /**
   * Check if a call would exceed run cap
   */
  wouldExceedRunCap(estimatedCost: number): boolean {
    const projected = this.state.totalSpendUSD + estimatedCost;
    return projected > this.config.runCapUSD;
  }

  /**
   * Determine appropriate tier based on budget state and escalation rules
   */
  selectTier(
    stage: StageType,
    requestedTier: ModelTier,
    options: {
      consensus?: number;
      confidence?: number;
      riskFlag?: 'high' | 'medium' | 'low';
      disagreement?: number;
      roundNumber?: number;
    } = {}
  ): DowngradeDecision {
    const runUtil = this.getRunUtilization();
    const stageUtil = this.getStageUtilization(stage);

    // Hard budget enforcement: 100% run cap
    if (runUtil >= 100) {
      return {
        allowed: false,
        tier: 'openai-mini',
        reasonCode: 'budget:run_cap_100pct',
        blocked: true,
      };
    }

    // Escalation gates for anthropic-premium
    if (requestedTier === 'anthropic-premium') {
      const allowedByEscalation = this.checkEscalationGates(options);

      if (!allowedByEscalation) {
        // Blocked by escalation rules - downgrade to mid-tier
        return {
          allowed: true,
          tier: 'openai-mid',
          reasonCode: 'escalation:gates_not_met',
        };
      }

      // At 85%+ run spend: block new anthropic calls
      if (runUtil >= 85) {
        this.recordDowngrade(requestedTier, 'openai-mid', 'budget:85pct_gate', '85%');
        return {
          allowed: true,
          tier: 'openai-mid',
          reasonCode: 'budget:85pct_anthropic_block',
        };
      }
    }

    // At 70%+ run spend: force compact mode, downgrade to cheaper tiers
    if (runUtil >= 70) {
      const downgraded = this.applyDowngrade(requestedTier, '70%');
      this.recordDowngrade(requestedTier, downgraded, 'budget:70pct_gate', '70%');
      return {
        allowed: true,
        tier: downgraded,
        reasonCode: 'budget:70pct_downgrade',
      };
    }

    // Stage cap enforcement
    const estimatedCost = this.estimateCallCost(requestedTier);
    if (this.wouldExceedStageCap(stage, estimatedCost)) {
      // Try to downgrade to a cheaper tier
      const cheaperTier = this.applyDowngrade(requestedTier, 'stage_cap');
      const cheaperCost = this.estimateCallCost(cheaperTier);

      // If even the cheaper tier would exceed, block the call
      if (this.wouldExceedStageCap(stage, cheaperCost)) {
        return {
          allowed: false,
          tier: cheaperTier,
          reasonCode: `budget:stage_cap_${stage}_hard`,
          blocked: true,
        };
      }

      this.recordDowngrade(requestedTier, cheaperTier, `budget:stage_cap_${stage}`, 'stage_cap');
      return {
        allowed: true,
        tier: cheaperTier,
        reasonCode: `budget:stage_cap_${stage}`,
      };
    }

    // Default: allow requested tier
    return {
      allowed: true,
      tier: requestedTier,
      reasonCode: 'allowed',
    };
  }

  /**
   * Check escalation gates for anthropic-premium tier
   */
  private checkEscalationGates(options: {
    consensus?: number;
    confidence?: number;
    riskFlag?: 'high' | 'medium' | 'low';
    disagreement?: number;
    roundNumber?: number;
  }): boolean {
    const { consensus, confidence, riskFlag, disagreement, roundNumber } = options;

    // Gate 1: Final synthesis and consensus < 0.80
    if (consensus !== undefined && consensus < 0.80) {
      return true;
    }

    // Gate 2: Risk flag = high
    if (riskFlag === 'high') {
      return true;
    }

    // Gate 3: Final validation and disagreement remains after 2 rounds
    if (disagreement !== undefined && roundNumber !== undefined && roundNumber >= 2) {
      return true;
    }

    // Additional guard: only escalate if confidence < 0.75 after mid-tier pass
    if (confidence !== undefined && confidence >= 0.75) {
      return false;
    }

    return false;
  }

  /**
   * Apply downgrade logic
   */
  private applyDowngrade(requestedTier: ModelTier, reason: string): ModelTier {
    // Downgrade hierarchy: anthropic-premium → openai-mid → openai-mini
    if (requestedTier === 'anthropic-premium') {
      return 'openai-mid';
    }
    if (requestedTier === 'openai-mid') {
      return 'openai-mini';
    }
    return 'openai-mini';
  }

  /**
   * Record a downgrade event
   */
  private recordDowngrade(fromTier: ModelTier, toTier: ModelTier, reasonCode: string, threshold: string): void {
    if (fromTier === toTier) return;

    this.state.downgrades.push({
      timestamp: new Date().toISOString(),
      fromTier,
      toTier,
      reasonCode,
      threshold,
    });
  }

  /**
   * Estimate call cost for budget checking (conservative estimate)
   */
  private estimateCallCost(tier: ModelTier, inputTokens: number = 4000, outputTokens: number = 1000): number {
    const config = MODEL_TIERS[tier];
    const inputCost = (inputTokens / 1_000_000) * config.pricing.inputPer1M;
    const outputCost = (outputTokens / 1_000_000) * config.pricing.outputPer1M;
    return inputCost + outputCost;
  }

  /**
   * Check if early-stop criteria are met
   */
  shouldEarlyStop(options: {
    consensus?: number;
    previousConsensus?: number;
    confidence?: number;
    riskFlag?: 'high' | 'medium' | 'low';
    roundNumber: number;
    qualityGain?: number;
  }): { stop: boolean; reasonCode: string } {
    const { consensus, previousConsensus, confidence, riskFlag, roundNumber, qualityGain } = options;

    // Hard max: 3 deliberation rounds
    if (roundNumber >= 3) {
      return { stop: true, reasonCode: 'early_stop:max_rounds_3' };
    }

    // Stop if consensus >= 0.80 for 2 consecutive rounds
    if (consensus !== undefined && previousConsensus !== undefined) {
      if (consensus >= 0.80 && previousConsensus >= 0.80) {
        return { stop: true, reasonCode: 'early_stop:consensus_2rounds' };
      }
    }

    // Stop if marginal quality gain < 0.10
    if (qualityGain !== undefined && qualityGain < 0.10) {
      return { stop: true, reasonCode: 'early_stop:low_quality_gain' };
    }

    // Skip validation if confidence >= 0.90 and risk is low
    if (confidence !== undefined && confidence >= 0.90 && riskFlag === 'low') {
      return { stop: true, reasonCode: 'early_stop:high_confidence_low_risk' };
    }

    return { stop: false, reasonCode: 'continue' };
  }

  /**
   * Get telemetry for CLI display
   */
  getTelemetry(): {
    totalSpendUSD: number;
    runUtilization: number;
    stageUtilization: Record<StageType, number>;
    anthropicCalls: number;
    anthropicSpend: number;
    downgrades: number;
    recentDowngrades: Array<{ fromTier: string; toTier: string; reasonCode: string }>;
  } {
    return {
      totalSpendUSD: this.state.totalSpendUSD,
      runUtilization: this.getRunUtilization(),
      stageUtilization: {
        context_retrieval: this.getStageUtilization('context_retrieval'),
        deliberation: this.getStageUtilization('deliberation'),
        synthesis: this.getStageUtilization('synthesis'),
        validation: this.getStageUtilization('validation'),
      },
      anthropicCalls: this.state.anthropicCalls,
      anthropicSpend: this.state.anthropicSpend,
      downgrades: this.state.downgrades.length,
      recentDowngrades: this.state.downgrades.slice(-5).map(d => ({
        fromTier: d.fromTier,
        toTier: d.toTier,
        reasonCode: d.reasonCode,
      })),
    };
  }

  /**
   * Get current state (for export/logging)
   */
  getState(): BudgetState {
    return { ...this.state };
  }

  /**
   * Get budget config
   */
  getConfig(): BudgetConfig {
    return { ...this.config };
  }
}
