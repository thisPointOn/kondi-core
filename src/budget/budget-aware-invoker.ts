/**
 * Budget-Aware Invoker
 *
 * Wraps LLM invocation with budget enforcement, cost tracking, and persistence.
 * Integrates with both council and pipeline orchestrators.
 */

import { BudgetTracker, StageType, ModelTier, MODEL_TIERS, CallCost } from './budget-tracker';
import { saveBudgetState, loadBudgetState, createRunId, type PersistedBudgetState } from './persistent-budget-state';
import { withRetry, RetryPresets } from '../orchestration/shared-retry';
import { callLLM, type CallerResult } from '../cli/llm-caller';
import type { Persona } from '../council/types';

export interface BudgetAwareInvokerOpts {
  /** Enable verbose logging */
  verbose?: boolean;

  /** Run ID for persistence (generated if not provided) */
  runId?: string;

  /** Restore state from previous run */
  restoreState?: boolean;
}

export interface InvocationOpts {
  stage: StageType;
  requestedTier: ModelTier;
  persona: Persona;
  invocation: {
    systemPrompt: string;
    userMessage: string;
    workingDirectory?: string;
    skipTools?: boolean;
    allowedTools?: string[];
    timeoutMs?: number;
    cacheableContext?: string;
  };
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
  hadRetries: boolean;
  attempts: number;
}

/**
 * Budget-aware invoker with persistence and retry support.
 */
export class BudgetAwareInvoker {
  private tracker: BudgetTracker;
  private verbose: boolean;
  private runId: string;

  constructor(opts: BudgetAwareInvokerOpts = {}) {
    this.verbose = opts.verbose ?? true;
    this.runId = opts.runId ?? createRunId();

    // Restore state if requested
    if (opts.restoreState) {
      const persistedState = loadBudgetState();
      if (persistedState) {
        this.tracker = this.restoreTracker(persistedState);
        if (this.verbose) {
          console.log(
            `[Budget] Restored state from ${persistedState.timestamp} ` +
            `($${persistedState.totalSpendUSD.toFixed(4)} spent, ${persistedState.callCount} calls)`
          );
        }
      } else {
        this.tracker = new BudgetTracker();
      }
    } else {
      this.tracker = new BudgetTracker();
    }
  }

  /**
   * Invoke an agent with budget enforcement and retry logic.
   */
  async invoke(opts: InvocationOpts): Promise<BudgetAwareResult> {
    const { stage, requestedTier, persona, invocation, escalationContext } = opts;

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

    // Call LLM with retry logic
    const retryResult = await withRetry(
      async () => {
        return await callLLM({
          provider: tierConfig.provider,
          model: tierConfig.model,
          systemPrompt: invocation.systemPrompt,
          userMessage: invocation.userMessage,
          workingDir: invocation.workingDirectory,
          skipTools: invocation.skipTools,
          timeoutMs: invocation.timeoutMs || 900_000,
          enableCache: true,
          cacheableContext: invocation.cacheableContext,
        });
      },
      {
        ...RetryPresets.standard,
        onRetry: (error, attempt, delayMs) => {
          if (this.verbose) {
            console.log(
              `[Budget] Retry attempt ${attempt} after ${delayMs}ms (${error.message})`
            );
          }
        },
      }
    );

    const result = retryResult.result;

    // Calculate actual cost (estimate based on tokens used)
    // Note: CallerResult.tokensUsed is total tokens, we estimate 75% input, 25% output
    const inputTokens = Math.floor(result.tokensUsed * 0.75);
    const outputTokens = Math.floor(result.tokensUsed * 0.25);
    const cost = this.tracker.calculateCost(inputTokens, outputTokens, actualTier);

    // Record call
    this.tracker.recordCall(stage, cost, decision.reasonCode);

    // Persist state immediately after recording
    this.persistState();

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
      hadRetries: retryResult.hadRetries,
      attempts: retryResult.attempts,
    };
  }

  /**
   * Get current telemetry.
   */
  getTelemetry() {
    return this.tracker.getTelemetry();
  }

  /**
   * Get budget tracker.
   */
  getTracker(): BudgetTracker {
    return this.tracker;
  }

  /**
   * Persist current state to disk.
   */
  private persistState(): void {
    const state = this.tracker.getState();

    const persistedState: PersistedBudgetState = {
      version: 1,
      runId: this.runId,
      timestamp: new Date().toISOString(),
      totalSpendUSD: state.totalSpendUSD,
      stageSpend: state.stageSpend,
      callCount: state.callHistory.length,
      anthropicCalls: state.anthropicCalls,
      anthropicSpend: state.anthropicSpend,
    };

    saveBudgetState(persistedState);
  }

  /**
   * Restore tracker from persisted state.
   * Preserves per-stage spend and provider-specific counters (including Anthropic).
   */
  private restoreTracker(persistedState: PersistedBudgetState): BudgetTracker {
    const tracker = new BudgetTracker();

    // Use the new restoreState method to preserve all counters accurately
    tracker.restoreState({
      totalSpendUSD: persistedState.totalSpendUSD,
      stageSpend: {
        context_retrieval: persistedState.stageSpend.context_retrieval || 0,
        deliberation: persistedState.stageSpend.deliberation || 0,
        synthesis: persistedState.stageSpend.synthesis || 0,
        validation: persistedState.stageSpend.validation || 0,
      },
      anthropicCalls: persistedState.anthropicCalls,
      anthropicSpend: persistedState.anthropicSpend,
    });

    return tracker;
  }
}

/**
 * Create a budget-aware invoker with cost-first settings.
 */
export function createBudgetAwareInvoker(opts: BudgetAwareInvokerOpts = {}): BudgetAwareInvoker {
  return new BudgetAwareInvoker(opts);
}
