/**
 * Cost-Aware LLM Caller - Wraps llm-caller with budget enforcement
 *
 * Intercepts LLM calls, applies routing policies, tracks spend, and enforces caps.
 */

import { callLLM, type CallerResult } from '../src/cli/llm-caller';
import { CostTracker, type StageType } from './cost-tracker';
import { CostPolicyEngine, type PolicyDecision } from './cost-policies';

export interface CostAwareCallOpts {
  provider: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
  stage: StageType;
  workingDir?: string;
  skipTools?: boolean;
  allowedTools?: string[];
  timeoutMs?: number;
  enableCache?: boolean;
  cacheableContext?: string;
  maxTokens?: number;

  // Context for policy decisions
  consensus?: number;
  riskFlag?: 'low' | 'medium' | 'high';
  currentRound?: number;
  confidence?: number;
}

export interface CostAwareResult extends CallerResult {
  wasDowngraded: boolean;
  downgradedFrom?: string;
  reasonCode?: string;
  actualProvider: string;
  actualModel: string;
  costUsd: number;
  skipped?: boolean;
}

/**
 * Cost-aware LLM caller that enforces budget policies
 */
export class CostAwareLLMCaller {
  private tracker: CostTracker;
  private policyEngine: CostPolicyEngine;

  constructor(tracker: CostTracker, policyEngine: CostPolicyEngine) {
    this.tracker = tracker;
    this.policyEngine = policyEngine;
  }

  /**
   * Call LLM with budget enforcement
   */
  async call(opts: CostAwareCallOpts): Promise<CostAwareResult> {
    // Get routing decision from policy engine
    const decision = this.policyEngine.getRoutingDecision(
      opts.stage,
      opts.provider,
      opts.model,
      {
        consensus: opts.consensus,
        riskFlag: opts.riskFlag,
        currentRound: opts.currentRound,
        confidence: opts.confidence,
      }
    );

    // Check if stage should be skipped
    if (decision.shouldSkipStage) {
      console.log(`[CostAwareLLM] SKIP stage=${opts.stage} reason=${decision.reasonCode}`);
      return {
        content: `[Stage skipped due to budget constraints: ${decision.reasonCode}]`,
        tokensUsed: 0,
        latencyMs: 0,
        wasDowngraded: false,
        actualProvider: opts.provider,
        actualModel: opts.model,
        costUsd: 0,
        skipped: true,
      };
    }

    // Use policy-approved provider/model
    const actualProvider = decision.allowedProvider;
    const actualModel = decision.allowedModel;

    // Make the actual LLM call
    const result = await callLLM({
      provider: actualProvider,
      model: actualModel,
      systemPrompt: opts.systemPrompt,
      userMessage: opts.userMessage,
      workingDir: opts.workingDir,
      skipTools: opts.skipTools,
      timeoutMs: opts.timeoutMs,
      enableCache: opts.enableCache,
      cacheableContext: opts.cacheableContext,
      maxTokens: opts.maxTokens,
    });

    // Calculate cost and record spend
    const costUsd = this.tracker.calculateCost(
      actualProvider,
      actualModel,
      result.tokensUsed * 0.4,  // Estimate: 40% input, 60% output
      result.tokensUsed * 0.6
    );

    this.tracker.recordSpend({
      stage: opts.stage,
      provider: actualProvider,
      model: actualModel,
      inputTokens: Math.round(result.tokensUsed * 0.4),
      outputTokens: Math.round(result.tokensUsed * 0.6),
      wasDowngraded: decision.wasDowngraded,
      downgradedFrom: decision.downgradedFrom,
      reasonCode: decision.reasonCode,
    });

    return {
      ...result,
      wasDowngraded: decision.wasDowngraded || false,
      downgradedFrom: decision.downgradedFrom,
      reasonCode: decision.reasonCode,
      actualProvider,
      actualModel,
      costUsd,
    };
  }

  /**
   * Get current budget status
   */
  getStatus() {
    return this.tracker.getStatus();
  }

  /**
   * Get policy state
   */
  getPolicyState() {
    return this.policyEngine.getState();
  }

  /**
   * Export cost summary
   */
  exportSummary() {
    return this.tracker.exportSummary();
  }
}
