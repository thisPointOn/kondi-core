/**
 * Cost Tracker - Runtime budget enforcement and cost telemetry
 *
 * Tracks spend per run and per stage, enforces hard budget caps,
 * and emits machine-parseable events for logging/monitoring.
 */

export type StageType = 'context_retrieval' | 'deliberation' | 'synthesis' | 'validation';

export interface CostConfig {
  runCapUsd: number;
  stageCaps: Record<StageType, number>;
}

export interface ModelPricing {
  provider: string;
  model: string;
  inputCostPer1M: number;   // USD per 1M input tokens
  outputCostPer1M: number;  // USD per 1M output tokens
}

export interface SpendEntry {
  timestamp: string;
  stage: StageType;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  wasDowngraded?: boolean;
  downgradedFrom?: string;
  reasonCode?: string;
}

export interface BudgetStatus {
  runSpendUsd: number;
  runCapUsd: number;
  runUtilization: number;  // 0.0 to 1.0
  stageSpend: Record<StageType, number>;
  stageCaps: Record<StageType, number>;
  stageUtilization: Record<StageType, number>;
  isAtCapacity: boolean;
  isNearCapacity: boolean;  // >= 70%
  isAtEscalationLimit: boolean;  // >= 85%
}

/**
 * Default pricing table (as of 2024-04)
 * Update from: anthropic.com/pricing, openai.com/pricing, etc.
 */
const DEFAULT_PRICING: ModelPricing[] = [
  // Anthropic
  { provider: 'anthropic-api', model: 'claude-opus-4', inputCostPer1M: 15.00, outputCostPer1M: 75.00 },
  { provider: 'anthropic-api', model: 'claude-sonnet-4', inputCostPer1M: 3.00, outputCostPer1M: 15.00 },
  { provider: 'anthropic-api', model: 'claude-sonnet-4-5-20250929', inputCostPer1M: 3.00, outputCostPer1M: 15.00 },
  { provider: 'anthropic-api', model: 'claude-haiku-4', inputCostPer1M: 0.80, outputCostPer1M: 4.00 },

  // OpenAI
  { provider: 'openai-api', model: 'gpt-4o', inputCostPer1M: 2.50, outputCostPer1M: 10.00 },
  { provider: 'openai-api', model: 'gpt-4o-mini', inputCostPer1M: 0.150, outputCostPer1M: 0.600 },
  { provider: 'openai-api', model: 'o1', inputCostPer1M: 15.00, outputCostPer1M: 60.00 },
  { provider: 'openai-api', model: 'o1-mini', inputCostPer1M: 3.00, outputCostPer1M: 12.00 },

  // Gemini
  { provider: 'google', model: 'models/gemini-2.5-flash', inputCostPer1M: 0.10, outputCostPer1M: 0.40 },
  { provider: 'google', model: 'models/gemini-2.5-pro', inputCostPer1M: 1.25, outputCostPer1M: 5.00 },

  // DeepSeek
  { provider: 'deepseek', model: 'deepseek-chat', inputCostPer1M: 0.14, outputCostPer1M: 0.28 },

  // xAI
  { provider: 'xai', model: 'grok-3', inputCostPer1M: 5.00, outputCostPer1M: 15.00 },
];

/**
 * Cost Tracker - stateful runtime budget tracker
 */
export class CostTracker {
  private config: CostConfig;
  private pricing: Map<string, ModelPricing>;
  private entries: SpendEntry[] = [];
  private stageSpend: Record<StageType, number> = {
    context_retrieval: 0,
    deliberation: 0,
    synthesis: 0,
    validation: 0,
  };
  private totalSpend = 0;

  constructor(config: CostConfig, customPricing?: ModelPricing[]) {
    this.config = config;
    this.pricing = new Map();

    const allPricing = [...DEFAULT_PRICING, ...(customPricing || [])];
    for (const p of allPricing) {
      this.pricing.set(`${p.provider}:${p.model}`, p);
    }
  }

  /**
   * Calculate cost for a given model and token usage
   */
  calculateCost(provider: string, model: string, inputTokens: number, outputTokens: number): number {
    const key = `${provider}:${model}`;
    const pricing = this.pricing.get(key);

    if (!pricing) {
      console.warn(`[CostTracker] No pricing for ${key}, using fallback estimate`);
      // Fallback: assume mid-tier pricing
      return (inputTokens / 1_000_000) * 3.0 + (outputTokens / 1_000_000) * 15.0;
    }

    return (inputTokens / 1_000_000) * pricing.inputCostPer1M +
           (outputTokens / 1_000_000) * pricing.outputCostPer1M;
  }

