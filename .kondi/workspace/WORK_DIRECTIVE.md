# WORK DIRECTIVE: Implement Cost Optimization (Phase 1)

## OBJECTIVE

Reduce token costs by 70-90% through two targeted changes:
1. Implement Anthropic prompt caching
2. Update default token limits

## TASKS TO COMPLETE

### Task 1: Implement Anthropic Prompt Caching

**File:** `src/cli/llm-caller.ts`

**What to do:**

1. **Add cache key generation utility** (new function at top of file, after imports):
   ```typescript
   interface CacheKeyOptions {
     repoHash: string;
     taskSignature: string;
     configVersion: string;
     diffFingerprint: string;
   }

   function generateCacheKey(opts: CacheKeyOptions): string {
     return `kondi-v1:${opts.repoHash}:${opts.taskSignature}:${opts.configVersion}:${opts.diffFingerprint}`;
   }

   async function getRepoDiffFingerprint(workingDir: string): Promise<string> {
     // Generate fingerprint from git diff if available, else empty string
     try {
       const { execSync } = await import('node:child_process');
       const diff = execSync('git diff HEAD', { cwd: workingDir, encoding: 'utf-8', timeout: 5000 });
       // Simple hash: count lines changed
       const linesChanged = diff.split('\n').length;
       return `diff-${linesChanged}`;
     } catch {
       return 'no-git';
     }
   }

   async function getRepoHash(workingDir: string): Promise<string> {
     try {
       const { execSync } = await import('node:child_process');
       const hash = execSync('git rev-parse --short HEAD', { cwd: workingDir, encoding: 'utf-8', timeout: 5000 }).trim();
       return hash;
     } catch {
       return 'no-repo';
     }
   }
   ```

2. **Update CallLLMOpts interface** to include caching options:
   ```typescript
   interface CallLLMOpts {
     provider: string;
     model?: string;
     systemPrompt: string;
     userMessage: string;
     workingDir?: string;
     skipTools?: boolean;
     timeoutMs?: number;
     enableCache?: boolean;        // NEW: default true
     cacheableContext?: string;    // NEW: optional bootstrap context to cache
   }
   ```

3. **Modify `callAnthropicAPI` function** to support caching:
   - Accept new parameters: `enableCache?: boolean, cacheableContext?: string`
   - If `enableCache === true` and `cacheableContext` is provided:
     - Split the system prompt into two parts: cacheableContext (marked cacheable) + remaining systemPrompt
     - Use Anthropic's `cache_control` API format (see below)
   - If `enableCache === false` or no cacheableContext: use existing behavior (no changes)

   **Anthropic cache_control format:**
   ```typescript
   // Instead of:
   system: systemPrompt,

   // Use:
   system: [
     {
       type: "text",
       text: cacheableContext,
       cache_control: { type: "ephemeral" }
     },
     {
       type: "text", 
       text: remainingSystemPrompt
     }
   ],
   ```

4. **Update the function signature:**
   ```typescript
   async function callAnthropicAPI(
     apiKey: string,
     model: string,
     systemPrompt: string,
     userMessage: string,
     enableCache?: boolean,
     cacheableContext?: string,
   ): Promise<CallerResult>
   ```

5. **Update `callLLM` router** to pass through caching parameters:
   ```typescript
   if (provider === 'anthropic-api') {
     return callAnthropicAPI(
       apiKey!, 
       model, 
       opts.systemPrompt, 
       opts.userMessage,
       opts.enableCache ?? true,  // Default to enabled
       opts.cacheableContext
     );
   }
   ```

6. **Add CLI flag support** in `callLLM`:
   - Check for `process.env.KONDI_NO_CACHE` or a `--no-cache` flag presence
   - If present, force `enableCache = false`

### Task 2: Update Default Token Limits

**File:** `src/cli/llm-caller.ts`

**What to do:**

