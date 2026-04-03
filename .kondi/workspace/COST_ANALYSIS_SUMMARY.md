# Kondi Council Cost Analysis - Executive Summary

## Critical Findings

Your council system is expensive because **every LLM call receives the full deliberation history**, and this history grows exponentially with each round.

### Primary Cost Drivers (Ranked by Impact)

#### 1. 🔴 Context Repetition (60-70% of waste)
**Problem:** Every consultant and manager call receives complete history of all prior rounds

**Example:** Round 3 consultant sees:
- Bootstrap context (30k tokens)
- Round 1: all 3 consultant analyses (15k tokens)  
- Round 2: all 3 consultant responses (18k tokens)
- Manager questions (3k tokens)
- **Total: 66k input tokens per call**

**Impact:** 
- 3 consultants × 66k tokens = 198k tokens for one round
- Across 3 rounds: ~600k input tokens just for consultants
- **Cost: ~$1.80 for consultant deliberation alone**

#### 2. 🔴 Bootstrap Context Not Cached (20-30% of waste)
**Problem:** Full source code (30k tokens) sent with EVERY API call, but Anthropic caching not utilized

**Why:** Code exists for caching but orchestrator doesn't pass `cacheableContext` parameter:
```typescript
// Currently:
await callLLM({ systemPrompt, userMessage, ... })

// Should be:
await callLLM({ 
  systemPrompt, 
  userMessage, 
  enableCache: true,
  cacheableContext: bootstrappedContext  // ← Missing!
})
```

**Impact:**
- 30k bootstrap tokens × 18 API calls = 540k tokens
- **Without caching: $1.62**
- **With caching (90% discount): $0.16**
- **Savings: $1.46 per council**

#### 3. 🟡 Excessive API Calls (10-15% of waste)
**Problem:** 18-25 API calls per council, some potentially redundant

**Opportunities:**
- Round 1 manager evaluation could auto-continue (skip 1 call)
- Decision + directive could be combined (save 1 call)
- Parallel consultant reviews instead of individual (save 2-3 calls)

**Impact:** Reduce 18 calls → 13-15 calls = **~$0.60 savings**

#### 4. 🟡 No Model Tiering (10-20% of waste)
**Problem:** Everything uses Claude Sonnet 4.5 ($3/$15 per 1M tokens)

**Opportunities:**
- Summarization: Use Gemini 2.5 Flash (40× cheaper)
- Simple reviews: Use GPT-4o-mini (6× cheaper)
- Manager decision: Keep Claude Sonnet (needs intelligence)

**Impact:** **~$0.50-$1.00 savings per council**

#### 5. 🟢 Sequential Execution Bloat (5-10% of waste)
**Problem:** `consultantExecution: 'sequential'` means Consultant 3 sees Consultant 1 + 2's full responses

**Trade-off:**
- Sequential: Better collaboration, but 20-30% more tokens
- Parallel: Faster, cheaper, but less interactive

**Impact:** Switching to parallel: **~$0.30-$0.50 savings**

---

## Current Cost Breakdown (Typical 3-Round Council)

```
┌─────────────────────────────────────────────────────────┐
│ Phase                    │ Calls │ Input   │ Output │ Cost│
├─────────────────────────────────────────────────────────┤
│ Manager Framing          │   1   │  30k    │  2k    │$0.12│
│ Round 1 (3 consultants)  │   3   │ 105k    │  9k    │$0.45│
│ Manager Eval Round 1     │   1   │  40k    │  1k    │$0.13│
│ Round 2 (3 consultants)  │   3   │ 165k    │  9k    │$0.63│
│ Manager Eval Round 2     │   1   │  60k    │  1k    │$0.19│
│ Round 3 (3 consultants)  │   3   │ 225k    │  9k    │$0.81│
│ Manager Eval Round 3     │   1   │  80k    │  1k    │$0.25│
│ Decision + Plan          │   2   │  90k    │  5k    │$0.35│
│ Directive                │   1   │  10k    │  2k    │$0.06│
│ Worker Execution         │   1   │  35k    │  5k    │$0.18│
│ Manager Review           │   1   │  50k    │  2k    │$0.18│
├─────────────────────────────────────────────────────────┤
│ TOTAL                    │  18   │ 890k    │ 46k    │$3.35│
└─────────────────────────────────────────────────────────┘

With revisions/re-deliberations: $5-$10
Complex coding tasks (5+ consultants): $10-$20
```

---

## Optimization Roadmap (Quick Wins → Deep Fixes)

### Phase 1: Caching (1-2 hours implementation)
**Impact:** 35-45% cost reduction

1. **Bootstrap Context Caching**
   - Pass `cacheableContext` parameter in orchestrator
   - Anthropic gives 90% discount on cached tokens
   - **Savings: $1.46 per council**

2. **Shared Context Artifact Caching**  
   - Cache the context document (v1, v2, v3...)
   - Invalidate on version change
   - **Savings: $0.40 per council**

**Total Phase 1 Savings: $1.86 (55% reduction)**

---

### Phase 2: Smart Summarization (3-4 hours implementation)
**Impact:** 20-30% additional reduction

1. **Mechanical Summarization (No API Call)**
   - Extract first 2 sentences from each consultant analysis
   - Use for rounds 1-2 (low-stakes)
   - **Savings: $0.30 per council**

