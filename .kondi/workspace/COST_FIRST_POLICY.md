# v1 Cost-First Policy - Implementation Documentation

## Overview

The v1 Cost-First Policy implements budget-constrained multi-agent deliberation with hard caps, intelligent routing, and deterministic downgrade behavior. This policy prioritizes cost efficiency while maintaining acceptable quality through strategic model selection and early-stop logic.

## Configuration

### Default Preset: `cost-first`

```json
{
  "runCapUsd": 3.00,
  "stageCaps": {
    "context_retrieval": 0.60,  // 20% of run cap
    "deliberation": 1.05,        // 35% of run cap
    "synthesis": 0.90,           // 30% of run cap
    "validation": 0.45           // 15% of run cap
  },
  "routing": {
    "context_retrieval": "openai-api:gpt-4o-mini",
    "deliberation": "openai-api:gpt-4o",
    "synthesis": "openai-api:gpt-4o",
    "validation": "openai-api:gpt-4o"
  }
}
```

### Budget Thresholds

| Threshold | Behavior |
|-----------|----------|
| **70%** | Compact context mode enabled, consultant fan-out disabled |
| **85%** | Anthropic premium models blocked (unless escalation gate passes) |
| **100%** | Optional stages skipped, budget-constrained status emitted |

## Budget Enforcement

### Hard Caps

1. **Run Cap**: No run may exceed `$3.00` total spend
2. **Stage Caps**: Each stage has a hard cap that cannot be exceeded
3. **Enforcement**: Calls are blocked or downgraded if they would exceed caps

### Spend Tracking

All LLM calls are tracked with:
- Input/output token counts
- Cost in USD (calculated from pricing table)
- Stage attribution
- Provider and model used
- Downgrade events (if any)

### Telemetry Format

```
[CostTracker:SPEND] stage=deliberation provider=openai-api model=gpt-4o 
  cost=$0.6250 total=$1.2500/3.00 (41.7%)

[CostPolicy:DOWNGRADE] ANTHROPIC_BLOCKED stage=synthesis 
  from=anthropic-api:claude-sonnet-4-5-20250929 
  to=openai-api:gpt-4o util=87.3%

[CostPolicy:EVENT] COMPACT_CONTEXT_MODE_ENABLED util=72.1%

[CostPolicy:GATE] SKIP_STAGE stage=validation util=100.0%
```

## Model Routing

### Default Tier Assignment

| Stage | Default Tier | Model |
|-------|-------------|-------|
| Context Retrieval | `openai-mini` | gpt-4o-mini |
| Deliberation | `openai-mid` | gpt-4o |
| Synthesis | `openai-mid` | gpt-4o |
| Validation | `openai-mid` | gpt-4o |

### Downgrade Chain

```
anthropic-premium (blocked at 85%)
  ↓
openai-mid (default for most stages)
  ↓
openai-mini (fallback when stage cap near)
  ↓
fallback-cheap (gemini-2.5-flash, last resort)
```

## Escalation Gates

Anthropic premium models are allowed at ≥85% budget **only if**:

1. **Low Consensus**: `consensus < 0.80`
2. **High Risk Flag**: `riskFlag === 'high'`
3. **Persistent Disagreement**: Current round ≥ 2 AND consensus < 0.80
4. **Low Confidence**: `confidence < 0.75` after mid-tier attempt

**Additional Guard**: Only escalate if `confidence < 0.75` after mid-tier pass.

### Reason Codes

| Code | Description |
|------|-------------|
| `budget_85pct_anthropic_blocked` | Anthropic blocked at 85% threshold |
| `budget_exhausted` | 100% budget reached |
| `stage_cap_enforcement` | Stage cap would be exceeded |
| `stage_cap_exceeded` | Stage cap already exceeded |

## Early-Stop Logic

### Deliberation Rounds

Stop if **any** of:

1. Consensus ≥ 0.80 for **2 consecutive rounds**
2. Marginal quality gain < 0.10 between rounds
3. Round count reaches **hard max = 3**

### Validation Stage

Skip validation if **both**:

1. Final confidence ≥ 0.90
2. Risk flag is `low`

## Terminal Behavior

### At 100% Budget

1. **Validation stage**: Skipped if not yet started
2. **Final output**: Emit best-possible answer from completed stages
3. **Status**: Mark run as `budget-constrained`
4. **Logs**: Include budget exhaustion in completion summary

### Output Format

```json
{
  "status": "budget-constrained",
  "output": "[worker's final deliverable]",
  "budgetStatus": {
    "runSpendUsd": 3.00,
    "runCapUsd": 3.00,
    "runUtilization": 1.00,
    "skippedStages": ["validation"],
    "downgradedCalls": 2
  }
}
```

## Cost Calculation

### Pricing Table (as of 2024-04)

| Provider | Model | Input ($/1M tokens) | Output ($/1M tokens) |
|----------|-------|---------------------|---------------------|
| Anthropic | claude-sonnet-4-5 | $3.00 | $15.00 |
| OpenAI | gpt-4o | $2.50 | $10.00 |
| OpenAI | gpt-4o-mini | $0.15 | $0.60 |
| Google | gemini-2.5-flash | $0.10 | $0.40 |
| DeepSeek | deepseek-chat | $0.14 | $0.28 |

### Cost Formula

```typescript
cost = (inputTokens / 1_000_000) * inputCostPer1M +
       (outputTokens / 1_000_000) * outputCostPer1M
```

## Testing

### Test Coverage

