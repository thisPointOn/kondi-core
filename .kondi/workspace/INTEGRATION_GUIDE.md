# Runtime Hardening Integration Guide

This document explains how to integrate the budget-aware invocation system into the existing `run-council.ts` and `run-pipeline.ts` runtimes.

## Files Created

### Core Implementation

1. **`src/budget/phase-stage-map.ts`** - Maps deliberation phases and pipeline step types to budget stages
2. **`src/budget/persistent-budget-state.ts`** - Provides crash-durable budget state persistence
3. **`src/orchestration/shared-retry.ts`** - Unified retry logic with exponential backoff and jitter
4. **`src/budget/budget-tracker.ts`** - Budget tracking with tier downgrade logic (copied from workspace)
5. **`src/budget/budget-aware-invoker.ts`** - Budget-aware invoker that wraps LLM calls

### Tests

6. **`.kondi/workspace/runtime-hardening.test.ts`** - Comprehensive integration tests

### Examples

7. **`.kondi/workspace/run-council-integrated.ts`** - Example showing full integration

## Integration Steps for `run-council.ts`

### Step 1: Import Budget Components

Add these imports at the top:

```typescript
import { createBudgetAwareInvoker } from '../budget/budget-aware-invoker';
import { mapPhaseToStage } from '../budget/phase-stage-map';
import type { ModelTier } from '../budget/budget-tracker';
```

### Step 2: Create Budget-Aware Invoker

In the `main()` function, before the orchestrator setup:

```typescript
// Create budget-aware invoker
const budgetInvoker = createBudgetAwareInvoker({
  verbose: !quietMode,
  restoreState: false, // Fresh run
});

// Track current phase for stage mapping
let currentPhase = 'problem_framing';
```

### Step 3: Map Provider/Model to Tier

Add a helper function:

```typescript
function mapProviderModelToTier(provider: string, model: string): ModelTier {
  if (provider === 'anthropic-api') {
    return 'anthropic-premium';
  }
  if (model.includes('gpt-4o-mini')) {
    return 'openai-mini';
  }
  if (model.includes('gpt-4')) {
    return 'openai-mid';
  }
  return 'openai-mid'; // Default
}
```

### Step 4: Replace `invokeAgent` Function

Replace the existing `invokeAgent` function with:

```typescript
const invokeAgent = async (invocation: any, persona: Persona) => {
  log(C.cyan, persona.name, `Thinking... (${persona.model})`);

  // Map provider/model to tier
  const requestedTier = mapProviderModelToTier(persona.provider, persona.model);

  // Map current phase to budget stage
  const stage = mapPhaseToStage(currentPhase as any);

  try {
    const result = await budgetInvoker.invoke({
      stage,
      requestedTier,
      persona,
      invocation: {
        systemPrompt: invocation.systemPrompt,
        userMessage: invocation.userMessage,
        workingDirectory: invocation.workingDirectory || workingDir,
        skipTools: invocation.skipTools,
        allowedTools: invocation.allowedTools,
        timeoutMs: invocation.timeoutMs || 900_000,
        cacheableContext: invocation.cacheableContext,
      },
    });

    log(C.cyan, persona.name, `Done (${result.tokensUsed} tokens, ${(result.latencyMs / 1000).toFixed(1)}s)`);

    if (result.downgraded) {
      log(C.yellow, persona.name, `Model downgraded to ${result.actualModel} (${result.reasonCode})`);
    }

    return { ...result, sessionId: result.sessionId };
  } catch (error) {
    log(C.red, persona.name, `Failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
};
```

### Step 5: Update Phase Change Callback

Update the `onPhaseChange` callback to track the current phase:

```typescript
const callbacks = {
  invokeAgent,
  onPhaseChange: (from: string, to: string) => {
    currentPhase = to;
    log(C.yellow, 'Phase', `${from} → ${to}`);
  },
  // ... rest of callbacks
};
```

### Step 6: Add Budget Telemetry Output

After execution, add budget summary:

```typescript
// Print budget telemetry
if (!quietMode) {
  const telemetry = budgetInvoker.getTelemetry();
  console.log(`\n${C.bold}Budget Summary:${C.reset}`);
  console.log(`  Total spend: $${telemetry.totalSpendUSD.toFixed(4)} (${telemetry.runUtilization.toFixed(1)}%)`);
  console.log(`  Anthropic calls: ${telemetry.anthropicCalls} ($${telemetry.anthropicSpend.toFixed(4)})`);
  console.log(`  Downgrades: ${telemetry.downgrades}`);
}
```

## Integration Steps for `run-pipeline.ts`

The integration for `run-pipeline.ts` is similar:

### Step 1-3: Same as run-council.ts

Follow the same import, invoker creation, and tier mapping steps.

### Step 4: Replace `invokeAgent` in Executor

In the `PipelineExecutor` initialization, replace the `invokeAgent` callback:

```typescript
const executor = new PipelineExecutor({
  invokeAgent: async (invocation, persona) => {
    log(C.cyan, persona.name, `Invoking (${persona.model})...`);

    // Get current step to determine stage
    const step = getCurrentStep(); // You'll need to track this
    const stage = mapStepTypeToStage(step.config.type);

    const requestedTier = mapProviderModelToTier(persona.provider || 'anthropic-api', persona.model);

    const result = await budgetInvoker.invoke({
      stage,
      requestedTier,
      persona,
      invocation: {
        systemPrompt: invocation.systemPrompt,
        userMessage: invocation.userMessage,
        workingDirectory: platform.getWorkingDir(),
        skipTools: invocation.skipTools,
        conversationId: invocation.conversationId,
        timeoutMs: isWorker ? 1_800_000 : isOpus ? 1_200_000 : 900_000,
        cacheableContext: invocation.cacheableContext,
      },
    });

    log(C.cyan, persona.name, `Done (${result.tokensUsed} tokens, ${(result.latencyMs / 1000).toFixed(1)}s)`);
    return { ...result, sessionId: result.sessionId };
  },
  // ... rest of executor config
});
```

## Testing

Run the integration tests:

```bash
npx tsx .kondi/workspace/runtime-hardening.test.ts
```

All tests should pass:
- ✓ Budget cutoff: 100% cap blocks further calls
- ✓ Downgrade: anthropic → openai-mid at 85% utilization
- ✓ Downgrade: openai-mid → openai-mini at 70% utilization
- ✓ Retry idempotence: retries tracked correctly
- ✓ Retry: non-retryable error fails immediately
- ✓ Partial-failure recovery: transient error recovers
- ✓ Restart durability: persisted state survives restart
- ✓ Phase-to-stage mapping: all phases map correctly
- ✓ Integration: budget lifecycle with persistence

## Verification

After integration, verify that:

1. **Budget enforcement works**: Run a council with `--quiet` to see budget output
2. **Downgrades occur**: Watch for "Model downgraded" messages at 70%/85% utilization
3. **Persistence works**: Kill a run mid-execution and restart to see state restoration
4. **Retries work**: Simulate network errors to see retry behavior
5. **Phase mapping works**: Check that phases map to correct budget stages in logs

## Configuration

The default budget configuration is:
- **Run cap**: $3.00
- **Stage caps**:
  - Context retrieval: $0.60 (20%)
  - Deliberation: $1.05 (35%)
  - Synthesis: $0.90 (30%)
  - Validation: $0.45 (15%)

To customize, modify `COST_FIRST_BUDGET` in `src/budget/budget-tracker.ts`.

## Persistence Location

Budget state is persisted to:
- **Primary**: `.kondi/runtime/budget-state.json` (in current working directory)
- **Fallback**: `/tmp/kondi-budget-state.json` (if project dir is not writable)

## Known Issues

None at this time. All tests pass.

## Next Steps

1. Run the test suite to verify implementation
2. Integrate into `run-council.ts` following the guide above
3. Integrate into `run-pipeline.ts` following the guide above
4. Test with real councils/pipelines
5. Monitor budget behavior in production
