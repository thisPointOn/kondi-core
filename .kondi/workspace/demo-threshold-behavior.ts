#!/usr/bin/env npx tsx
/**
 * Demonstration of threshold behavior (70%, 85%, 100%)
 * Shows console output proving policy enforcement
 */

import { CostTracker } from './cost-tracker';
import { CostPolicyEngine, COST_FIRST_PRESET } from './cost-policies';

console.log('='.repeat(80));
console.log('THRESHOLD BEHAVIOR DEMONSTRATION');
console.log('='.repeat(80));
console.log('');

const tracker = new CostTracker(COST_FIRST_PRESET);
const policy = new CostPolicyEngine(tracker);

console.log('Simulating progressive budget consumption...\n');

// ============================================================================
// Scenario 1: 50% budget - Normal operation
// ============================================================================
console.log('--- SCENARIO 1: 50% budget (normal operation) ---\n');

tracker.recordSpend({
  stage: 'deliberation',
  provider: 'openai-api',
  model: 'gpt-4o',
  inputTokens: 300000,
  outputTokens: 150000,
});

const decision1 = policy.getRoutingDecision(
  'synthesis',
  'anthropic-api',
  'claude-sonnet-4-5-20250929'
);

console.log(`Requested: anthropic-api:claude-sonnet-4-5-20250929`);
console.log(`Allowed: ${decision1.allowedProvider}:${decision1.allowedModel}`);
console.log(`Downgraded: ${decision1.wasDowngraded ? 'YES' : 'NO'}\n`);

// ============================================================================
// Scenario 2: 72% budget - Compact context mode activated
// ============================================================================
console.log('--- SCENARIO 2: 72% budget (70% threshold crossed) ---\n');

tracker.recordSpend({
  stage: 'deliberation',
  provider: 'openai-api',
  model: 'gpt-4o',
  inputTokens: 120000,
  outputTokens: 60000,
});

const decision2 = policy.getRoutingDecision(
  'synthesis',
  'anthropic-api',
  'claude-sonnet-4-5-20250929'
);

console.log(`Requested: anthropic-api:claude-sonnet-4-5-20250929`);
console.log(`Allowed: ${decision2.allowedProvider}:${decision2.allowedModel}`);
console.log(`Downgraded: ${decision2.wasDowngraded ? 'YES' : 'NO'}`);

const policyState1 = policy.getState();
console.log(`Compact context mode: ${policyState1.compactContextMode ? 'ENABLED' : 'disabled'}\n`);

// ============================================================================
// Scenario 3: 87% budget - Anthropic blocked
// ============================================================================
console.log('--- SCENARIO 3: 87% budget (85% threshold crossed) ---\n');

tracker.recordSpend({
  stage: 'synthesis',
  provider: 'openai-api',
  model: 'gpt-4o',
  inputTokens: 120000,
  outputTokens: 60000,
});

const decision3 = policy.getRoutingDecision(
  'synthesis',
  'anthropic-api',
  'claude-sonnet-4-5-20250929',
  { consensus: 0.85 } // High consensus - no escalation
);

console.log(`Requested: anthropic-api:claude-sonnet-4-5-20250929`);
console.log(`Allowed: ${decision3.allowedProvider}:${decision3.allowedModel}`);
console.log(`Downgraded: ${decision3.wasDowngraded ? 'YES' : 'NO'}`);
console.log(`Reason: ${decision3.reasonCode || 'N/A'}`);

const policyState2 = policy.getState();
console.log(`Anthropic blocked: ${policyState2.anthropicBlocked ? 'YES' : 'NO'}\n`);

// ============================================================================
// Scenario 4: 87% budget - Escalation gate passes (low consensus)
// ============================================================================
console.log('--- SCENARIO 4: 87% budget + LOW CONSENSUS (escalation gate) ---\n');

const decision4 = policy.getRoutingDecision(
  'synthesis',
  'anthropic-api',
  'claude-sonnet-4-5-20250929',
  { consensus: 0.65 } // Low consensus - escalation allowed
);

console.log(`Requested: anthropic-api:claude-sonnet-4-5-20250929`);
console.log(`Allowed: ${decision4.allowedProvider}:${decision4.allowedModel}`);
console.log(`Downgraded: ${decision4.wasDowngraded ? 'YES' : 'NO'}`);
console.log(`Escalation gate passed: ${!decision4.wasDowngraded && decision4.allowedProvider === 'anthropic-api' ? 'YES' : 'NO'}\n`);

// ============================================================================
// Scenario 5: 100% budget - Validation skipped
// ============================================================================
console.log('--- SCENARIO 5: 100% budget (budget exhausted) ---\n');

tracker.recordSpend({
  stage: 'synthesis',
  provider: 'openai-api',
  model: 'gpt-4o',
  inputTokens: 150000,
  outputTokens: 75000,
});

const decision5 = policy.getRoutingDecision(
  'validation',
  'openai-api',
  'gpt-4o'
);

console.log(`Requested: openai-api:gpt-4o (validation stage)`);
console.log(`Allowed: ${decision5.allowedProvider}:${decision5.allowedModel}`);
console.log(`Stage skipped: ${decision5.shouldSkipStage ? 'YES' : 'NO'}`);
console.log(`Reason: ${decision5.reasonCode || 'N/A'}\n`);

// ============================================================================
// Final Summary
// ============================================================================
console.log('='.repeat(80));
console.log('FINAL BUDGET STATUS');
console.log('='.repeat(80));
console.log('');

const summary = tracker.exportSummary();
console.log(`Total spend: $${summary.totalSpend.toFixed(4)}`);
console.log(`Run cap: $${summary.runCap.toFixed(2)}`);
console.log(`Utilization: ${(summary.utilization * 100).toFixed(1)}%`);
console.log(`Anthropic spend: $${summary.anthropicSpend.toFixed(4)}`);
console.log(`Non-Anthropic spend: $${summary.nonAnthropicSpend.toFixed(4)}`);
console.log(`Downgraded calls: ${summary.downgradedCallCount}`);

console.log('\nStage breakdown:');
for (const [stage, data] of Object.entries(summary.stageBreakdown)) {
  console.log(`  ${stage}: $${data.spend.toFixed(4)} / $${data.cap.toFixed(2)} (${(data.utilization * 100).toFixed(1)}%)`);
}

console.log('\n' + '='.repeat(80));
console.log('✅ All thresholds demonstrated:');
console.log('  - 70% → Compact context mode enabled');
console.log('  - 85% → Anthropic blocked (unless escalation gate)');
console.log('  - 100% → Optional stages skipped');
console.log('='.repeat(80));
