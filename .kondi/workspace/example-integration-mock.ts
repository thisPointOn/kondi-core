#!/usr/bin/env npx tsx
/**
 * Example Integration: Budget-Aware Council Run (Mock Version)
 *
 * Demonstrates budget-aware caller with simulated LLM calls (no API key needed).
 * This is a working example showing the integration points.
 */

import { BudgetTracker, COST_FIRST_BUDGET, type ModelTier, type StageType } from './budget-tracker';
import { formatTelemetryForCLI } from './budget-integration';

/**
 * Simulate an LLM call (mock - no API call)
 */
function simulateCall(stage: StageType, tier: ModelTier): { inputTokens: number; outputTokens: number } {
  // Simulate realistic token counts based on stage
  const stageTokens = {
    context_retrieval: { input: 5000, output: 800 },
    deliberation: { input: 4000, output: 1200 },
    synthesis: { input: 6000, output: 1500 },
    validation: { input: 3000, output: 600 },
  };

  return {
    inputTokens: stageTokens[stage].input,
    outputTokens: stageTokens[stage].output,
  };
}

/**
 * Example: Create a budget-aware council runner (simulated)
 */
function runBudgetAwareCouncil() {
  console.log('=== Budget-Aware Council Example (Mock) ===\n');

  // Step 1: Create budget tracker
  const tracker = new BudgetTracker(COST_FIRST_BUDGET);
  console.log('[Setup] Budget tracker created with cost-first defaults');
  console.log(`  Run cap: $${tracker.getConfig().runCapUSD.toFixed(2)}`);
  console.log(`  Stage caps: CR=$0.60 DL=$1.05 SY=$0.90 VA=$0.45\n`);

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

  // Step 2: Simulate a council run
  console.log('[Simulated Run]\n');

  // Simulate context retrieval phase
  console.log('Phase: Context Retrieval');
  for (let i = 0; i < 3; i++) {
    const requestedTier: ModelTier = 'openai-mini';
    const decision = tracker.selectTier('context_retrieval', requestedTier, {});

    if (!decision.allowed) {
      console.log(`  Call ${i + 1}: BLOCKED (${decision.reasonCode})`);
      break;
    }

    const tokens = simulateCall('context_retrieval', decision.tier);
    const cost = tracker.calculateCost(tokens.inputTokens, tokens.outputTokens, decision.tier);
    tracker.recordCall('context_retrieval', cost, decision.reasonCode);

    console.log(`  Call ${i + 1}: ${cost.model} ($${cost.costUSD.toFixed(6)}) [${decision.reasonCode}]`);
  }
  console.log(formatTelemetryForCLI(tracker));
  console.log();

  // Simulate deliberation phase (Round 1)
  console.log('Phase: Deliberation (Round 1)');
  for (let i = 0; i < 4; i++) {
    const requestedTier: ModelTier = 'openai-mini';
    const decision = tracker.selectTier('deliberation', requestedTier, {});

    if (!decision.allowed) {
      console.log(`  Call ${i + 1}: BLOCKED (${decision.reasonCode})`);
      break;
    }

    const tokens = simulateCall('deliberation', decision.tier);
    const cost = tracker.calculateCost(tokens.inputTokens, tokens.outputTokens, decision.tier);
    tracker.recordCall('deliberation', cost, decision.reasonCode);

    console.log(`  Call ${i + 1}: ${cost.model} ($${cost.costUSD.toFixed(6)}) [${decision.reasonCode}]`);
  }
  console.log(formatTelemetryForCLI(tracker));
  console.log();

  // Simulate synthesis phase
  console.log('Phase: Synthesis');
  for (let i = 0; i < 2; i++) {
    const requestedTier: ModelTier = 'openai-mid';
    const decision = tracker.selectTier('synthesis', requestedTier, {
      consensus: 0.85,
      confidence: 0.80,
    });

    if (!decision.allowed) {
      console.log(`  Call ${i + 1}: BLOCKED (${decision.reasonCode})`);
      break;
    }

    const tokens = simulateCall('synthesis', decision.tier);
    const cost = tracker.calculateCost(tokens.inputTokens, tokens.outputTokens, decision.tier);
    tracker.recordCall('synthesis', cost, decision.reasonCode);

    console.log(`  Call ${i + 1}: ${cost.model} ($${cost.costUSD.toFixed(6)}) [${decision.reasonCode}]`);
  }
  console.log(formatTelemetryForCLI(tracker));
  console.log();

  // Simulate validation phase
  console.log('Phase: Validation');
  const requestedTier: ModelTier = 'openai-mid';
  const decision = tracker.selectTier('validation', requestedTier, {});

  if (decision.allowed) {
    const tokens = simulateCall('validation', decision.tier);
    const cost = tracker.calculateCost(tokens.inputTokens, tokens.outputTokens, decision.tier);
    tracker.recordCall('validation', cost, decision.reasonCode);

    console.log(`  Call 1: ${cost.model} ($${cost.costUSD.toFixed(6)}) [${decision.reasonCode}]`);
  } else {
    console.log(`  Call 1: BLOCKED (${decision.reasonCode})`);
  }
  console.log(formatTelemetryForCLI(tracker));
  console.log();

  // Final summary
  const telemetry = tracker.getTelemetry();
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

  // Demonstrate budget enforcement scenarios
  console.log('=== Budget Enforcement Demonstrations ===\n');

  // Demo 1: Anthropic escalation gates
  console.log('Demo 1: Anthropic Escalation Gates');
  const anthDecision1 = tracker.selectTier('synthesis', 'anthropic-premium', {
    consensus: 0.70, // Low consensus - should allow
    confidence: 0.65,
  });
  console.log(`  Low consensus (0.70): ${anthDecision1.tier} [${anthDecision1.reasonCode}]`);

  const anthDecision2 = tracker.selectTier('synthesis', 'anthropic-premium', {
    consensus: 0.90, // High consensus
    confidence: 0.85, // High confidence - should block
  });
  console.log(`  High confidence (0.85): ${anthDecision2.tier} [${anthDecision2.reasonCode}]`);
  console.log();

  // Demo 2: Early stop rules
  console.log('Demo 2: Early Stop Rules');
  const earlyStop1 = tracker.shouldEarlyStop({
    consensus: 0.82,
    previousConsensus: 0.85,
    roundNumber: 2,
  });
  console.log(`  High consensus 2 rounds: stop=${earlyStop1.stop} [${earlyStop1.reasonCode}]`);

  const earlyStop2 = tracker.shouldEarlyStop({
    roundNumber: 3,
  });
  console.log(`  Max rounds reached: stop=${earlyStop2.stop} [${earlyStop2.reasonCode}]`);
  console.log();
}

// Run example
runBudgetAwareCouncil();
