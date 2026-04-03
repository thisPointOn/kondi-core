#!/usr/bin/env npx tsx
/**
 * Example Integration: Budget-Aware Council Run
 *
 * Demonstrates how to integrate the budget-aware caller with the
 * existing deliberation orchestrator.
 *
 * This is a working example showing the integration points.
 */

import { createCostFirstCaller } from './budget-aware-caller';
import {
  createBudgetAwareInvoker,
  shouldStopDeliberation,
  shouldUseCompactContext,
  formatTelemetryForCLI,
} from './budget-integration';

/**
 * Example: Create a budget-aware council runner
 */
async function runBudgetAwareCouncil() {
  console.log('=== Budget-Aware Council Example ===\n');

  // Step 1: Create budget-aware caller
  const budgetCaller = createCostFirstCaller(true);
  console.log('[Setup] Budget-aware caller created with cost-first defaults');
  console.log(`  Run cap: $${budgetCaller.getTracker().getConfig().runCapUSD.toFixed(2)}`);
  console.log(`  Stage caps: CR=$0.60 DL=$1.05 SY=$0.90 VA=$0.45\n`);

  // Step 2: In the actual integration, you would pass the budget-aware invoker
  // to the DeliberationOrchestrator constructor like this:
  //
  // const council = createCouncilFromSetup({ ... });
  // const invoker = createBudgetAwareInvoker(budgetCaller, council);
  // const orchestrator = new DeliberationOrchestrator({ invokeAgent: invoker });
  //
  // Then the orchestrator would automatically use budget-aware routing for all calls.

  console.log('[Integration Points]');
  console.log('1. Create budget-aware invoker:');
  console.log('   const invoker = createBudgetAwareInvoker(budgetCaller, council);');
  console.log('');
  console.log('2. Pass to orchestrator:');
  console.log('   const orchestrator = new DeliberationOrchestrator({ invokeAgent: invoker });');
  console.log('');
  console.log('3. Check early-stop before each round:');
  console.log('   const { stop, reasonCode } = shouldStopDeliberation(tracker, council);');
  console.log('');
  console.log('4. Apply compact context mode at 70% threshold:');
  console.log('   if (shouldUseCompactContext(tracker)) { /* use compact context */ }');
  console.log('');
  console.log('5. Display live telemetry:');
  console.log('   console.log(formatTelemetryForCLI(tracker));');
  console.log('');

  // Step 3: Simulate a council run
  console.log('[Simulated Run]\n');

  // Simulate context retrieval phase
  console.log('Phase: Context Retrieval');
  for (let i = 0; i < 3; i++) {
    const result = await budgetCaller.call({
      stage: 'context_retrieval',
      requestedTier: 'openai-mini',
      systemPrompt: 'You are a context analyzer.',
      userMessage: 'Analyze this codebase for security issues.',
    });
    console.log(`  Call ${i + 1}: ${result.actualModel} ($${result.costUSD.toFixed(6)}) [${result.reasonCode}]`);
  }
  console.log(formatTelemetryForCLI(budgetCaller.getTracker()));
  console.log();

  // Simulate deliberation phase
  console.log('Phase: Deliberation (Round 1)');
  for (let i = 0; i < 4; i++) {
    const result = await budgetCaller.call({
      stage: 'deliberation',
      requestedTier: 'openai-mini',
      systemPrompt: 'You are a consultant.',
      userMessage: 'Provide analysis on the security findings.',
    });
    console.log(`  Call ${i + 1}: ${result.actualModel} ($${result.costUSD.toFixed(6)}) [${result.reasonCode}]`);
  }
  console.log(formatTelemetryForCLI(budgetCaller.getTracker()));
  console.log();

  // Simulate synthesis phase
  console.log('Phase: Synthesis');
  for (let i = 0; i < 2; i++) {
    const result = await budgetCaller.call({
      stage: 'synthesis',
      requestedTier: 'openai-mid',
      systemPrompt: 'You are a synthesizer.',
      userMessage: 'Synthesize the findings into a coherent decision.',
      escalationContext: { consensus: 0.85, confidence: 0.80 },
    });
    console.log(`  Call ${i + 1}: ${result.actualModel} ($${result.costUSD.toFixed(6)}) [${result.reasonCode}]`);
  }
  console.log(formatTelemetryForCLI(budgetCaller.getTracker()));
  console.log();

  // Simulate validation phase
  console.log('Phase: Validation');
  const result = await budgetCaller.call({
    stage: 'validation',
    requestedTier: 'openai-mid',
    systemPrompt: 'You are a validator.',
    userMessage: 'Review the output for quality and correctness.',
  });
  console.log(`  Call 1: ${result.actualModel} ($${result.costUSD.toFixed(6)}) [${result.reasonCode}]`);
  console.log(formatTelemetryForCLI(budgetCaller.getTracker()));
  console.log();

  // Final summary
  const telemetry = budgetCaller.getTelemetry();
  console.log('=== Final Summary ===');
  console.log(`Total spend:            $${telemetry.totalSpendUSD.toFixed(4)}`);
  console.log(`Run utilization:        ${telemetry.runUtilization.toFixed(1)}%`);
  console.log(`Anthropic calls:        ${telemetry.anthropicCalls}`);
  console.log(`Anthropic spend:        $${telemetry.anthropicSpend.toFixed(4)}`);
  console.log(`Total downgrades:       ${telemetry.downgrades}`);
  console.log();

  if (telemetry.runUtilization < 100) {
    console.log('✓ Run completed within budget cap');
  } else {
    console.log('⚠ Run exceeded budget cap (should not happen in production)');
  }
  console.log();
}

// Run example
runBudgetAwareCouncil().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
