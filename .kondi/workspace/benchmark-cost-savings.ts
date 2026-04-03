#!/usr/bin/env npx tsx
/**
 * Benchmark: Cost-First vs Baseline Anthropic Spend
 *
 * Simulates a typical 5-task council run and compares costs.
 * Run with: npx tsx benchmark-cost-savings.ts
 */

import { BudgetTracker, MODEL_TIERS, type StageType, type ModelTier } from './budget-tracker';

interface TaskScenario {
  name: string;
  stages: Array<{
    stage: StageType;
    calls: number;
    avgInputTokens: number;
    avgOutputTokens: number;
  }>;
}

const TYPICAL_TASKS: TaskScenario[] = [
  {
    name: 'Code Review',
    stages: [
      { stage: 'context_retrieval', calls: 3, avgInputTokens: 5000, avgOutputTokens: 800 },
      { stage: 'deliberation', calls: 6, avgInputTokens: 4000, avgOutputTokens: 1200 },
      { stage: 'synthesis', calls: 2, avgInputTokens: 6000, avgOutputTokens: 1500 },
      { stage: 'validation', calls: 1, avgInputTokens: 3000, avgOutputTokens: 600 },
    ],
  },
  {
    name: 'API Design',
    stages: [
      { stage: 'context_retrieval', calls: 2, avgInputTokens: 4000, avgOutputTokens: 600 },
      { stage: 'deliberation', calls: 8, avgInputTokens: 3500, avgOutputTokens: 1000 },
      { stage: 'synthesis', calls: 2, avgInputTokens: 5000, avgOutputTokens: 1400 },
      { stage: 'validation', calls: 2, avgInputTokens: 2500, avgOutputTokens: 500 },
    ],
  },
  {
    name: 'Security Analysis',
    stages: [
      { stage: 'context_retrieval', calls: 4, avgInputTokens: 6000, avgOutputTokens: 1000 },
      { stage: 'deliberation', calls: 7, avgInputTokens: 4500, avgOutputTokens: 1300 },
      { stage: 'synthesis', calls: 2, avgInputTokens: 5500, avgOutputTokens: 1600 },
      { stage: 'validation', calls: 2, avgInputTokens: 3500, avgOutputTokens: 700 },
    ],
  },
  {
    name: 'Bug Fix Implementation',
    stages: [
      { stage: 'context_retrieval', calls: 2, avgInputTokens: 3500, avgOutputTokens: 500 },
      { stage: 'deliberation', calls: 4, avgInputTokens: 3000, avgOutputTokens: 900 },
      { stage: 'synthesis', calls: 1, avgInputTokens: 4000, avgOutputTokens: 1200 },
      { stage: 'validation', calls: 1, avgInputTokens: 2000, avgOutputTokens: 400 },
    ],
  },
  {
    name: 'Documentation Update',
    stages: [
      { stage: 'context_retrieval', calls: 2, avgInputTokens: 4500, avgOutputTokens: 700 },
      { stage: 'deliberation', calls: 5, avgInputTokens: 3200, avgOutputTokens: 1100 },
      { stage: 'synthesis', calls: 2, avgInputTokens: 4500, avgOutputTokens: 1300 },
      { stage: 'validation', calls: 1, avgInputTokens: 2200, avgOutputTokens: 450 },
    ],
  },
];

/**
 * Simulate baseline: all calls use anthropic-premium
 */
function simulateBaseline(task: TaskScenario): number {
  let totalCost = 0;
  const tier: ModelTier = 'anthropic-premium';
  const pricing = MODEL_TIERS[tier].pricing;

  for (const stageGroup of task.stages) {
    for (let i = 0; i < stageGroup.calls; i++) {
      const inputCost = (stageGroup.avgInputTokens / 1_000_000) * pricing.inputPer1M;
      const outputCost = (stageGroup.avgOutputTokens / 1_000_000) * pricing.outputPer1M;
      totalCost += inputCost + outputCost;
    }
  }

  return totalCost;
}

/**
 * Simulate cost-first: uses budget tracker with routing and downgrade logic
 */
function simulateCostFirst(task: TaskScenario): { cost: number; anthropicCost: number; tracker: BudgetTracker } {
  const tracker = new BudgetTracker();

  for (const stageGroup of task.stages) {
    for (let i = 0; i < stageGroup.calls; i++) {
      // Request tier based on cost-first routing
      let requestedTier: ModelTier = 'openai-mini';
      if (stageGroup.stage === 'synthesis' || stageGroup.stage === 'validation') {
        requestedTier = 'openai-mid';
      }

      // Get actual tier from budget tracker
      const decision = tracker.selectTier(stageGroup.stage, requestedTier, {});
      if (!decision.allowed) break; // Budget exhausted

      const actualTier = decision.tier;
      const cost = tracker.calculateCost(
        stageGroup.avgInputTokens,
        stageGroup.avgOutputTokens,
        actualTier
      );

      tracker.recordCall(stageGroup.stage, cost, decision.reasonCode);
    }
  }

  const state = tracker.getState();
  return {
    cost: state.totalSpendUSD,
    anthropicCost: state.anthropicSpend,
    tracker,
  };
}

/**
 * Run benchmark
 */
function runBenchmark() {
  console.log('\n=== Cost-First Policy Benchmark ===\n');
  console.log('Simulating 5 typical council tasks...\n');

  let totalBaseline = 0;
  let totalCostFirst = 0;
  let totalAnthropicSpend = 0;

  for (const task of TYPICAL_TASKS) {
    const baseline = simulateBaseline(task);
    const costFirst = simulateCostFirst(task);

    const savings = baseline - costFirst.cost;
    const savingsPercent = (savings / baseline) * 100;

    totalBaseline += baseline;
    totalCostFirst += costFirst.cost;
    totalAnthropicSpend += costFirst.anthropicCost;

    console.log(`${task.name}:`);
    console.log(`  Baseline (all Anthropic):  $${baseline.toFixed(4)}`);
    console.log(`  Cost-First:                $${costFirst.cost.toFixed(4)}`);
    console.log(`  Anthropic spend:           $${costFirst.anthropicCost.toFixed(4)}`);
    console.log(`  Savings:                   $${savings.toFixed(4)} (${savingsPercent.toFixed(1)}%)`);
    console.log(`  Run utilization:           ${costFirst.tracker.getRunUtilization().toFixed(1)}%`);
    console.log();
  }

  const totalSavings = totalBaseline - totalCostFirst;
  const totalSavingsPercent = (totalSavings / totalBaseline) * 100;
  const anthropicReduction = ((totalBaseline - totalAnthropicSpend) / totalBaseline) * 100;

  console.log('=== Summary Across 5 Tasks ===');
  console.log(`Total Baseline:              $${totalBaseline.toFixed(4)}`);
  console.log(`Total Cost-First:            $${totalCostFirst.toFixed(4)}`);
  console.log(`Total Anthropic spend:       $${totalAnthropicSpend.toFixed(4)}`);
  console.log(`Total Savings:               $${totalSavings.toFixed(4)} (${totalSavingsPercent.toFixed(1)}%)`);
  console.log(`Anthropic spend reduction:   ${anthropicReduction.toFixed(1)}%`);
  console.log();

  // Check if we meet the >=40% reduction target
  if (anthropicReduction >= 40) {
    console.log('✓ Target met: Anthropic spend reduced by >=40%\n');
  } else {
    console.log(`⚠ Target not met: Anthropic spend reduced by ${anthropicReduction.toFixed(1)}% (target: >=40%)\n`);
  }
}

runBenchmark();
