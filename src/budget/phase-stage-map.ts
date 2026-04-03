/**
 * Phase-to-Budget-Stage Mapping
 *
 * Maps council deliberation phases and pipeline step types to budget stages.
 * Used by both council and pipeline orchestrators for consistent budget tracking.
 */

import type { DeliberationPhase } from '../council/types';
import type { PipelineStepType } from '../pipeline/types';

export type BudgetStage = 'context_retrieval' | 'deliberation' | 'synthesis' | 'validation';

/**
 * Maps a deliberation phase to a budget stage.
 * Fails safely for unknown phases with a default policy and logging.
 */
export function mapPhaseToStage(phase: DeliberationPhase): BudgetStage {
  const mapping: Partial<Record<DeliberationPhase, BudgetStage>> = {
    // Context phases
    'created': 'context_retrieval',
    'problem_framing': 'context_retrieval',

    // Deliberation phases
    'round_independent': 'deliberation',
    'round_interactive': 'deliberation',
    'round_waiting_for_manager': 'deliberation',
    'planning': 'deliberation',
    'deciding': 'deliberation',
    'directing': 'deliberation',

    // Execution phases
    'executing': 'deliberation',
    'revising': 'deliberation',

    // Synthesis/review phases
    'reviewing': 'synthesis',

    // Coding orchestrator phases
    'decomposing': 'deliberation',
    'implementing': 'deliberation',
    'code_reviewing': 'validation',
    'testing': 'validation',
    'debugging': 'validation',

    // Terminal states
    'paused': 'deliberation',
    'completed': 'synthesis',
    'cancelled': 'synthesis',
    'failed': 'synthesis',
  };

  const stage = mapping[phase];

  if (!stage) {
    console.warn(`[Budget] Unknown phase "${phase}", defaulting to 'deliberation'`);
    return 'deliberation';
  }

  return stage;
}

/**
 * Maps a pipeline step type to a budget stage.
 * Fails safely for unknown step types with a default policy and logging.
 */
export function mapStepTypeToStage(stepType: PipelineStepType | string): BudgetStage {
  const mapping: Partial<Record<PipelineStepType, BudgetStage>> = {
    // Council-based steps
    'council': 'deliberation',
    'code_planning': 'deliberation',
    'analysis': 'context_retrieval',
    'agent': 'deliberation',
    'coding': 'deliberation',
    'review': 'validation',
    'enrich': 'synthesis',

    // Non-council steps
    'gate': 'validation',
    'script': 'validation',
    'condition': 'validation',
  };

  const stage = mapping[stepType as PipelineStepType];

  if (!stage) {
    console.warn(`[Budget] Unknown step type "${stepType}", defaulting to 'deliberation'`);
    return 'deliberation';
  }

  return stage;
}

/**
 * Get a descriptive label for a budget stage.
 */
export function getStageLabel(stage: BudgetStage): string {
  const labels: Record<BudgetStage, string> = {
    context_retrieval: 'Context Retrieval',
    deliberation: 'Deliberation',
    synthesis: 'Synthesis',
    validation: 'Validation',
  };
  return labels[stage];
}
