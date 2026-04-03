# PROBLEM STATEMENT: Reduce Kondi Council LLM API Costs (Phase 2-4 Optimizations)

## ⚡ UPDATE: Phase 1 COMPLETED (Bootstrap Caching)
**Status**: ✅ Implemented 2 weeks ago, **~55% expected cost reduction**
- Bootstrap context now passed as `cacheableContext` parameter
- Anthropic prompt caching enabled (90% discount on cached tokens)
- Feature flags added (`--no-cache`, `enablePromptCaching` config)
- **Remaining cost target**: $1.49 → $0.30-$0.50 (additional 66-80% reduction needed)

See `.kondi/workspace/phase1-implementation-summary.md` for details.

---

## CONTEXT: What background does the team need?

### System Architecture
Kondi Council is a **multi-agent deliberation system** that orchestrates structured debates between AI personas (manager, consultants, workers) to solve complex problems. The system runs through deterministic phases:

1. **Problem Framing** - Manager creates structured problem statement
2. **Deliberation Rounds** (1-4 rounds) - Consultants analyze independently, then debate interactively
3. **Manager Evaluation** - Manager reviews each round and decides: continue, redirect, or decide
4. **Decision & Planning** - Manager makes final decision and creates execution plan
5. **Execution** - Worker implements the solution
6. **Review** - Manager reviews worker output, may request revisions

**Codebase Size**: ~76 TypeScript files, ~50k lines of code, mature system with integrations

### Current Implementation (Key Files)
- **`src/cli/llm-caller.ts`** - LLM API router with Anthropic caching support (partial)
- **`src/council/deliberation-orchestrator.ts`** - 2,100 lines - Core state machine, invokes agents
- **`src/council/prompts.ts`** - 1,690 lines - Prompt construction for all roles
- **`src/council/ledger-store.ts`** - 440 lines - Append-only audit trail storage
- **`src/council/context-store.ts`** - 760 lines - Context artifacts and patches
- **`src/council/context-bootstrap.ts`** - 150 lines - Directory scanning for source code context

### Cost Drivers - Root Cause Analysis

#### 1. **Massive Context Repetition** (PRIMARY ISSUE)
Every LLM call receives the full deliberation history via `buildRoundNContext()` and `buildManagerEvalContext()`:

```typescript
// src/council/deliberation-orchestrator.ts:1879-1935
buildRoundNContext(council: Council, includeCurrentRound: boolean = false): string {
  let result = `SHARED CONTEXT (v${context.version}):\n${context.content}\n\n---\n`;
  
  // ALL prior rounds: full entries (unless summarization enabled)
  for (let r = 1; r < currentRound; r++) {
    const roundEntries = getEntriesForRound(council.id, r);
    result += `\nROUND ${r}:\n`;
    result += formatEntriesForContext(roundEntries); // ← FULL CONTENT
  }
  
  // In sequential mode, include current round entries so later consultants
  // can see what earlier consultants said in this round
  if (includeCurrentRound) {
    const consultantEntries = currentRoundEntries.filter(e => e.authorRole === 'consultant');
    result += formatEntriesForContext(consultantEntries); // ← MORE FULL CONTENT
  }
  
  return result;
}
```

**Impact:** 
- Round 1: 3 consultants × ~30k input tokens each = 90k tokens
- Round 2: 3 consultants × ~50k input tokens each = 150k tokens (history grows)
- Round 3: 3 consultants × ~70k input tokens each = 210k tokens
- **Total input tokens: ~450k-600k for deliberation rounds alone**

#### 2. **Bootstrap Context Bloat**
When `bootstrapContext: true`, every persona receives full source code:

```typescript
// src/council/context-bootstrap.ts:44-129
const MAX_TOTAL_CHARS_DEEP = 120000; // ~30k tokens

export async function bootstrapDirectoryContext(workingDir: string, { deep: true }): Promise<string> {
  // Reads ALL source files up to 120k chars
  // Prepended to EVERY agent call (manager, consultants, worker)
}
```

**Impact:**
- 30,000 bootstrap tokens × 25 API calls = **750k extra input tokens per council**
- Manager and consultants don't need full source code - only worker does
- Anthropic caching could help but `cacheableContext` parameter rarely passed

#### 3. **Excessive API Call Count**
Typical council with 3 consultants, 3 rounds:

| Phase | Calls | Input Tokens (avg) | Output Tokens (avg) |
|-------|-------|-------------------|---------------------|
| Manager framing | 1 | 30k | 2k |
| Round 1 (3 consultants) | 3 | 35k each | 3k each |
| Manager eval round 1 | 1 | 40k | 1k |
| Round 2 (3 consultants) | 3 | 55k each | 3k each |
| Manager eval round 2 | 1 | 60k | 1k |
| Round 3 (3 consultants) | 3 | 75k each | 3k each |
| Manager eval round 3 | 1 | 80k | 1k |
| Manager decision | 1 | 80k | 3k |
| Manager plan | 1 | 10k | 2k |
| Manager directive | 1 | 10k | 2k |
| Worker execution | 1 | 35k | 5k |
| Manager review | 1 | 50k | 2k |
| **TOTAL** | **18 calls** | **~800k input** | **~40k output** |

**Anthropic Claude Sonnet 4.5 Pricing:**
- Input: $3/1M tokens
- Output: $15/1M tokens
- **Total cost: (800k × $3 + 40k × $15) / 1M = $2.40 + $0.60 = $3.00**

With revisions and re-deliberations: **$5-$10 per council easily**

Multiple councils per day + complex coding tasks with 5+ consultants: **$50-$200/day**

#### 4. **Sequential Execution Amplifies Growth**
Config option `consultantExecution: 'sequential'` means:
- Consultant 1 sees: base context (35k tokens)
- Consultant 2 sees: base context + Consultant 1's response (38k tokens)
- Consultant 3 sees: base context + Consultant 1 + Consultant 2 (41k tokens)

**Exponential growth within a single round.**

#### 5. **✅ SOLVED: Bootstrap Context Caching (Phase 1)**
Code now fully wired:

```typescript
// src/cli/llm-caller.ts:131-194
async function callAnthropicAPI(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  enableCache?: boolean,
  cacheableContext?: string, // ← NOW PASSED by orchestrator
  maxTokens?: number,
): Promise<CallerResult> {
  if (enableCache && cacheableContext) {
    systemContent = [
      { type: "text", text: cacheableContext, cache_control: { type: "ephemeral" } },
      { type: "text", text: systemPrompt }
    ];
  }
}
```

**Status:** Bootstrap context (30k tokens) now cached across all calls → **55% cost reduction**

**Remaining Gap:** Shared context artifact (evolving v1→v2→v3) and ledger history still NOT cached

#### 6. **No Token Budget Enforcement**
Config has `contextTokenBudget: 80000` but:
- No hard truncation if exceeded
- Summarization is optional (`summaryMode: 'manager'` requires extra API call)
- Only triggers at 30% of budget or round 3+

```typescript
// src/council/deliberation-orchestrator.ts:2076-2095
shouldSummarize(council: Council): boolean {
  if (config.summaryMode === 'none') return false;
  if (currentRound <= 1) return false;
  
  const tokenCount = getLedgerTokenCount(council.id);
  if (tokenCount > config.contextTokenBudget * 0.3) return true; // ← Too late!
  if (currentRound >= 3) return true;
  
  return false;
}
```

#### 7. **No Provider/Model Tiering**
All personas use the same expensive model (Claude Sonnet 4.5):
- Manager framing: needs intelligence ✓
- Consultants: need intelligence ✓
- Manager review: could use cheaper model for simple checks
- Summarization: could use Gemini Flash (90% cheaper)

**No cost-aware routing exists.**

#### 8. **Large Default Output Limits**
```typescript
max_tokens: 8000  // Every response can be up to 8k tokens
```

Consultants often write 3k-5k token responses. Manager prompts say "be concise" but no enforcement.

---

## PROBLEM: What specific question must be answered?

**How can we reduce Kondi Council's LLM API costs by an additional 66-80% (Phase 2-4) without sacrificing deliberation quality?**

With Phase 1 complete ($3.35 → $1.49), we need to answer:

### Phase 2: Progressive Summarization (Target: $1.49 → $0.69)
1. **How do we minimize context repetition** while maintaining coherent multi-round deliberations?
   - Which rounds to summarize? Mechanical vs. LLM-based summarization?
   - How to preserve critical insights from early rounds?
   - When does the manager need full history vs. summaries?

### Phase 3: Model Tiering (Target: $0.69 → $0.39)
2. **How do we tier model usage** to route simple tasks to cheaper providers?
   - Which tasks can safely use Gemini Flash (40× cheaper)?
   - How to validate quality doesn't degrade with cheaper models?
   - What's the fallback strategy for rate limits?

### Phase 4: Call Reduction (Target: $0.39 → $0.30)
3. **How do we reduce the number of API calls** without losing collaborative value?
   - Can we auto-continue Round 1 (skip manager evaluation)?
   - Can we merge decision + directive prompts?
   - Should consultant reviews be parallel instead of individual?

### Cross-Cutting Concerns
4. **How do we enforce token budgets** without breaking mid-deliberation?
5. **How do we extend caching** beyond bootstrap context (shared artifacts, ledger history)?