  /**
   * Record a spend entry and update budgets
   */
  recordSpend(entry: Omit<SpendEntry, 'timestamp' | 'costUsd'>): void {
    const cost = this.calculateCost(entry.provider, entry.model, entry.inputTokens, entry.outputTokens);

    const fullEntry: SpendEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
      costUsd: cost,
    };

    this.entries.push(fullEntry);
    this.stageSpend[entry.stage] += cost;
    this.totalSpend += cost;

    // Emit telemetry
    console.log(
      `[CostTracker:SPEND] stage=${entry.stage} ` +
      `provider=${entry.provider} model=${entry.model} ` +
      `cost=$${cost.toFixed(4)} ` +
      `total=$${this.totalSpend.toFixed(4)}/${this.config.runCapUsd.toFixed(2)} ` +
      `(${(this.getUtilization() * 100).toFixed(1)}%)` +
      (entry.wasDowngraded ? ` DOWNGRADED_FROM=${entry.downgradedFrom} reason=${entry.reasonCode}` : '')
    );
  }

  /**
   * Check if a spend would exceed the run cap
   */
  wouldExceedRunCap(estimatedCost: number): boolean {
    return (this.totalSpend + estimatedCost) > this.config.runCapUsd;
  }

  /**
   * Check if a spend would exceed a stage cap
   */
  wouldExceedStageCap(stage: StageType, estimatedCost: number): boolean {
    return (this.stageSpend[stage] + estimatedCost) > this.config.stageCaps[stage];
  }

  /**
   * Get current run utilization (0.0 to 1.0+)
   */
  getUtilization(): number {
    return this.totalSpend / this.config.runCapUsd;
  }

  /**
   * Get stage utilization
   */
  getStageUtilization(stage: StageType): number {
    return this.stageSpend[stage] / this.config.stageCaps[stage];
  }

  /**
   * Get full budget status
   */
  getStatus(): BudgetStatus {
    const utilization = this.getUtilization();

    return {
      runSpendUsd: this.totalSpend,
      runCapUsd: this.config.runCapUsd,
      runUtilization: utilization,
      stageSpend: { ...this.stageSpend },
      stageCaps: { ...this.config.stageCaps },
      stageUtilization: {
        context_retrieval: this.getStageUtilization('context_retrieval'),
        deliberation: this.getStageUtilization('deliberation'),
        synthesis: this.getStageUtilization('synthesis'),
        validation: this.getStageUtilization('validation'),
      },
      isAtCapacity: utilization >= 1.0,
      isNearCapacity: utilization >= 0.70,
      isAtEscalationLimit: utilization >= 0.85,
    };
  }

  /**
   * Get all spend entries
   */
  getEntries(): SpendEntry[] {
    return [...this.entries];
  }

  /**
   * Export summary for reporting
   */
  exportSummary(): {
    totalSpend: number;
    runCap: number;
    utilization: number;
    stageBreakdown: Record<StageType, { spend: number; cap: number; utilization: number }>;
    anthropicSpend: number;
    nonAnthropicSpend: number;
    downgradedCallCount: number;
  } {
    const status = this.getStatus();
    const anthropicSpend = this.entries
      .filter(e => e.provider === 'anthropic-api')
      .reduce((sum, e) => sum + e.costUsd, 0);
    const nonAnthropicSpend = this.totalSpend - anthropicSpend;
    const downgradedCallCount = this.entries.filter(e => e.wasDowngraded).length;

    return {
      totalSpend: this.totalSpend,
      runCap: this.config.runCapUsd,
      utilization: status.runUtilization,
      stageBreakdown: {
        context_retrieval: {
          spend: status.stageSpend.context_retrieval,
          cap: status.stageCaps.context_retrieval,
          utilization: status.stageUtilization.context_retrieval,
        },
        deliberation: {
          spend: status.stageSpend.deliberation,
          cap: status.stageCaps.deliberation,
          utilization: status.stageUtilization.deliberation,
        },
        synthesis: {
          spend: status.stageSpend.synthesis,
          cap: status.stageCaps.synthesis,
          utilization: status.stageUtilization.synthesis,
        },
        validation: {
          spend: status.stageSpend.validation,
          cap: status.stageCaps.validation,
          utilization: status.stageUtilization.validation,
        },
      },
      anthropicSpend,
      nonAnthropicSpend,
      downgradedCallCount,
    };
  }
}
