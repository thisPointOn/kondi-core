/**
 * Budget Integration — patches for deliberation orchestrator
 *
 * This module provides integration points to add budget-aware calling
 * to the existing deliberation orchestrator without full rewrite.
 */

import type { Council, Persona, DeliberationPhase } from '../../src/council/types';
import type { AgentInvocation, AgentResponse } from '../../src/council/deliberation-orchestrator';
import { BudgetAwareCaller, type BudgetAwareCallOpts } from './budget-aware-caller';
import { BudgetTracker, StageType, ModelTier, COST_FIRST_ROUTING } from './budget-tracker';
import { callLLM } from '../../src/cli/llm-caller';

/**
 * Map deliberation phase to budget stage
 */
export function phaseToStage(phase: DeliberationPhase): StageType {
  switch (phase) {
    case 'problem_framing':
    case 'round_independent':
      return 'context_retrieval';
    case 'round_interactive':
    case 'round_waiting_for_manager':
    case 'deciding':
    case 'planning':
    case 'directing':
      return 'deliberation';
    case 'executing':
    case 'revising':
      return 'synthesis';
    case 'reviewing':
      return 'validation';
    default:
      return 'deliberation';
  }
}

/**
 * Map role context to model tier request
 */
export function contextToTier(context: string, stage: StageType): ModelTier {
  // Use cost-first routing by default
  return COST_FIRST_ROUTING[stage] || 'openai-mini';
}

/**
 * Extract escalation context from council state
 */
export function extractEscalationContext(council: Council): {
  consensus?: number;
  confidence?: number;
  riskFlag?: 'high' | 'medium' | 'low';
  disagreement?: number;
  roundNumber?: number;
} {
  const state = council.deliberationState;
  if (!state) return {};

  // Extract from manager's last evaluation if available
  const evaluation = state.managerLastEvaluation;
  const roundNumber = state.currentRound;

  return {
    consensus: evaluation?.confidence,
    confidence: evaluation?.confidence,
    riskFlag: 'medium', // Default, would need actual risk detection
    roundNumber,
  };
}

/**
 * Budget-aware agent invoker factory
 */
export function createBudgetAwareInvoker(
  budgetCaller: BudgetAwareCaller,
  council: Council
): (invocation: AgentInvocation, persona: Persona) => Promise<AgentResponse> {
  return async (invocation: AgentInvocation, persona: Persona): Promise<AgentResponse> => {
    const phase = council.deliberationState?.currentPhase || 'created';
    const stage = phaseToStage(phase);
    const requestedTier = contextToTier('default', stage);
    const escalationContext = extractEscalationContext(council);

    // Use budget-aware caller
    const result = await budgetCaller.call({
      stage,
      requestedTier,
      systemPrompt: invocation.systemPrompt,
      userMessage: invocation.userMessage,
      workingDir: invocation.workingDirectory,
      skipTools: invocation.skipTools,
      timeoutMs: invocation.timeoutMs,
      enableCache: true,
      cacheableContext: invocation.cacheableContext,
      escalationContext,
    });

    return {
      content: result.content,
      tokensUsed: result.tokensUsed,
      latencyMs: result.latencyMs,
      structured: undefined,
    };
  };
}

/**
 * Check if deliberation should stop early based on budget state
 */
export function shouldStopDeliberation(
  budgetTracker: BudgetTracker,
  council: Council
): { stop: boolean; reasonCode: string } {
  const runUtil = budgetTracker.getRunUtilization();

  // At 100% cap: stop immediately
  if (runUtil >= 100) {
    return { stop: true, reasonCode: 'budget:run_cap_100pct' };
  }

  // Check consensus-based early stop
  const state = council.deliberationState;
  if (!state) return { stop: false, reasonCode: 'continue' };

  const evaluation = state.managerLastEvaluation;
  const roundNumber = state.currentRound;

  return budgetTracker.shouldEarlyStop({
    consensus: evaluation?.confidence,
    confidence: evaluation?.confidence,
    riskFlag: 'medium',
    roundNumber,
  });
}

/**
 * Apply compact context mode when budget threshold reached
 */
export function shouldUseCompactContext(budgetTracker: BudgetTracker): boolean {
  return budgetTracker.getRunUtilization() >= 70;
}

/**
 * Get CLI telemetry string for live display
 */
export function formatTelemetryForCLI(budgetTracker: BudgetTracker): string {
  const t = budgetTracker.getTelemetry();
  const downgrades = t.recentDowngrades.length > 0
    ? `\n  Downgrades: ${t.recentDowngrades.map(d => `${d.fromTier}→${d.toTier} (${d.reasonCode})`).join(', ')}`
    : '';

  return (
    `[Budget] $${t.totalSpendUSD.toFixed(4)} (${t.runUtilization.toFixed(1)}%) | ` +
    `Stages: CR=${t.stageUtilization.context_retrieval.toFixed(0)}% ` +
    `DL=${t.stageUtilization.deliberation.toFixed(0)}% ` +
    `SY=${t.stageUtilization.synthesis.toFixed(0)}% ` +
    `VA=${t.stageUtilization.validation.toFixed(0)}% | ` +
    `Anthropic: ${t.anthropicCalls} calls, $${t.anthropicSpend.toFixed(4)}` +
    downgrades
  );
}
