# Security, Performance, and Code Quality Audit Report
**Generated:** 2026-04-02  
**Project:** kondi-council v0.1.0  
**Scope:** Full codebase analysis

---

## Executive Summary

This report identifies **27 distinct issues** across security vulnerabilities, performance concerns, and code quality problems. The most critical issues involve command injection risks, path traversal vulnerabilities, missing input validation, and inadequate error handling.

**Severity Distribution:**
- 🔴 **Critical:** 5 issues
- 🟠 **High:** 8 issues  
- 🟡 **Medium:** 9 issues
- 🔵 **Low:** 5 issues

---

## 🔴 CRITICAL SEVERITY ISSUES

### 1. Command Injection via Shell Execution
**Files:** `src/cli/run-council.ts`, `src/cli/node-platform.ts`, `src/council/context-bootstrap.ts`  
**Severity:** CRITICAL

**Issue:**  
Multiple instances of shell command execution using user-controlled or unsanitized input:

- **Line 384 (run-council.ts):** `execFileSync('/bin/sh', ['-c', cmd], ...)` - The `cmd` parameter from council config is executed directly without sanitization
- **Line 41 (node-platform.ts):** Same pattern - `execFileSync('/bin/sh', ['-c', cmd], ...)` 
- **Line 52 (context-bootstrap.ts):** `execSync('find . -maxdepth 3 ...')` - While the command is static, it executes in user-controlled working directories

**Risk:**  
Arbitrary command execution if malicious commands are embedded in council configs or test commands. An attacker controlling `testCommand` in config could execute `rm -rf / ; #` or exfiltrate data.

**Recommendation:**  
- Never use shell execution with user input
- Use `spawn()` with argument arrays instead of shell strings
- Whitelist allowed commands
- Implement command sandboxing or use safer alternatives

---

### 2. Path Traversal in File Operations
**Files:** `src/cli/run-council.ts`, `src/cli/node-platform.ts`  
**Severity:** CRITICAL

**Issue:**  
Incomplete path traversal protection:

- **Line 393-394 (run-council.ts):** Path check only blocks paths that don't start with base directory, but allows symlink attacks and doesn't resolve symlinks before validation
- **Line 11-16 (node-platform.ts):** `assertSafePath()` function has same issue - checks `resolved.startsWith(base + path.sep)` but doesn't validate symlinks

**Risk:**  
An attacker could use symlinks to escape the working directory boundary and read/write arbitrary files on the system.

**Recommendation:**  
- Use `fs.realpathSync()` to resolve symlinks before validation
- Implement allowlist of permitted directories
- Add additional checks for special characters and directory traversal sequences

---

### 3. Session File Deletion Without Backup
**Files:** `src/cli/claude-caller.ts`  
**Severity:** CRITICAL (Data Loss Risk)

**Issue:**  
**Lines 41-51:** Automatically deletes all `.jsonl` session files from Claude's project directory without user confirmation or backup:

```typescript
for (const f of fs.readdirSync(projectDir)) {
  if (f.endsWith('.jsonl')) {
    fs.unlinkSync(`${projectDir}/${f}`);
  }
}
```

**Risk:**  
Unintentional data loss if users have important session history they want to preserve. No recovery mechanism.

**Recommendation:**  
- Add user confirmation flag (`--preserve-sessions`)
- Create backups before deletion
- Use safer session isolation strategy (separate projects per council)

---

### 4. Missing API Key Validation
**Files:** `src/cli/llm-caller.ts`  
**Severity:** CRITICAL

**Issue:**  
**Lines 200-206:** API keys are retrieved from environment variables but only checked for existence, not validated:

```typescript
const apiKey = getApiKey(provider);
if (!apiKey) {
  throw new Error(`No API key for provider...`);
}
```

No validation that the key format is correct or that it's not accidentally a placeholder like "YOUR_API_KEY_HERE".

**Risk:**  
- API keys might be logged in error messages
- Invalid keys cause runtime failures after work is done
- Potential for credential leakage in error outputs

