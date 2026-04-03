/**
 * Cost Policies - Budget enforcement, model routing, and escalation gates
 *
 * Implements the v1 Cost-First Policy:
 * - Default cost-first preset with hard caps
 * - Deterministic downgrade behavior at budget thresholds
 * - Escalation gates for premium models
 * - Early-stop logic based on convergence
 */

import type { CostTracker, StageType, BudgetStatus } from './cost-tracker';

export type ModelTier = 'anthropic-premium' | 'openai-mid' | 'openai-mini' | 'fallback-cheap';

export interface ModelRouting {
  tier: ModelTier;
  provider: string;
  model: string;
}

export interface PolicyDecision {
  allowedProvider: string;
  allowedModel: string;
  wasDowngraded: boolean;
  downgradedFrom?: string;
  reasonCode?: string;
  shouldSkipStage?: boolean;
}

export interface EarlyStopDecision {
  shouldStop: boolean;
  reason?: string;
  reasonCode?: 'consensus_high' | 'marginal_gain_low' | 'max_rounds' | 'confidence_high';
}

/**
 * v1 Cost-First Policy Configuration
 */
export const COST_FIRST_PRESET = {
  runCapUsd: 3.00,
  stageCaps: {
    context_retrieval: 0.60,  // 20%
    deliberation: 1.05,        // 35%
    synthesis: 0.90,           // 30%
    validation: 0.45,          // 15%
  },
  routing: {
    context_retrieval: { tier: 'openai-mini' as ModelTier, provider: 'openai-api', model: 'gpt-4o-mini' },
    deliberation: { tier: 'openai-mid' as ModelTier, provider: 'openai-api', model: 'gpt-4o' },
    synthesis: { tier: 'openai-mid' as ModelTier, provider: 'openai-api', model: 'gpt-4o' },
    validation: { tier: 'openai-mid' as ModelTier, provider: 'openai-api', model: 'gpt-4o' },
  },
  thresholds: {
    compactContextAt: 0.70,      // >= 70% run spend
    blockAnthropicAt: 0.85,      // >= 85% run spend
    skipOptionalAt: 1.00,        // >= 100% run spend
  },
  earlyStop: {
    consensusThreshold: 0.80,
    marginalGainThreshold: 0.10,
    maxDeliberationRounds: 3,
    skipValidationConfidence: 0.90,
  },
  escalationGates: {
    allowAnthropicWhen: {
      consensusBelow: 0.80,
      riskFlagHigh: true,
      disagreementAfterRounds: 2,
      confidenceBelow: 0.75,
    },
  },
};

/**
 * Model tier fallback chain
 */
const TIER_FALLBACKS: Record<ModelTier, ModelRouting> = {
  'anthropic-premium': { tier: 'anthropic-premium', provider: 'anthropic-api', model: 'claude-sonnet-4-5-20250929' },
  'openai-mid': { tier: 'openai-mid', provider: 'openai-api', model: 'gpt-4o' },
  'openai-mini': { tier: 'openai-mini', provider: 'openai-api', model: 'gpt-4o-mini' },
  'fallback-cheap': { tier: 'fallback-cheap', provider: 'google', model: 'models/gemini-2.5-flash' },
};

/**
 * Cost Policy Engine - enforces budget rules and routing
 */
export class CostPolicyEngine {
  private tracker: CostTracker;
  private config = COST_FIRST_PRESET;
  private compactContextMode = false;
  private anthropicBlocked = false;

  constructor(tracker: CostTracker) {
    this.tracker = tracker;
  }

