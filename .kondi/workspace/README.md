# Cost-First Policy Implementation

This directory contains the **v1 Cost-First Policy** implementation for kondi-council.

## What's Included

### Core Modules

1. **`cost-tracker.ts`** - Budget tracking and spend monitoring
2. **`cost-policies.ts`** - Policy engine and routing logic
3. **`cost-aware-llm-caller.ts`** - LLM wrapper with budget enforcement

### Configuration

4. **`cost-first.json`** - Default cost-first preset ($3.00 run cap)

### Testing & Benchmarking

5. **`cost-tracker.test.ts`** - Comprehensive test suite
6. **`cost-benchmark.ts`** - Cost comparison benchmark

### Documentation

7. **`COST_FIRST_POLICY.md`** - Complete policy documentation

## Quick Start

### Run Benchmark

```bash
npx tsx cost-benchmark.ts
```

### Run Tests

```bash
npm test -- cost-tracker.test.ts
```

## Files Created

```
.kondi/workspace/
├── cost-tracker.ts
├── cost-policies.ts
├── cost-aware-llm-caller.ts
├── cost-first.json
├── cost-tracker.test.ts
├── cost-benchmark.ts
├── COST_FIRST_POLICY.md
└── README.md
```

## Expected Behavior

✓ Run cap never exceeded ($3.00 hard limit)
✓ Stage caps enforced (20/35/30/15% allocation)
✓ 70% → Compact context mode
✓ 85% → Anthropic blocked
✓ 100% → Optional stages skipped
✓ ≥40% Anthropic spend reduction vs baseline

---

**Status**: Implementation Complete ✓
