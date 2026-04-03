# Phase 1: Bootstrap Context Caching Implementation Directive

## OBJECTIVE
Wire Anthropic prompt caching through the full invocation chain to cache bootstrap directory context, reducing costs by ~55% on repeated council executions. Bootstrap context is injected into every consultant/worker prompt and rarely changes between councils, making it ideal for caching.

## BACKGROUND
The codebase already has:
- `llm-caller.ts`: Implements Anthropic prompt caching via `enableCache` and `cacheableContext` parameters
- Orchestrators: Store `bootstrappedContext` (directory scan) and inject it into every agent prompt
- Current gap: The `cacheableContext` is not passed through `invokeAgent` → `callLLM` chain

## TASKS

### Task 1: Extend AgentInvocation Type
**File**: `/home/erik/Documents/kondi-council/src/council/deliberation-orchestrator.ts` (line ~93) AND `/home/erik/Documents/kondi-council/src/council/coding-orchestrator.ts` (line ~56)

**Action**: Add `cacheableContext` field to the `AgentInvocation` interface:

```typescript
export interface AgentInvocation {
  personaId: string;
  systemPrompt: string;
  userMessage: string;
  skipTools?: boolean;
  allowedTools?: string[];
  allowedServerIds?: string[];
  workingDirectory?: string;
  timeoutMs?: number;
  cacheableContext?: string;  // <-- ADD THIS LINE
}
```

### Task 2: Wire Cacheable Context in Orchestrators
**Files**: 
- `/home/erik/Documents/kondi-council/src/council/deliberation-orchestrator.ts` (in `invokeAgentSafe`, around line 2272-2280)
- `/home/erik/Documents/kondi-council/src/council/coding-orchestrator.ts` (in `invokeAgentSafe`, around line 918-926)

**Current code** (both files have similar logic):
```typescript
// Inject bootstrapped context into every prompt — same instruction for all models.
if (this.bootstrappedContext) {
  const hasContext = invocation.userMessage.includes(this.bootstrappedContext.slice(0, 100));
  if (!hasContext) {
    invocation = {
      ...invocation,
      userMessage: `## PROJECT CONTEXT\n\nThe complete source code and project structure are provided below. This is your primary source of information. Analyze the code directly from what is provided here.\n\n${this.bootstrappedContext}\n\n---\n\n${invocation.userMessage}`,
    };
  }
}
```

**Replace with**:
```typescript
// Inject bootstrapped context into every prompt — cacheable if prompt caching is enabled.
if (this.bootstrappedContext) {
  const hasContext = invocation.userMessage.includes(this.bootstrappedContext.slice(0, 100));
  if (!hasContext) {
    // Instead of injecting into userMessage, pass as separate cacheableContext
    // so Anthropic's prompt caching can deduplicate it across calls
    invocation = {
      ...invocation,
      cacheableContext: `## PROJECT CONTEXT\n\nThe complete source code and project structure are provided below. This is your primary source of information. Analyze the code directly from what is provided here.\n\n${this.bootstrappedContext}`,
      userMessage: invocation.userMessage, // Keep userMessage clean
    };
  }
}
```

### Task 3: Pass Cacheable Context Through invokeAgent
**File**: `/home/erik/Documents/kondi-council/src/cli/run-council.ts` (line ~349-366)

**Current code**:
```typescript
const invokeAgent = async (invocation: any, persona: Persona) => {
  log(C.cyan, persona.name, `Thinking... (${persona.model})`);

  const result = await callLLM({
    provider: persona.provider || 'anthropic-api',
    systemPrompt: invocation.systemPrompt,
    userMessage: invocation.userMessage,
    model: persona.model,
    workingDir: invocation.workingDirectory || workingDir,
    skipTools: invocation.skipTools,
    allowedTools: invocation.allowedTools,
    timeoutMs: invocation.timeoutMs || 900_000,
    enableCache: !args.noCache,
  });

  log(C.cyan, persona.name, `Done (${result.tokensUsed} tokens, ${(result.latencyMs / 1000).toFixed(1)}s)`);
  return { ...result, sessionId: result.sessionId };
};
```

**Replace with**:
```typescript
const invokeAgent = async (invocation: any, persona: Persona) => {
  log(C.cyan, persona.name, `Thinking... (${persona.model})`);

  const result = await callLLM({
    provider: persona.provider || 'anthropic-api',
    systemPrompt: invocation.systemPrompt,
    userMessage: invocation.userMessage,
    model: persona.model,
    workingDir: invocation.workingDirectory || workingDir,
    skipTools: invocation.skipTools,
    allowedTools: invocation.allowedTools,
    timeoutMs: invocation.timeoutMs || 900_000,
    enableCache: !args.noCache,
    cacheableContext: invocation.cacheableContext,  // <-- ADD THIS LINE
  });

  log(C.cyan, persona.name, `Done (${result.tokensUsed} tokens, ${(result.latencyMs / 1000).toFixed(1)}s)`);
  return { ...result, sessionId: result.sessionId };
};
```

### Task 4: Add Cache Metrics Logging
**File**: `/home/erik/Documents/kondi-council/src/cli/llm-caller.ts` (line ~139-194, in `callAnthropicAPI`)

**Current code** (around line 183-194):
```typescript
const data = await resp.json();
const content = data.content
  ?.filter((b: any) => b.type === 'text')
  .map((b: any) => b.text)
  .join('\n') || '';