**Recommendation:**  
- Validate API key format before use
- Redact keys in error messages (show only first/last 4 chars)
- Test API keys on startup with a lightweight request
- Use credential management best practices

---

### 5. Unbounded Process Spawning
**Files:** `src/cli/claude-caller.ts`, `src/cli/codex-caller.ts`  
**Severity:** CRITICAL

**Issue:**  
No rate limiting or concurrency control on child process spawning:

- Parallel council execution could spawn dozens of `claude` or `codex` processes
- Each process holds resources (memory, file descriptors, API connections)
- No maximum concurrent process limit

**Risk:**  
Resource exhaustion, system instability, potential denial-of-service if many councils run simultaneously.

**Recommendation:**  
- Implement process pool with max concurrency limit
- Add queue for pending invocations
- Monitor and limit total system resource usage

---

## 🟠 HIGH SEVERITY ISSUES

### 6. Timeout Implementation Race Condition
**Files:** `src/cli/claude-caller.ts`, `src/cli/codex-caller.ts`  
**Severity:** HIGH

**Issue:**  
**Lines 102-107 (claude-caller.ts):** Timeout killing uses two-stage kill (SIGTERM then SIGKILL) but has race conditions:

```typescript
setTimeout(() => {
  child.kill('SIGTERM');
  setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 5_000);
}, timeoutMs);
```

Timer isn't cleared if process exits normally, leading to potential late kills of completed processes.

**Risk:**  
- Processes might be killed after successful completion
- Zombie processes if SIGKILL fails
- Inconsistent timeout behavior

**Recommendation:**  
- Clear timeout in exit handler
- Use process group killing for reliable cleanup
- Add proper cleanup verification

---

### 7. Missing Input Validation on Config Files
**Files:** `src/cli/council-config.ts`, `src/cli/run-council.ts`  
**Severity:** HIGH

**Issue:**  
**Lines 110-137 (council-config.ts):** Config validation only checks for presence of fields, not content:

- No validation of `testCommand` for dangerous operations
- No validation of `workingDirectory` paths
- No limits on `maxRounds`, `maxRevisions`, `timeoutMs`
- Model names not validated against known providers

**Risk:**  
Malicious or malformed configs can cause unexpected behavior, resource exhaustion, or security issues.

**Recommendation:**  
- Use Zod schemas for comprehensive validation
- Whitelist allowed models per provider
- Set reasonable upper bounds on numeric values
- Validate all file paths and commands

---

### 8. Sensitive Data in localStorage Files
**Files:** `src/cli/localStorage-shim.ts`, `src/cli/council-session-export.ts`  
**Severity:** HIGH

**Issue:**  
**Lines 39-45 (localStorage-shim.ts):** All council data (including prompts, responses, API calls) persisted to `~/.local/share/kondi/cli-state/localStorage.json` as plain text:

- No encryption
- File permissions not explicitly set (defaults may be world-readable)
- Sessions exported to timestamped JSON files also unencrypted

**Risk:**  
Sensitive information exposure if files are accessible by other users or backed up to cloud storage.

**Recommendation:**  
- Set restrictive file permissions (0600)
- Consider encryption for sensitive data
- Add option to disable persistence
- Document data retention policy

---

### 9. Unhandled Promise Rejections
**Files:** `src/cli/run-council.ts`, `src/cli/run-pipeline.ts`  
**Severity:** HIGH

**Issue:**  
Multiple async operations without proper error handling:

- **Line 350-363 (run-council.ts):** `invokeAgent` can fail but error only logged, not propagated
- **Line 382-389:** `runCommand` errors caught but may leave system in inconsistent state
- No global unhandled rejection handler

**Risk:**  
Silent failures, incomplete operations, data corruption.

**Recommendation:**  
- Add comprehensive try-catch blocks
- Implement proper error propagation
- Add global rejection handler
- Use error monitoring/logging

---