2. **Progressive Truncation**
   - Round 3+ consultants see: full Round 2 + summary of Round 1
   - Manager always sees full context (needs it for decisions)
   - **Savings: $0.50 per council**

**Total Phase 2 Savings: $0.80 (24% additional reduction)**

---

### Phase 3: Model Tiering (2-3 hours implementation)
**Impact:** 10-20% additional reduction

1. **Add Provider Selection Logic**
   ```typescript
   function selectModel(taskType: 'analyze' | 'decide' | 'summarize' | 'review') {
     switch (taskType) {
       case 'analyze': return 'claude-sonnet-4-5';
       case 'decide': return 'claude-sonnet-4-5';
       case 'summarize': return 'gemini-2.5-flash';
       case 'review': return 'gpt-4o-mini';
     }
   }
   ```

2. **Route Tasks Smartly**
   - Summarization → Gemini Flash (40× cheaper)
   - Simple reviews → GPT-4o-mini (6× cheaper)
   - Core deliberation → Keep Claude

**Total Phase 3 Savings: $0.50-$0.80 (15% additional reduction)**

---

### Phase 4: Call Reduction (2-3 hours implementation)
**Impact:** 5-10% additional reduction

1. **Auto-Continue Round 1**
   - Skip manager evaluation after Round 1 (always continue)
   - **Savings: 1 API call = $0.13**

2. **Merge Decision + Directive**
   - Single prompt: "Make decision AND write directive"
   - **Savings: 1 API call = $0.15**

3. **Parallel Consultant Reviews**
   - Instead of sequential individual reviews
   - **Savings: 2-3 API calls = $0.20-$0.30**

**Total Phase 4 Savings: $0.48-$0.58 (14% additional reduction)**

---

## Expected Outcomes by Phase

```
Current Cost:        $3.35 per council
After Phase 1:       $1.49 per council  (56% reduction) ⭐ QUICK WIN
After Phase 2:       $0.69 per council  (79% reduction)
After Phase 3:       $0.19-$0.39        (88-94% reduction)
After Phase 4:       $0.10-$0.30        (91-97% reduction) 🎯 TARGET
```

---

## Recommended Implementation Order

### Week 1: Caching (Highest ROI)
- ✅ Pass `cacheableContext` for bootstrap in orchestrator
- ✅ Cache shared context artifacts per version
- ✅ Add cache invalidation on context evolution
- **Target: 55% cost reduction**

### Week 2: Summarization
- ✅ Implement mechanical summarization (no API call)
- ✅ Add progressive truncation for old rounds
- ✅ Keep manager context full (needs complete picture)
- **Target: 24% additional reduction**

### Week 3: Model Tiering
- ✅ Add task type classification
- ✅ Implement provider selection logic  
- ✅ Add fallback handling for rate limits
- **Target: 15% additional reduction**

### Week 4: Call Reduction
- ✅ Auto-continue Round 1
- ✅ Merge decision + directive
- ✅ Parallel consultant reviews
- **Target: 14% additional reduction**

---

## Risk Assessment

### Low Risk (Safe to implement immediately)
- ✅ Bootstrap context caching - No quality impact
- ✅ Mechanical summarization for early rounds - Negligible quality impact
- ✅ Auto-continue Round 1 - Expected behavior (consultants need to engage first)

### Medium Risk (Test thoroughly)
- ⚠️ Progressive truncation - Could lose important context from early rounds
- ⚠️ Model tiering - Gemini/GPT may produce different quality summaries
- ⚠️ Merge decision + directive - Longer prompt, might reduce focus

### High Risk (Requires careful design)
- 🔴 Shared context caching - Cache invalidation complexity
- 🔴 Parallel reviews - Might miss collaborative insights

---

## Testing Strategy

### Cost Tracking
```typescript
// Add to deliberation state
deliberationState: {
  costTracking: {
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    estimatedCost: number;
    cacheSavings: number;
  }
}
```

### Quality Benchmarks
1. **Reference Councils:** Save 10 high-quality council sessions
2. **A/B Test:** Run same task with/without optimizations
3. **User Acceptance:** Compare final output quality ratings

### Success Criteria
- [ ] Cost reduced by 70%+ for typical council
- [ ] Deliberation quality maintained (user rating ≥4/5)
- [ ] No increase in end-to-end latency >10%
- [ ] Zero data loss in audit trail

---

## Key Files to Modify

```
🔧 PRIMARY (Must change)
src/council/deliberation-orchestrator.ts  - Add caching params, summarization logic
src/cli/llm-caller.ts                     - Enhance caching support
src/council/ledger-store.ts               - Add mechanical summarization helper

📝 SECONDARY (Nice to have)
src/council/prompts.ts                    - Shorten prompts where possible
src/council/factory.ts                    - Add cost optimization presets
src/council/types.ts                      - Add cost tracking types

🧪 TEST (Validate changes)
Create: src/council/__tests__/cost-optimization.test.ts
```

---

## Bottom Line

Your system is well-architected but **treats all LLM calls equally**. The fix is:

1. **Cache what repeats** (bootstrap context, shared artifacts)
2. **Summarize what's old** (rounds 1-2 for round 3+ consultants)
3. **Route by complexity** (use cheap models for simple tasks)
4. **Eliminate redundancy** (merge/skip unnecessary calls)

**Target: $3.35 → $0.30 per council (91% reduction)**

Most gains come from **Phase 1 (caching)** which is the easiest to implement. Start there.