const usage = data.usage || {};

return {
  content,
  tokensUsed: (usage.input_tokens || 0) + (usage.output_tokens || 0),
  latencyMs: Date.now() - start,
};
```

**Replace with**:
```typescript
const data = await resp.json();
const content = data.content
  ?.filter((b: any) => b.type === 'text')
  .map((b: any) => b.text)
  .join('\n') || '';
const usage = data.usage || {};

// Log cache performance metrics
const cacheCreationTokens = usage.cache_creation_input_tokens || 0;
const cacheReadTokens = usage.cache_read_input_tokens || 0;
const inputTokens = usage.input_tokens || 0;
const outputTokens = usage.output_tokens || 0;

if (enableCache && cacheableContext) {
  const cacheStatus = cacheReadTokens > 0 ? 'HIT' : cacheCreationTokens > 0 ? 'MISS (created)' : 'MISS';
  console.log(
    `[Cache:${cacheStatus}] input=${inputTokens} output=${outputTokens} ` +
    `cached=${cacheReadTokens} created=${cacheCreationTokens} ` +
    `savings=${cacheReadTokens > 0 ? Math.round((cacheReadTokens / (inputTokens + cacheReadTokens)) * 100) : 0}%`
  );
}

return {
  content,
  tokensUsed: inputTokens + outputTokens,
  latencyMs: Date.now() - start,
};
```

### Task 5: Add Feature Flag Support
**File**: `/home/erik/Documents/kondi-council/src/council/types.ts` (in `DeliberationConfig` interface, find it in the file)

**Action**: Add a `enablePromptCaching` field to `DeliberationConfig`:

```typescript
export interface DeliberationConfig {
  // ... existing fields ...
  
  /** Enable Anthropic prompt caching for bootstrap context (default: true) */
  enablePromptCaching?: boolean;
}
```

**File**: `/home/erik/Documents/kondi-council/src/cli/run-council.ts` (line ~361)

**Current code**:
```typescript
enableCache: !args.noCache,
```

**Replace with**:
```typescript
enableCache: !args.noCache && (council.deliberation?.enablePromptCaching ?? true),
```

### Task 6: Update CLI Help Text
**File**: `/home/erik/Documents/kondi-council/src/cli/run-council.ts` (line ~127-165, in `printHelp`)

**Current help text** includes:
```
  --no-cache             Disable Anthropic prompt caching (same as KONDI_NO_CACHE=1)
```

**Update to**:
```
  --no-cache             Disable Anthropic prompt caching for bootstrap context (default: enabled)
```

## VALIDATION

After making these changes, test with:

```bash
# Test 1: Verify caching is active (should see cache creation on first run)
cd /home/erik/Documents/kondi-council
npm run council -- --task "Analyze this codebase" --working-dir ./src --type analysis

# Expected output: "[Cache:MISS (created)]" in logs

# Test 2: Verify cache hit on second run (within 5 minutes)
npm run council -- --task "Analyze this codebase again" --working-dir ./src --type analysis

# Expected output: "[Cache:HIT]" with high savings % in logs

# Test 3: Verify --no-cache disables caching
npm run council -- --task "Test without cache" --working-dir ./src --type analysis --no-cache

# Expected output: No cache logging
```

## CONSTRAINTS

1. **DO NOT modify any logic in `llm-caller.ts` except the cache metrics logging section** — caching implementation already works
2. **DO NOT change how bootstrapContext is generated** — only change how it's passed to the LLM
3. **DO NOT modify config loading or council factory logic** — focus only on the invocation chain
4. **Preserve backward compatibility** — `cacheableContext` is optional, existing code must work without it
5. **Keep all existing error handling** — don't remove or modify retry logic, timeouts, or error paths

## ACCEPTANCE CRITERIA

- [ ] `AgentInvocation` interface has `cacheableContext` field in both orchestrators
- [ ] `invokeAgentSafe` in both orchestrators passes bootstrap context as `cacheableContext` instead of injecting into `userMessage`
- [ ] `run-council.ts` invokeAgent callback passes `cacheableContext` to `callLLM`
- [ ] Cache metrics logged to console with hit/miss status and savings percentage
- [ ] `enablePromptCaching` feature flag added to `DeliberationConfig` and wired through CLI
- [ ] No existing tests broken (if any exist)
- [ ] Manual validation shows cache hits on repeated calls with same working directory

## NOTES

- Bootstrap context is typically 10-50KB of directory listings and file contents
- Anthropic's cache TTL is 5 minutes — cache hits only occur if repeated calls happen within this window
- Cache savings are ~90% reduction in input token costs for cached content (billed at 10% of normal rate)
- This implementation is Phase 1 only — progressive summarization and model tiering come in later phases