  /**
   * Determine allowed model for a stage, considering budget state
   */
  getRoutingDecision(
    stage: StageType,
    requestedProvider: string,
    requestedModel: string,
    context: {
      consensus?: number;
      riskFlag?: 'low' | 'medium' | 'high';
      currentRound?: number;
      confidence?: number;
    } = {}
  ): PolicyDecision {
    const status = this.tracker.getStatus();
    const utilization = status.runUtilization;

    // Update policy state based on utilization
    if (utilization >= this.config.thresholds.compactContextAt && !this.compactContextMode) {
      this.compactContextMode = true;
      console.log('[CostPolicy:EVENT] COMPACT_CONTEXT_MODE_ENABLED util=' + (utilization * 100).toFixed(1) + '%');
    }

    if (utilization >= this.config.thresholds.blockAnthropicAt && !this.anthropicBlocked) {
      this.anthropicBlocked = true;
      console.log('[CostPolicy:EVENT] ANTHROPIC_BLOCKED util=' + (utilization * 100).toFixed(1) + '%');
    }

    // Check if Anthropic is requested
    const isAnthropicRequested = requestedProvider === 'anthropic-api' ||
      (requestedModel || '').includes('claude');

    // Decision tree
    let decision: PolicyDecision = {
      allowedProvider: requestedProvider,
      allowedModel: requestedModel,
      wasDowngraded: false,
    };

    // Rule 1: If at or above 100%, skip optional stages
    if (utilization >= this.config.thresholds.skipOptionalAt) {
      if (stage === 'validation') {
        console.log('[CostPolicy:GATE] SKIP_STAGE stage=validation util=' + (utilization * 100).toFixed(1) + '%');
        return {
          ...decision,
          shouldSkipStage: true,
          reasonCode: 'budget_exhausted',
        };
      }
    }

    // Rule 2: Block Anthropic if >= 85% utilization
    if (this.anthropicBlocked && isAnthropicRequested) {
      // Check escalation gates
      const allowEscalation = this.checkEscalationGates(context);

      if (!allowEscalation) {
        // Downgrade to mid-tier
        const fallback = this.config.routing[stage] || TIER_FALLBACKS['openai-mid'];
        console.log(
          `[CostPolicy:DOWNGRADE] ANTHROPIC_BLOCKED stage=${stage} ` +
          `from=${requestedProvider}:${requestedModel} ` +
          `to=${fallback.provider}:${fallback.model} ` +
          `util=${(utilization * 100).toFixed(1)}%`
        );
        return {
          allowedProvider: fallback.provider,
          allowedModel: fallback.model,
          wasDowngraded: true,
          downgradedFrom: `${requestedProvider}:${requestedModel}`,
          reasonCode: 'budget_85pct_anthropic_blocked',
        };
      } else {
        console.log(
          `[CostPolicy:ESCALATION] ANTHROPIC_ALLOWED stage=${stage} ` +
          `reason=escalation_gate_passed util=${(utilization * 100).toFixed(1)}%`
        );
      }
    }

    // Rule 3: Enforce stage caps
    const defaultRouting = this.config.routing[stage];
    if (defaultRouting) {
      const estimatedCost = this.estimateCallCost(requestedProvider, requestedModel);
      if (this.tracker.wouldExceedStageCap(stage, estimatedCost)) {
        // Try downgrading to cheaper tier
        const cheapFallback = TIER_FALLBACKS['openai-mini'];
        const cheapCost = this.estimateCallCost(cheapFallback.provider, cheapFallback.model);

        if (!this.tracker.wouldExceedStageCap(stage, cheapCost)) {
          console.log(
            `[CostPolicy:DOWNGRADE] STAGE_CAP_NEAR stage=${stage} ` +
            `from=${requestedProvider}:${requestedModel} ` +
            `to=${cheapFallback.provider}:${cheapFallback.model}`
          );
          return {
            allowedProvider: cheapFallback.provider,
            allowedModel: cheapFallback.model,
            wasDowngraded: true,
            downgradedFrom: `${requestedProvider}:${requestedModel}`,
            reasonCode: 'stage_cap_enforcement',
          };
        } else {
          // Even cheap tier would exceed - skip if optional
          if (stage === 'validation') {
            console.log(`[CostPolicy:GATE] SKIP_STAGE stage=${stage} reason=stage_cap_exceeded`);
            return {
              ...decision,
              shouldSkipStage: true,
              reasonCode: 'stage_cap_exceeded',
            };
          }
        }
      }
    }

    // Rule 4: Use default routing for stage if no specific request
    if (!requestedProvider || !requestedModel) {
      const routing = this.config.routing[stage] || TIER_FALLBACKS['openai-mid'];
      return {
        allowedProvider: routing.provider,
        allowedModel: routing.model,
        wasDowngraded: false,
      };
    }

    return decision;
  }

  /**
   * Check if escalation to Anthropic premium is allowed
   */
  private checkEscalationGates(context: {
    consensus?: number;
    riskFlag?: 'low' | 'medium' | 'high';
    currentRound?: number;
    confidence?: number;
  }): boolean {
    const gates = this.config.escalationGates.allowAnthropicWhen;

    // Gate 1: Low consensus
    if (context.consensus !== undefined && context.consensus < gates.consensusBelow) {
      return true;
    }

    // Gate 2: High risk flag
    if (context.riskFlag === 'high' && gates.riskFlagHigh) {
      return true;
    }

    // Gate 3: Persistent disagreement
    if (context.currentRound !== undefined && context.currentRound >= gates.disagreementAfterRounds) {
      if (context.consensus !== undefined && context.consensus < gates.consensusBelow) {
        return true;
      }
    }

    // Gate 4: Low confidence after mid-tier attempt
    if (context.confidence !== undefined && context.confidence < gates.confidenceBelow) {
      return true;
    }

    return false;
  }

  /**
   * Estimate cost for a typical call (8K context, 2K output)
   */
  private estimateCallCost(provider: string, model: string): number {
    return this.tracker.calculateCost(provider, model, 8000, 2000);
  }

  /**
   * Check if deliberation should stop early
   */
  shouldStopDeliberation(context: {
    consensus: number;
    previousConsensus?: number;
    currentRound: number;
    qualityGain?: number;
  }): EarlyStopDecision {
    const config = this.config.earlyStop;

    // Rule 1: High consensus for 2 consecutive rounds
    if (context.consensus >= config.consensusThreshold) {
      if (context.previousConsensus !== undefined &&
          context.previousConsensus >= config.consensusThreshold) {
        return {
          shouldStop: true,
          reason: `Consensus >= ${config.consensusThreshold} for 2 rounds`,
          reasonCode: 'consensus_high',
        };
      }
    }

    // Rule 2: Marginal quality gain too low
    if (context.qualityGain !== undefined &&
        context.qualityGain < config.marginalGainThreshold) {
      return {
        shouldStop: true,
        reason: `Marginal quality gain < ${config.marginalGainThreshold}`,
        reasonCode: 'marginal_gain_low',
      };
    }

    // Rule 3: Max rounds reached
    if (context.currentRound >= config.maxDeliberationRounds) {
      return {
        shouldStop: true,
        reason: `Max rounds (${config.maxDeliberationRounds}) reached`,
        reasonCode: 'max_rounds',
      };
    }

    return { shouldStop: false };
  }

  /**
   * Check if validation stage should be skipped
   */
  shouldSkipValidation(confidence: number, riskFlag: 'low' | 'medium' | 'high'): boolean {
    return confidence >= this.config.earlyStop.skipValidationConfidence && riskFlag === 'low';
  }

  /**
   * Get current policy state
   */
  getState(): {
    compactContextMode: boolean;
    anthropicBlocked: boolean;
    budgetStatus: BudgetStatus;
  } {
    return {
      compactContextMode: this.compactContextMode,
      anthropicBlocked: this.anthropicBlocked,
      budgetStatus: this.tracker.getStatus(),
    };
  }
}
