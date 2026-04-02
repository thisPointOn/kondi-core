# Kondi Council - Issues by File
**Comprehensive listing of all issues organized by file path**

---

## src/cli/node-platform.ts (9 issues)

### CRITICAL
1. **Command Injection (Line 41)** - `execFileSync('/bin/sh', ['-c', cmd])` allows arbitrary command execution
2. **Path Traversal (Lines 11-17)** - `assertSafePath()` doesn't resolve symlinks, allows bypass
3. **Arbitrary File Write (Lines 23-28)** - No size limits, creates any directory

### HIGH  
4. **Blocking I/O (Lines 27, 33)** - `writeFileSync`, `readFileSync` block event loop
5. **Hardcoded Timeout (Line 44)** - Magic number 300_000ms without config

### MEDIUM
6. **No Streaming (Lines 30-36)** - Loads entire file into memory
7. **No File Size Validation (Line 27)** - Can write unlimited data
8. **Missing Error Context (Lines 32-36)** - Silent catch blocks
9. **Insecure Permissions (Line 27)** - writeFileSync uses default 0o666

---

## src/cli/claude-caller.ts (8 issues)

### CRITICAL
1. **API Key Exposure (Line 122-124)** - Error messages may contain API keys
2. **Child Process Leakage (Lines 99-145)** - Incomplete cleanup, no SIGKILL handler
3. **No Input Validation (Line 142)** - Direct stdin write without size/content checks

### HIGH
4. **Hardcoded Timeout (Line 102)** - 600_000ms magic number
5. **No Retry Logic (Lines 93-145)** - Network failures immediately fail
6. **Hardcoded Path (Line 40)** - `~/.claude/projects/` not configurable

### MEDIUM
7. **Duplicate Code** - 80% overlap with codex-caller.ts
8. **Long Function (Lines 23-145)** - 122 lines, needs decomposition

---

## src/cli/codex-caller.ts (7 issues)

### CRITICAL
1. **Command Injection (Line 65)** - `spawn('codex', args)` with shell access
2. **Environment Variable Leakage (Lines 69-78)** - Spreads all process.env
3. **Child Process Leakage (Lines 80-126)** - Process group not killed properly

### HIGH
4. **Unsafe Process Spawning (Line 65)** - `detached: true` creates orphans
5. **Hardcoded Timeout (Line 83)** - 600_000ms magic number

### MEDIUM
6. **Duplicate Code** - Mirror of claude-caller.ts
7. **Non-Interactive Environment (Lines 71-78)** - Aggressive env var setting

---

## src/cli/llm-caller.ts (12 issues)

### CRITICAL
1. **API Key Exposure (Lines 78-81, 123)** - Authorization header in errors
2. **No Rate Limiting (Lines 52-230)** - Unlimited API calls, cost overrun risk
3. **No Input Validation (Lines 142, 210)** - Unbounded message size

### HIGH
4. **Missing Timeout (Lines 69-76, 111-165, 157-182)** - No AbortSignal on fetch()
5. **No Retry Logic (Lines 69-76)** - Transient failures not handled
6. **Environment Variable Access (Lines 29-35)** - Direct process.env reading

### MEDIUM
7. **No Connection Pooling (Line 69)** - New connection per request
8. **Hardcoded Endpoints (Lines 69, 111, 157)** - API URLs not configurable
9. **Magic Numbers (Line 66)** - max_tokens: 16384 hardcoded
10. **No Graceful Fallback (Line 228)** - Silent fallback hides errors
11. **Error Message Quality (Lines 78-80)** - Generic error text
12. **No Cost Tracking** - Token usage not aggregated

---

## src/cli/run-council.ts (15 issues)

### CRITICAL
1. **Command Injection (Lines 384-389)** - execFileSync with shell
2. **Path Traversal (Lines 391-396)** - Weak path validation
3. **Unsafe JSON Parsing (Line 217)** - No validation after JSON.parse
4. **Child Process Management (Lines 480-487)** - Incomplete signal handlers

### HIGH
5. **Excessive Token Budget (Lines 272, 302)** - 80,000 token default
6. **Hardcoded Timeout (Line 358)** - 900_000ms magic number
7. **Unhandled Promises** - async main() without comprehensive catch