---

## CONSTRAINTS: Non-negotiable requirements

### Must Preserve
1. **Deliberation Quality** - Consultants must see enough context to build on prior arguments
2. **Manager Authority** - Manager must have full context to make informed decisions
3. **Audit Trail** - Ledger must remain append-only and complete (no data loss)
4. **Type Safety** - Solution must work within existing TypeScript types
5. **Backward Compatibility** - Existing council configs must continue to work

### Must Not
1. **Break Anthropic Caching** - Solution should enhance, not break, existing cache support
2. **Require Rewrites** - Prefer targeted optimizations over full refactor (10k LOC codebase)
3. **Add External Dependencies** - No new npm packages unless critical
4. **Lose Structured Phases** - State machine must remain deterministic

### Technical Constraints
- Node.js 20+ environment
- API calls via `callLLM()` in `llm-caller.ts`
- Context built via functions in `deliberation-orchestrator.ts`
- Storage via `ledger-store.ts` and `context-store.ts`

---

## DESIRED OUTCOME: What does a good solution look like?

### Success Metrics (Phase 2-4)
1. **Cost Reduction:** Additional 66-80% reduction beyond Phase 1
   - Starting point: $1.49 per council (after Phase 1)
   - Target: $0.30-$0.50 per council
   - **Total reduction from original: 85-91%**
2. **Context Efficiency:** 50%+ reduction in input tokens per call
   - Current (post-Phase 1): ~450k input tokens (bootstrap cached)
   - Target: 200-250k total input tokens
3. **Deliberation Quality:** No degradation in consultant/manager decision quality
   - Measure: User acceptance of final outputs
   - Benchmark: A/B test Phase 1 vs Phase 2-4 on same tasks
4. **Performance:** No increase in end-to-end latency
   - Target: <10% latency increase
   - Acceptable if mechanical summarization reduces latency

### Solution Characteristics
- **Surgical:** Targets the 80/20 - fixes biggest cost drivers first
- **Incremental:** Can be implemented in phases (quick wins → deeper optimizations)
- **Configurable:** Users can tune cost/quality tradeoff via config
- **Observable:** Cost tracking and budget warnings built-in

### Optimization Roadmap (Phase 2-4)

#### ✅ Phase 1: Bootstrap Caching (COMPLETED)
- Bootstrap context cached via `cacheableContext` parameter
- Anthropic 90% cache discount applied
- **Savings: 55% ($3.35 → $1.49)**

#### 🎯 Phase 2: Progressive Summarization (THIS FOCUS)
- **Mechanical summarization** (no API call) for old rounds
  - Extract first 2-3 sentences from each consultant analysis
  - Use for rounds that are >2 rounds old
- **Manager summarization** only when context exceeds budget
- **Progressive truncation**: Round 3 sees full Round 2 + summary of Round 1
- **Manager always gets full context** (needs complete picture for decisions)
- **Expected savings: 48% ($1.49 → $0.77)**

#### 🎯 Phase 3: Model Tiering (AFTER Phase 2)
- Manager/consultants: Claude Sonnet 4.5 (needs intelligence)
- Summarization: Gemini 2.5 Flash (40× cheaper, sufficient for summarization)
- Review checks: GPT-4o-mini (6× cheaper for simple validation)
- **Expected savings: 44% ($0.77 → $0.43)**

#### 🎯 Phase 4: Call Reduction (FINAL)
- Skip manager evaluation for round 1 (always continue after first round)
- Combine decision + directive into one call (reduce prompt overhead)
- Parallel consultant reviews instead of sequential individual calls
- **Expected savings: 30% ($0.43 → $0.30)**

**Total Projected Savings: 91% ($3.35 → $0.30)**

---

## SCOPE: What is and isn't in scope?

### In Scope
1. **Context Management**
   - Optimize `buildRoundNContext()`, `buildManagerEvalContext()`
   - Implement effective summarization strategies
   - Add token counting and budget enforcement

2. **Caching Strategy**
   - Full utilization of Anthropic prompt caching
   - Bootstrap context caching across personas
   - Shared artifact caching

3. **Model Tiering**
   - Provider selection logic based on task complexity
   - Config schema for model overrides per role
   - Fallback handling for rate limits

4. **Call Reduction**
   - Identify redundant API calls
   - Safe phase merging opportunities
   - Parallel vs sequential execution analysis

5. **Configuration**
   - Add cost optimization presets (fast/balanced/thorough)
   - Token budget enforcement options
   - Per-role model overrides