### 10. Memory Leaks in Child Process Management
**Files:** `src/cli/claude-caller.ts`, `src/cli/codex-caller.ts`  
**Severity:** HIGH

**Issue:**  
**Lines 99-100, 109-114 (claude-caller.ts):** Buffers accumulate in memory without bounds:

```typescript
const stdoutChunks: Buffer[] = [];
const stderrChunks: Buffer[] = [];
child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
```

Long-running processes with verbose output can consume unbounded memory.

**Risk:**  
Memory exhaustion on large outputs, OOM crashes.

**Recommendation:**  
- Implement streaming parsers instead of buffering
- Set maximum buffer size
- Add backpressure handling
- Stream large outputs to temp files

---

### 11. Insecure Temporary File Handling
**Files:** `src/council/context-bootstrap.ts`  
**Severity:** HIGH

**Issue:**  
**Line 52:** Uses `execSync` to run `find` command without validating working directory is safe:

```typescript
execSync(
  `find . -maxdepth 3 -type f -not -path '*/node_modules/*' ...`,
  { cwd: workingDir, encoding: 'utf-8', timeout: 10_000 }
)
```

If `workingDir` contains files with malicious names (e.g., `;rm -rf /;`), command injection is possible via filename interpretation.

**Risk:**  
Command injection through directory/file names.

**Recommendation:**  
- Use Node.js native file walking instead of shell commands
- Sanitize all paths before use
- Use libraries like `glob` or `fast-glob`

---

### 12. Missing Rate Limiting on API Calls
**Files:** `src/cli/llm-caller.ts`  
**Severity:** HIGH

**Issue:**  
No rate limiting on API calls to Anthropic, OpenAI, etc.:

- Parallel consultants can trigger rate limit errors
- No retry logic with exponential backoff
- Could exhaust API quotas rapidly

**Risk:**  
Service disruption, unexpected API costs, rate limit bans.

**Recommendation:**  
- Implement token bucket rate limiting
- Add exponential backoff retry logic
- Track and warn on quota usage
- Respect API rate limit headers

---

### 13. Denial of Service via Large Inputs
**Files:** `src/pipeline/executor.ts`, `src/council/deliberation-orchestrator.ts`  
**Severity:** HIGH

**Issue:**  
No limits on input sizes:

- User messages can be arbitrarily large
- No validation on prompt length
- Context can grow unbounded with `evolveContext`
- No protection against token limit exhaustion attacks

**Risk:**  
DoS through resource exhaustion, excessive API costs.

**Recommendation:**  
- Enforce maximum prompt/message lengths
- Implement context window management
- Add size validation on all inputs
- Set upper bounds on token budgets

---

## 🟡 MEDIUM SEVERITY ISSUES

### 14. Weak Error Messages Expose Internal State
**Files:** `src/cli/llm-caller.ts`, `src/cli/claude-caller.ts`  
**Severity:** MEDIUM

**Issue:**  
Error messages include sensitive details:

- **Line 79-80, 124 (llm-caller.ts):** Raw API error responses included in exceptions
- **Line 123 (claude-caller.ts):** stderr output exposed directly

**Risk:**  
Information disclosure about system internals, API keys in error details.

**Recommendation:**  
- Sanitize error messages before displaying
- Log detailed errors separately
- Provide user-friendly error messages

---

### 15. No HTTPS Verification for API Calls
**Files:** `src/cli/llm-caller.ts`  
**Severity:** MEDIUM

**Issue:**  
**Lines 69-76:** Fetch calls don't explicitly enforce TLS verification or certificate pinning.

**Risk:**  
Man-in-the-middle attacks on API communications.

**Recommendation:**  
- Explicitly verify TLS certificates
- Consider certificate pinning for critical APIs
- Reject insecure connections

---

### 16. Race Conditions in State Updates
**Files:** `src/cli/localStorage-shim.ts`  
**Severity:** MEDIUM

**Issue:**  
**Lines 86-94:** Debounced save with 500ms delay can lose data if process exits during delay:

```typescript
this.flushTimer = setTimeout(() => {
  this.flush();
  this.flushTimer = null;
}, 500);
```

**Risk:**  
Data loss on unexpected crashes between write and flush.

**Recommendation:**  
- Reduce debounce interval
- Force flush on critical operations
- Use atomic writes (write to temp, then rename)

---

### 17. Incomplete Git Safety Validation
**Files:** `src/cli/run-council.ts`  
**Severity:** MEDIUM

**Issue:**  
Git operations don't verify repository state:

- No check if working directory is a git repo
- No validation of git status before operations
- Could corrupt non-git directories

**Risk:**  
Unintended git operations, data corruption.

**Recommendation:**  
- Verify git repository exists and is valid
- Check for uncommitted changes
- Add dry-run mode for git operations

---

### 18. Missing Logging for Security Events
**Files:** Multiple  
**Severity:** MEDIUM

**Issue:**  
No audit logging for:

- File access attempts
- Command executions
- API key usage
- Permission changes
- Failed authentication attempts

**Risk:**  
Inability to detect/investigate security incidents.

**Recommendation:**  
- Implement comprehensive audit logging
- Log security-relevant events
- Include timestamps, user context, and outcomes

---

### 19. Hardcoded Credentials in Test Files
**Files:** `configs/councils/*.json`  
**Severity:** MEDIUM

**Issue:**  
Config files reference environment variables but no validation that they're not hardcoded values.

**Risk:**  
Accidental credential commits if users modify configs.

**Recommendation:**  
- Add pre-commit hooks to scan for credentials
- Document credential best practices
- Use dedicated secrets management

---

### 20. No Resource Cleanup on Error Paths
**Files:** `src/cli/run-council.ts`, `src/cli/run-pipeline.ts`  
**Severity:** MEDIUM

**Issue:**  
Error paths don't always clean up resources:

- Child processes may not be killed on error
- Temporary files not removed
- File handles may leak

**Risk:**  
Resource leaks, zombie processes.

**Recommendation:**  
- Implement proper finally blocks
- Use try-catch-finally pattern consistently
- Add resource tracking and cleanup verification

---

### 21. Insufficient Timeout Values
**Files:** `src/cli/claude-caller.ts`, `src/cli/node-platform.ts`  
**Severity:** MEDIUM

**Issue:**  
Default timeouts may be too long:

- 600,000ms (10 min) default for LLM calls
- 300,000ms (5 min) for command execution
- No user override mechanism

**Risk:**  
Hung processes, poor user experience.

**Recommendation:**  
- Reduce default timeouts
- Make timeouts configurable
- Add progress indicators for long operations

---

### 22. Missing Dependency Version Pinning
**Files:** `package.json`  
**Severity:** MEDIUM

**Issue:**  
Dependencies use caret ranges (`^4.0.0`):

- `tsx: ^4.0.0`
- `zod: ^4.3.6`

**Risk:**  
Supply chain attacks, breaking changes from minor version updates.

**Recommendation:**  
- Pin exact versions
- Use lockfiles (package-lock.json exists but not committed based on .gitignore)
- Regular dependency audits

---

## 🔵 LOW SEVERITY ISSUES

### 23. Inconsistent Error Handling Patterns
**Files:** Multiple  
**Severity:** LOW

**Issue:**  
Mixed error handling approaches:

- Some functions throw, others return null
- Inconsistent use of Error types
- No standardized error codes

**Risk:**  
Maintenance complexity, unpredictable behavior.

**Recommendation:**  
- Standardize error handling patterns
- Use custom Error classes
- Document error contracts

---

### 24. Missing Type Safety in CLI Argument Parsing
**Files:** `src/cli/run-council.ts`, `src/cli/kondi.ts`  
**Severity:** LOW

**Issue:**  
Manual CLI parsing without validation:

- No type checking on parsed arguments
- Casting to types without validation (e.g., `as CouncilStepType`)
- No help text validation