### MEDIUM
8. **Long Function (Lines 195-492)** - 297 lines, needs refactoring
9. **Magic Numbers (Lines 189, 271, 302)** - Hardcoded constants
10. **Console.log Usage (Lines 61, 337-426)** - No logging framework
11. **Complex Conditionals (Lines 286-310)** - Needs simplification
12. **No Pagination (Line 425)** - Loads all ledger entries
13. **Poor Error Messages (Lines 211-212, 233-234)** - Generic text
14. **Inconsistent Exit Codes (Lines 130, 143, 477)** - 1, 130, 143
15. **No Health Check** - Long-running process without monitoring

---

## src/cli/localStorage-shim.ts (7 issues)

### CRITICAL
1. **Unsafe JSON Parsing (Line 31)** - No __proto__ protection
2. **Cleartext Storage (Lines 19, 42)** - Plaintext localStorage.json

### HIGH
3. **Blocking I/O (Line 30)** - readFileSync in constructor
4. **Debounced Save (Lines 86-94)** - 500ms window for data loss

### MEDIUM
5. **Inefficient JSON (Line 42)** - Pretty-printed JSON wastes space
6. **No File Size Limit** - Can grow unbounded
7. **Race Condition (Lines 89-92)** - setTimeout without lock

---

## src/cli/council-config.ts (5 issues)

### CRITICAL
1. **Unsafe JSON Parsing (Line 114)** - Direct JSON.parse without validation
2. **Unvalidated Config (Lines 89-140)** - No signature verification

### HIGH
3. **Blocking I/O (Line 111)** - readFileSync
4. **Poor Error Handling (Lines 103-107)** - Silent fallthrough

### MEDIUM
5. **Hardcoded Paths (Lines 100-106)** - Auto-discovery paths not configurable

---

## src/cli/council-artifacts.ts (4 issues)

### CRITICAL
1. **Arbitrary File Write (Lines 49-52)** - No size limits

### MEDIUM
2. **Insecure File Permissions (Line 51)** - writeFileSync default mode
3. **No Error Handling (Lines 64-92)** - writeFile can fail silently
4. **Inefficient String Concatenation (Lines 62-92)** - Should use array.join()

---

## src/cli/run-pipeline.ts (6 issues)

### CRITICAL
1. **Unsafe JSON Parsing (Line 154)** - No validation
2. **Unvalidated Config (Lines 142-212)** - Pipeline execution without verification

### HIGH
3. **Unhandled Promises** - async operations without .catch()

### MEDIUM
4. **Long Function (Lines 455-716)** - 261 lines
5. **Complex State Management** - skipNextStage, stopPipeline flags
6. **No Pagination** - Loads entire pipeline state

---

## src/council/context-bootstrap.ts (5 issues)

### CRITICAL
1. **Command Injection (Lines 51-54)** - execSync with find command

### HIGH
2. **Hardcoded Timeout (Line 53)** - 10_000ms magic number

### MEDIUM
3. **No Streaming (Lines 75-80)** - readFileSync for potentially large files
4. **Hardcoded Limits (Lines 13, 44)** - MAX_FILE_SIZE, MAX_TOTAL_CHARS
5. **Weak Path Validation (Lines 68-73)** - Doesn't resolve symlinks

---

## src/council/store.ts (5 issues)

### CRITICAL
1. **Weak Session IDs (Line 129)** - crypto.randomUUID without entropy check

### HIGH
2. **Memory Leaks (Lines 919-1111)** - Listeners not always cleaned up

### MEDIUM
3. **No Pagination (Line 99)** - getAllCouncils loads everything
4. **Inefficient Lookups (Line 110)** - Array.find() instead of Map
5. **Complex State Machine (Lines 610-863)** - Deliberation state management

---

## src/council/context-store.ts (6 issues)

### CRITICAL
1. **Weak Session IDs (Line 95)** - crypto.randomUUID

### MEDIUM
2. **No Pagination (Lines 73-76)** - getContextHistory loads all versions
3. **Inefficient Lookups (Line 83)** - Array.find()
4. **Memory Leaks (Lines 576-582)** - Listener cleanup
5. **No Error Handling (Lines 39-47)** - Silent failures
6. **Complex Patch Logic (Lines 244-311)** - Stale patch acceptance