### Out of Scope
1. **UI Changes** - Focus on backend/orchestration layer
2. **New Council Types** - Work within existing modes (council, coding, review, etc.)
3. **Alternative Backends** - Keep using direct HTTP APIs (no SDK changes)
4. **Prompt Engineering** - Don't rewrite prompts unless necessary for token reduction
5. **Testing Infrastructure** - Assume existing test patterns work

### Edge Cases to Consider
- Rate limits during caching (Anthropic 429 errors)
- Cache invalidation when context evolves
- Mixed-provider councils (some personas on OpenAI, some on Anthropic)
- Very long deliberations (>10 rounds)
- Large codebases (>200 files in bootstrap)

---

## ADDITIONAL CONTEXT

### Performance Characteristics
- Typical council: 2-5 minutes end-to-end
- Bootstrap context scan: 1-3 seconds
- Each LLM call: 5-30 seconds (depends on provider)
- Sequential consultants: 3× slower than parallel

### User Expectations
- Users run 5-50 councils per week
- Cost is the #1 complaint (especially Anthropic users)
- Users value quality over speed
- Most users don't modify default configs

### Known Issues
- Bootstrap context sometimes includes irrelevant files
- Summarization via Manager costs extra API call
- Sequential execution bloats context significantly
- No visibility into per-council cost until after completion

### Related Files for Deep Dive
```
src/council/deliberation-orchestrator.ts   (2100 lines) - Core orchestration
src/council/prompts.ts                     (1690 lines) - Prompt construction  
src/council/ledger-store.ts                (440 lines)  - Audit trail storage
src/council/context-bootstrap.ts           (150 lines)  - Directory scanning
src/cli/llm-caller.ts                      (365 lines)  - API router with caching
```

---

## REFERENCES

### Pricing (as of 2026-04)
- **Anthropic Claude Sonnet 4.5:** $3 input / $15 output per 1M tokens
- **Anthropic Claude Opus 4:** $15 input / $75 output per 1M tokens
- **OpenAI GPT-4o:** $2.50 input / $10 output per 1M tokens
- **Google Gemini 2.5 Flash:** $0.075 input / $0.30 output per 1M tokens (40× cheaper!)
- **Prompt Caching (Anthropic):** 90% discount on cached input tokens

### Example Council Cost Breakdown
```
Bootstrap context (30k tokens) × 18 calls          = 540k tokens
Deliberation history (avg 35k per call) × 18 calls = 630k tokens
Total input                                        = 1,170k tokens → $3.51

Output tokens (avg 2.5k per call) × 18 calls       = 45k tokens → $0.68

TOTAL COST                                         = $4.19
```

**With full caching (90% reduction on bootstrap):**
- Cached bootstrap: 540k × 0.1 × $3/1M = $0.16
- History: 630k × $3/1M = $1.89
- Output: 45k × $15/1M = $0.68
- **NEW TOTAL: $2.73 (35% savings)**

**With caching + summarization + model tiering:**
- **Target: $0.50-$1.00 (75-88% savings)**

---

## DELIVERABLE EXPECTATIONS

The consultant team should produce:

### Primary Focus: Phase 2 Implementation Plan
1. **Summarization Strategy Analysis**
   - Mechanical vs. LLM-based: when to use which?
   - Which rounds to summarize? Which to keep full?
   - How to extract key points without losing context?
   - Manager context strategy: full vs. partial?

2. **Technical Implementation Design**
   - Where to implement summarization logic? (ledger-store.ts? new file?)
   - How to modify `buildRoundNContext()` and `buildManagerEvalContext()`?
   - How to make it configurable? (new config flags? defaults?)
   - How to measure token savings in real-time?

3. **Quality Safeguards**
   - How to test that summarization doesn't break deliberations?
   - A/B testing approach: same task with/without summarization
   - Rollback triggers: when to disable summarization mid-council?
   - User controls: force full context for critical councils

### Secondary Focus: Phase 3-4 Strategy
4. **Model Tiering Approach**
   - Task classification logic (analyze/decide/summarize/review)
   - Provider selection per task type
   - Quality validation for cheaper models
   - Fallback handling for rate limits

5. **Call Reduction Opportunities**
   - Which calls are truly redundant vs. valuable?
   - Merge candidates: decision+directive, plan+directive?
   - Parallel vs. sequential trade-off analysis

### Cross-Cutting
6. **Cost Tracking Infrastructure**
   - Add per-phase cost tracking to deliberationState
   - Real-time budget warnings
   - Post-council cost attribution report

7. **Testing & Validation Strategy**
   - Reference councils for quality benchmarking
   - Automated regression tests
   - User acceptance criteria

Focus on **Phase 2 first** (biggest remaining savings), with Phase 3-4 as stretch goals.