All tests are in `cost-tracker.test.ts`:

1. **Budget Enforcement**
   - ✓ Run cap never exceeded
   - ✓ Stage caps never exceeded
   - ✓ Overspend prediction (wouldExceedRunCap, wouldExceedStageCap)

2. **Routing Correctness**
   - ✓ Anthropic allowed before 85%
   - ✓ Anthropic blocked at 85%
   - ✓ Escalation gates bypass 85% block
   - ✓ Validation skipped at 100%

3. **Early-Stop Logic**
   - ✓ Consensus threshold (0.80 for 2 rounds)
   - ✓ Marginal gain threshold (< 0.10)
   - ✓ Max rounds (3)
   - ✓ Validation skip (confidence ≥ 0.90, risk low)

4. **Threshold Behavior**
   - ✓ 70% triggers compact context mode
   - ✓ 85% triggers Anthropic block
   - ✓ 100% triggers stage skip

### Running Tests

```bash
# Run all cost policy tests
npm test -- cost-tracker.test.ts

# Run benchmark simulation
npx tsx cost-benchmark.ts

# Dry run (show tasks only)
npx tsx cost-benchmark.ts --dry-run
```

## Benchmark Results

The benchmark simulates 5 standard tasks:

1. Simple API Design
2. Code Review
3. Architecture Decision
4. Bug Investigation
5. Performance Optimization

**Expected Results**:

- Total savings: ≥40% vs baseline (all Anthropic)
- Run cap respected: 100% of runs ≤ $3.00
- Stage caps respected: 100% compliance
- Average Anthropic spend reduction: ~$1.50 per task

## Usage Examples

### CLI with Cost-First Preset

```bash
# Use cost-first config
kondi council --config configs/councils/cost-first.json \
  --task "Review this codebase" \
  --working-dir ./myapp

# Override run cap
COST_RUN_CAP=5.00 kondi council --config cost-first.json --task "..."

# View budget telemetry
kondi council --config cost-first.json --task "..." | grep "CostTracker\|CostPolicy"
```

### Programmatic Usage

```typescript
import { CostTracker } from './cost-tracker';
import { CostPolicyEngine, COST_FIRST_PRESET } from './cost-policies';
import { CostAwareLLMCaller } from './cost-aware-llm-caller';

// Initialize
const tracker = new CostTracker(COST_FIRST_PRESET);
const policy = new CostPolicyEngine(tracker);
const caller = new CostAwareLLMCaller(tracker, policy);

// Make budget-aware call
const result = await caller.call({
  provider: 'anthropic-api',
  model: 'claude-sonnet-4-5-20250929',
  systemPrompt: '...',
  userMessage: '...',
  stage: 'deliberation',
  consensus: 0.65,
});

console.log('Actual model used:', result.actualModel);
console.log('Was downgraded:', result.wasDowngraded);
console.log('Cost:', result.costUsd);

// Check status
const status = tracker.getStatus();
console.log('Budget utilization:', (status.runUtilization * 100).toFixed(1) + '%');
```

## Integration Points

### Files Modified

1. **`src/cli/llm-caller.ts`**
   - Added cost calculation hooks (wrapper)
   - Budget check before API call

2. **`src/council/deliberation-orchestrator.ts`**
   - Integrated CostAwareLLMCaller
   - Added early-stop checks
   - Emit budget status in progress logs

3. **`src/cli/run-council.ts`**
   - Load cost-first preset by default
   - Display budget ticker in CLI output
   - Include cost summary in final report

### New Files Created

1. `src/council/cost-tracker.ts` - Budget tracking
2. `src/council/cost-policies.ts` - Routing and enforcement
3. `src/council/cost-aware-llm-caller.ts` - LLM wrapper
4. `configs/councils/cost-first.json` - Default preset
5. `tests/cost-tracker.test.ts` - Test suite
6. `scripts/cost-benchmark.ts` - Benchmark tool

## Operational Notes

### Log Analysis

**Finding downgrade events**:
```bash
grep "DOWNGRADE" council.log
```

**Finding blocked Anthropic calls**:
```bash
grep "ANTHROPIC_BLOCKED" council.log
```

**Budget status over time**:
```bash
grep "CostTracker:SPEND" council.log | awk '{print $NF}'
```

### Monitoring

Track these metrics in production:

- Average utilization per run (target: 60-80%)
- Downgrade rate (target: <30% of calls)
- Stage skip rate (target: <10% of runs)
- Anthropic spend as % of total (target: <40%)

### Tuning

To adjust thresholds:

```typescript
// Adjust in cost-policies.ts
export const COST_FIRST_PRESET = {
  ...
  thresholds: {
    compactContextAt: 0.65,      // More aggressive
    blockAnthropicAt: 0.80,      // Block earlier
    skipOptionalAt: 1.00,        // Never skip (always 1.0)
  },
};
```

## Known Limitations

1. **Token estimation**: Uses 40/60 input/output split (approximation)
2. **No streaming cost tracking**: Cost calculated after full response
3. **Cache hits not modeled**: Anthropic cache savings not factored into routing
4. **Stage mapping**: Requires manual mapping of deliberation phases to stages

## Future Enhancements (v2)

1. Real-time streaming cost tracking
2. Anthropic cache-aware routing
3. Per-persona budget pools
4. Dynamic threshold adjustment based on task complexity
5. Cost prediction model (ML-based)

---

**Last Updated**: 2026-04-02  
**Version**: 1.0.0  
**Status**: Production Ready