---

## src/council/deliberation-orchestrator.ts (10 issues)

### CRITICAL
1. **No Rate Limiting** - Unlimited LLM API calls

### HIGH
2. **Excessive Token Budget** - Uses council's 80k default
3. **Unhandled Promises** - Multiple async operations
4. **Memory Consumption** - Loads full ledger history
5. **Infinite Loop Risk (Lines 285-374)** - maxLoopIterations guard only

### MEDIUM
6. **Long Functions** - Multiple 200+ line methods
7. **Complex State Management** - Phase transitions, retry logic
8. **Magic Numbers (Lines 381, 498)** - PHASE_RETRY_MAX, delays
9. **No Pagination** - Loads all entries for context
10. **Verbose Logging** - console.log throughout

---

## src/council/coding-orchestrator.ts (4 issues)

### HIGH
1. **No Rate Limiting** - Same as deliberation orchestrator
2. **Command Execution Risk** - Runs test commands

### MEDIUM
3. **Complex Workflow** - Multi-phase orchestration
4. **No Timeout Limits** - Long-running operations

---

## src/pipeline/executor.ts (8 issues)

### CRITICAL
1. **Prototype Pollution (Lines 130-141)** - resolveJsonPath vulnerable

### HIGH
2. **Unhandled Promises** - async step execution

### MEDIUM
3. **Long Function (Lines 258-716)** - 458 lines
4. **Complex Template Logic (Lines 146-225)** - Needs simplification
5. **No Input Validation** - Template variables unvalidated
6. **Memory Consumption** - Artifact accumulation
7. **No Streaming** - Large artifacts in memory
8. **Magic Strings (Lines 150-222)** - Template syntax hardcoded

---

## src/pipeline/output-parsers.ts (2 issues)

### MEDIUM
1. **Unoptimized Regex (Line 18)** - ReDoS risk
2. **No Error Handling** - Parse failures silent

---

## src/council/validation.ts (2 issues)

### HIGH
1. **Missing Strict Enforcement** - Schemas exist but not always used

### MEDIUM
2. **Weak Type Guards** - Could be more restrictive

---

## package.json (3 issues)

### MEDIUM
1. **No Dependency Scanning** - npm audit not in scripts
2. **Minimal Dependencies** - Good! Only 2 deps (tsx, zod)
3. **No Dev Dependencies** - Missing @types/node, testing libs

---

## tsconfig.json (2 issues)

### HIGH
1. **Partial Strict Mode** - strict:true but not enforced everywhere

### MEDIUM
2. **No noImplicitAny** - Allows implicit any in some cases

---

## Missing Files (8 issues)

### HIGH
1. **No .eslintrc.json** - No linting rules
2. **No .prettierrc** - No formatting rules