1. **Update hardcoded max_tokens values:**
   - In `callAnthropicAPI`: Change `max_tokens: 16384` → `max_tokens: 8000`
   - In `callOpenAICompatible`: Change `max_tokens: 16384` → `max_tokens: 8000`
   - In `callGeminiAPI`: Change `maxOutputTokens: 16384` → `maxOutputTokens: 8000`

2. **Add role-specific max_tokens** (optional enhancement if time permits):
   - Add `maxTokens?: number` to `CallLLMOpts` interface
   - Use `opts.maxTokens || 8000` in each provider function
   - This allows callers to override per-role (consultants: 6k, manager/worker: 8k)

### Task 3: Create Validation Test Suite

**File:** `scripts/validate-optimization.ts` (new file)

**What to do:**

Create a TypeScript script that:

1. **Runs 3-5 representative council tasks** before and after the changes:
   - Security review task
   - Performance analysis task  
   - Type safety check task
   - Code review task (optional)
   - Dependency audit task (optional)

2. **Captures metrics** for each run:
   - Total tokens used
   - Number of findings
   - Severity distribution (critical, major, minor)
   - File/line references count
   - Estimated cost (tokens × $0.003 per 1k input tokens for Claude Sonnet 4.5)

3. **Compares results:**
   - ✅ ≥70% cost reduction (tokens)
   - ✅ ≥95% critical issue overlap (same P0/critical findings appear)
   - ✅ No drop in highest severity findings
   - ✅ File/line references maintain same specificity

4. **Output format:**
   - Print comparison table to console
   - Write results to `validation-results.json`

**Example structure:**
```typescript
#!/usr/bin/env npx tsx

interface TestTask {
  name: string;
  task: string;
  type: 'review' | 'analysis';
  expectedCriticalFindings?: string[];
}

const VALIDATION_TASKS: TestTask[] = [
  {
    name: 'Security Review',
    task: 'Review this codebase for security vulnerabilities',
    type: 'review'
  },
  // Add 2-4 more tasks
];

async function runValidation() {
  // Run each task, capture metrics, compare
  // Use callLLM directly or spawn kondi council processes
}

runValidation();
```

### Task 4: Update Configuration Defaults

**Files to modify:**

1. **`src/council/factory.ts`** - update default config values in `createCouncilFromSetup`:
   - Find where `maxRounds` defaults are set → change `maxRounds: 3` to `maxRounds: 2`
   - Find where `consultantExecution` defaults are set → change to `consultantExecution: 'sequential'`

2. **Verify in `src/council/types.ts`** - check DeliberationConfig interface has correct defaults in comments

## CONSTRAINTS

### MUST FOLLOW

1. **Backward compatibility**: Existing council configs MUST continue working
   - All caching features are opt-in or default-enabled with escape hatches
   - `--no-cache` flag or `KONDI_NO_CACHE=1` env var disables caching
   - Non-Anthropic providers continue working unchanged

2. **No breaking API changes**:
   - All new parameters in CallLLMOpts are optional
   - Existing callLLM() calls work without modification

3. **Error handling**:
   - If cache key generation fails, fall back to non-cached mode
   - If git commands fail, use fallback values
   - Never crash on caching errors

4. **No external dependencies**:
   - Use only Node.js built-ins (child_process, crypto, fs)
   - Do not add new npm packages

### MUST NOT DO

1. Do NOT modify how non-Anthropic providers work
2. Do NOT change the public API of callLLM (only add optional params)
3. Do NOT add dependencies to package.json
4. Do NOT modify existing council config files in examples/
5. Do NOT implement Phase 2 features (budget enforcement, real-time tracking, rolling summaries)

## ACCEPTANCE CRITERIA

### Functional Requirements

- [ ] `callLLM()` accepts `enableCache` and `cacheableContext` parameters
- [ ] Anthropic API calls include `cache_control` blocks when caching enabled
- [ ] Cache keys incorporate repo hash, task signature, config version, diff fingerprint
- [ ] Non-Anthropic providers work unchanged
- [ ] Default max_tokens reduced to 8000 across all providers
- [ ] `KONDI_NO_CACHE=1` environment variable disables caching
- [ ] Existing council configs run without modification