**Risk:**  
Type errors at runtime, confusing user experience.

**Recommendation:**  
- Use CLI parsing library (yargs, commander)
- Add runtime type validation
- Generate help text from types

---

### 25. Performance: Synchronous File Operations
**Files:** `src/cli/localStorage-shim.ts`, `src/cli/council-artifacts.ts`  
**Severity:** LOW

**Issue:**  
Using sync file operations in async contexts:

- `fs.readFileSync`, `fs.writeFileSync` block event loop
- Can cause performance degradation with large files

**Risk:**  
Poor performance, unresponsive CLI.

**Recommendation:**  
- Use async file operations (`fs.promises`)
- Implement streaming for large files
- Profile and optimize hot paths

---

### 26. No Monitoring/Telemetry
**Files:** All  
**Severity:** LOW

**Issue:**  
No observability:

- No metrics collection
- No performance monitoring
- No error reporting service integration

**Risk:**  
Difficult to diagnose production issues.

**Recommendation:**  
- Add optional telemetry
- Implement performance metrics
- Consider error reporting service

---

### 27. Code Quality: Duplicated Code
**Files:** `src/cli/claude-caller.ts`, `src/cli/codex-caller.ts`  
**Severity:** LOW

**Issue:**  
Similar child process management code duplicated across files.

**Risk:**  
Maintenance burden, bug fix propagation issues.

**Recommendation:**  
- Extract common process management utilities
- Create shared abstraction layer
- Reduce code duplication

---

## Performance Issues Summary

### High Impact:
1. **Memory buffering in child processes** - Can consume GB of RAM
2. **Synchronous file operations** - Blocks event loop
3. **No connection pooling** - Each API call creates new connection
4. **Context growth unbounded** - Token budgets not enforced

### Medium Impact:
5. **No caching layer** - Repeated API calls for same prompts
6. **Sequential consultant execution** - Could parallelize more
7. **Large localStorage writes** - 500ms debounce too aggressive

---

## Code Quality Issues Summary

### Architecture:
- Heavy coupling between CLI and core logic
- Global state via localStorage shim
- Mixed async/sync patterns

### Testing:
- No test suite found
- No CI/CD validation
- Manual testing only

### Documentation:
- Missing JSDoc for public APIs
- No architecture documentation
- Incomplete error documentation

---

## Recommendations Priority Matrix

### Immediate (Fix in next release):
1. Fix command injection vulnerabilities
2. Fix path traversal issues
3. Add input validation on configs
4. Implement rate limiting
5. Fix session deletion without backup

### Short-term (Fix within 1 month):
6. Add comprehensive error handling
7. Implement resource cleanup
8. Add API key validation
9. Fix memory leaks
10. Add audit logging

### Long-term (Fix within 3 months):
11. Add comprehensive test suite
12. Implement monitoring/telemetry
13. Refactor for better architecture
14. Add security scanning to CI/CD
15. Performance optimization

---

## Compliance & Best Practices

### OWASP Top 10 Coverage:
- ✅ A03:2021 - Injection (Multiple command injection issues found)
- ✅ A01:2021 - Broken Access Control (Path traversal issues)
- ✅ A04:2021 - Insecure Design (Missing security controls)
- ✅ A05:2021 - Security Misconfiguration (Default permissions, no encryption)
- ✅ A07:2021 - Identification and Authentication Failures (Weak API key handling)

### Missing Security Controls:
- No input sanitization framework
- No output encoding
- No security headers (not applicable for CLI)
- No secrets scanning in CI/CD
- No dependency vulnerability scanning
- No SAST/DAST integration

---

## Conclusion

The kondi-council codebase has **significant security vulnerabilities** that should be addressed before production use. The most critical issues involve command injection, path traversal, and missing input validation. 

**Risk Score: 7.5/10 (HIGH)**

Immediate action required on critical issues. The codebase shows good architectural thinking but needs security hardening, comprehensive error handling, and proper resource management before it can be considered production-ready.

---

**End of Report**