### MEDIUM
3. **No .editorconfig** - Inconsistent editor settings
4. **No .gitattributes** - Line ending issues
5. **No security.txt** - No disclosure process
6. **No CONTRIBUTING.md** - No contribution guidelines
7. **No tests/** - 0% test coverage
8. **No .github/workflows/** - No CI/CD

---

## Integration Files (Low Priority)

### integrations/mcp-server/index.ts
- MCP integration, defer review until main security issues fixed

### integrations/claude-agent-sdk/index.ts
- SDK integration, low priority

### integrations/openai-agents-sdk/index.ts
- OpenAI integration, low priority

### integrations/langgraph-js/index.ts
- LangGraph integration, low priority

### integrations/mastra/index.ts
- Mastra integration, low priority

### integrations/n8n-node/
- N8N integration, low priority

---

## File Statistics

| File | Critical | High | Medium | Low | Total |
|------|----------|------|--------|-----|-------|
| node-platform.ts | 3 | 2 | 4 | 0 | 9 |
| claude-caller.ts | 3 | 3 | 2 | 0 | 8 |
| codex-caller.ts | 3 | 2 | 2 | 0 | 7 |
| llm-caller.ts | 3 | 3 | 6 | 0 | 12 |
| run-council.ts | 4 | 3 | 8 | 0 | 15 |
| localStorage-shim.ts | 2 | 2 | 3 | 0 | 7 |
| council-config.ts | 2 | 2 | 1 | 0 | 5 |
| council-artifacts.ts | 1 | 0 | 3 | 0 | 4 |
| run-pipeline.ts | 2 | 1 | 3 | 0 | 6 |
| context-bootstrap.ts | 1 | 1 | 3 | 0 | 5 |
| store.ts | 1 | 1 | 3 | 0 | 5 |
| context-store.ts | 1 | 0 | 5 | 0 | 6 |
| deliberation-orchestrator.ts | 1 | 5 | 4 | 0 | 10 |
| coding-orchestrator.ts | 0 | 2 | 2 | 0 | 4 |
| executor.ts | 1 | 1 | 6 | 0 | 8 |
| output-parsers.ts | 0 | 0 | 2 | 0 | 2 |
| validation.ts | 0 | 1 | 1 | 0 | 2 |
| package.json | 0 | 0 | 3 | 0 | 3 |
| tsconfig.json | 0 | 1 | 1 | 0 | 2 |
| Missing files | 0 | 2 | 6 | 0 | 8 |

**Total:** 27 Critical, 32 High, 68 Medium, 0 Low = **127 total issue instances**  
**(62 distinct issues across multiple files)**

---

## Top 10 Riskiest Files

1. **run-council.ts** - 15 issues (4 critical, 3 high)
2. **llm-caller.ts** - 12 issues (3 critical, 3 high)
3. **deliberation-orchestrator.ts** - 10 issues (1 critical, 5 high)
4. **node-platform.ts** - 9 issues (3 critical, 2 high)
5. **claude-caller.ts** - 8 issues (3 critical, 3 high)
6. **executor.ts** - 8 issues (1 critical, 1 high)
7. **codex-caller.ts** - 7 issues (3 critical, 2 high)
8. **localStorage-shim.ts** - 7 issues (2 critical, 2 high)
9. **run-pipeline.ts** - 6 issues (2 critical, 1 high)
10. **context-store.ts** - 6 issues (1 critical, 0 high)

---

## Remediation Priority by File

### Phase 1 (Week 1) - Critical Files
Fix these files first to eliminate RCE and data theft risks:

1. `node-platform.ts` - Command injection, path traversal
2. `llm-caller.ts` - API key exposure, no rate limiting
3. `claude-caller.ts` - Process leaks, input validation
4. `codex-caller.ts` - Env var leaks, command injection
5. `localStorage-shim.ts` - JSON parsing, cleartext storage
6. `run-council.ts` - Multiple critical issues
7. `council-config.ts` - Unvalidated configs

### Phase 2 (Week 2-3) - High Priority Files
Fix these for stability and performance:

1. `deliberation-orchestrator.ts` - Rate limiting, memory
2. `executor.ts` - Prototype pollution
3. `run-pipeline.ts` - Async handling
4. `context-bootstrap.ts` - Command injection
5. `tsconfig.json` - Strict mode
6. Add missing files (ESLint, tests)

### Phase 3 (Month 2) - Medium Priority
Improve code quality:

1. Refactor duplicate code (claude-caller vs codex-caller)
2. Break down long functions
3. Add JSDoc documentation
4. Implement pagination
5. Add proper logging
6. Improve error handling

---

## Quick Reference: Critical Issues by File

**Command Injection:**
- node-platform.ts:41
- codex-caller.ts:65
- context-bootstrap.ts:51-54
- run-council.ts:384-389

**Path Traversal:**
- node-platform.ts:11-17
- run-council.ts:391-396
- context-bootstrap.ts:68-73

**Unsafe JSON:**
- localStorage-shim.ts:31
- council-config.ts:114
- run-council.ts:217
- run-pipeline.ts:154
- executor.ts:130-141

**API Keys:**
- llm-caller.ts:78-81, 123
- claude-caller.ts:122-124

**Rate Limiting:**
- llm-caller.ts (entire file)
- deliberation-orchestrator.ts

**Child Processes:**
- claude-caller.ts:99-145
- codex-caller.ts:80-126
- run-council.ts:480-487

**File Operations:**
- node-platform.ts:23-28
- council-artifacts.ts:49-52
- localStorage-shim.ts:39-45

---

**Document Version:** 1.0  
**Last Updated:** 2026-04-02  
**Maintainer:** Security Team