### Quality Requirements

- [ ] Code compiles without TypeScript errors (`npx tsc --noEmit`)
- [ ] No console errors when running `npm run council -- --task "test task" --dry-run`
- [ ] Validation suite runs and produces comparison table
- [ ] All new functions have JSDoc comments

### Testing Requirements

- [ ] Validation suite includes 3-5 representative tasks
- [ ] Validation suite captures before/after metrics
- [ ] Validation suite outputs comparison table
- [ ] Manual test: Run `npm run council -- --task "Review codebase for issues" --type review`
- [ ] Manual test: Run with `KONDI_NO_CACHE=1` and verify caching disabled

## IMPLEMENTATION NOTES

### Cache Key Design

The cache key must balance stability (avoid excessive invalidation) with freshness (avoid stale results):

```
kondi-v1:<repo-hash>:<task-sig>:<config-ver>:<diff-fp>
```

- `repo-hash`: git rev-parse --short HEAD (stable across small edits)
- `task-sig`: first 50 chars of task string (identifies problem type)
- `config-ver`: "v1" hardcoded for now (bump if config schema changes)
- `diff-fp`: count of changed lines from `git diff HEAD` (invalidates on code changes)

### Anthropic Caching API

From Anthropic docs:
```json
{
  "model": "claude-sonnet-4-5-20250929",
  "max_tokens": 8000,
  "system": [
    {
      "type": "text",
      "text": "Long bootstrap context here...",
      "cache_control": { "type": "ephemeral" }
    },
    {
      "type": "text",
      "text": "Additional prompt here"
    }
  ],
  "messages": [...]
}
```

Cache hits reduce input token costs by ~95%. Cache TTL is 5 minutes (Anthropic managed).

### Token Limit Rationale

New defaults:
- **Consultants**: 6000 tokens (95% of consultant responses <4k tokens based on empirical data)
- **Manager/Worker**: 8000 tokens (complex decisions and code can exceed 6k)

Per-role limits require passing role info to callLLM. If time is short, start with uniform 8000 limit.

### Validation Suite Tips

- Use small test repos or synthetic code samples
- Run with `--quiet --json-stdout` to capture structured output
- Parse JSON results to extract findings and token counts
- Store baseline results in `validation-baseline.json`
- Compare new results against baseline

## FILE PATHS

All file operations use ABSOLUTE PATHS from project root:
- `/home/erik/Documents/kondi-council/src/cli/llm-caller.ts`
- `/home/erik/Documents/kondi-council/scripts/validate-optimization.ts` (new)
- `/home/erik/Documents/kondi-council/src/council/factory.ts`

Write NEW validation script to:
- `/home/erik/Documents/kondi-council/.kondi/workspace/validate-optimization.ts`

## DONE DEFINITION

Implementation is complete when:

1. All code changes committed to files
2. TypeScript compiles without errors
3. Validation suite script created and executable
4. At least one manual test confirms caching works
5. Documentation comment added to callAnthropicAPI explaining cache_control usage
6. A summary report written to `/home/erik/Documents/kondi-council/.kondi/workspace/IMPLEMENTATION_REPORT.md` containing:
   - What was changed
   - How to test it
   - Any deviations from spec
   - Validation results (if ran)

## PRIORITY ORDER

If time is limited, implement in this order:

1. **CRITICAL**: Anthropic caching in llm-caller.ts (70% of value)
2. **HIGH**: Default token limits update (20% of value)
3. **MEDIUM**: Validation suite skeleton (testing infrastructure)
4. **LOW**: Full validation suite with 5 tasks

Focus on getting #1 and #2 working correctly before moving to validation.

---

**Next Action:** Start with Task 1 - implement caching in `src/cli/llm-caller.ts`. Read the file, understand the current structure, then implement the changes.
