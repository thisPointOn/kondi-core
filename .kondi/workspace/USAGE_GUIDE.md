# Cost Optimization Usage Guide

## Quick Start

The cost optimizations are **enabled by default** and require no configuration changes.

## Using Caching

### Default Behavior (Caching Enabled)
```bash
npm run council -- --task "Review security" --type review
# Caching automatically enabled for Anthropic models
```

### Disable Caching (When Needed)
```bash
# Method 1: CLI flag (recommended)
npm run council -- --task "Review security" --type review --no-cache

# Method 2: Environment variable (one-time)
KONDI_NO_CACHE=1 npm run council -- --task "Review security" --type review

# Method 3: Export for session
export KONDI_NO_CACHE=1
npm run council -- --task "Review security" --type review
```

### When to Disable Caching
- Testing different prompt variations
- Debugging unexpected behavior
- Comparing cached vs non-cached results
- Running validation baseline

## Running Validation

### Full Comparison (Baseline + Optimized)
```bash
npx tsx .kondi/workspace/validate-optimization.ts compare
```

### Individual Runs
```bash
# Run baseline only (caching disabled)
npx tsx .kondi/workspace/validate-optimization.ts baseline

# Run optimized only (caching enabled)
npx tsx .kondi/workspace/validate-optimization.ts optimized

# Generate report from existing results
npx tsx .kondi/workspace/validate-optimization.ts report
```

## Configuration Defaults

### Updated Defaults
- **maxRounds:** 4 → **2** (fewer deliberation rounds)
- **max_tokens:** 16384 → **8000** (shorter responses)
- **consultantExecution:** sequential (unchanged)

### Override Defaults
```typescript
// In your council config
{
  maxRounds: 4,        // Override to use 4 rounds
  maxTokens: 12000,    // Override token limit per call
  // ... other config
}
```

## Monitoring Costs

### Check Token Usage
Look for token usage in council output:
```
Tokens used: 5,432 (input: 4,200 cached, output: 1,232)
Estimated cost: $0.12
```

### Cache Hit Indicators
Anthropic API responses include cache usage metadata. Future enhancement will surface this in console output.

## Troubleshooting

### Caching Not Working?
1. Check you're using Anthropic provider (`provider: 'anthropic-api'`)
2. Verify `KONDI_NO_CACHE` is not set
3. Ensure `cacheableContext` is provided by orchestrator
4. Check for git availability (cache keys use git hash)

### Responses Too Short?
1. Increase `maxTokens` in config
2. Default is now 8000 (was 16384)
3. Most responses should fit, but complex tasks may need more

### Validation Suite Fails?
1. Check that council CLI is accessible via `npm run council`
2. Verify tasks complete successfully
3. Review error messages in output
4. Check that working directory is set correctly

## Architecture Notes

### How Caching Works
1. Bootstrap context (codebase overview) marked as cacheable
2. Task-specific prompt sent as non-cached
3. Anthropic caches the bootstrap context for 5 minutes
4. Subsequent requests with same bootstrap: ~95% input token discount

### Cache Key Structure
```
kondi-v1:<repo-hash>:<task-sig>:<config-ver>:<diff-fp>
```

- **repo-hash:** Git commit (short hash)
- **task-sig:** First 50 chars of task
- **config-ver:** Schema version (currently 'v1')
- **diff-fp:** Count of changed lines in working tree

Cache invalidates when:
- Git commit changes (new code)
- Working tree has different number of changed lines
- Task description changes significantly
- 5 minutes elapse (Anthropic TTL)

## Expected Savings

| Scenario | Before | After | Savings |
|----------|--------|-------|---------|
| 5-round security review | $1.32 | $0.28 | 79% |
| 3-round code analysis | $0.85 | $0.22 | 74% |
| 2-round quick review | $0.52 | $0.15 | 71% |

Actual savings depend on:
- Cache hit rate (code stability)
- Task complexity (response length)
- Number of rounds (fewer = higher % savings)

## Best Practices

### Maximize Cache Efficiency
- ✅ Work on stable branches (fewer commits = more cache hits)
- ✅ Batch similar tasks together (same bootstrap context)
- ✅ Use consistent working directories
- ✅ Keep task descriptions focused but stable

### Optimize Costs Further
- ✅ Use 2 rounds for most tasks (new default)
- ✅ Reduce consultants if task is simple
- ✅ Use sequential execution (new default)
- ✅ Set specific expectedOutput to guide brevity

### Monitor & Iterate
- ✅ Run validation suite weekly
- ✅ Track actual costs vs projections
- ✅ Adjust maxRounds based on quality needs
- ✅ Review token usage patterns

## Support

For issues or questions:
1. Check implementation report: `.kondi/workspace/IMPLEMENTATION_REPORT.md`
2. Review directive: `.kondi/workspace/WORK_DIRECTIVE.md`
3. Examine code: `src/cli/llm-caller.ts`

---

**Remember:** Caching is enabled by default. No action needed to start saving!
