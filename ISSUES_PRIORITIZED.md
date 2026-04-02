# Kondi Council - Prioritized Issues List
**Generated:** 2026-04-02  
**Total Issues:** 62 distinct issues identified

---

## 🔴 CRITICAL ISSUES (12) - FIX IMMEDIATELY

| # | Issue | File(s) | Impact | Fix Time |
|---|-------|---------|--------|----------|
| 1 | **Command Injection** | `node-platform.ts:41`, `run-council.ts:384`, `codex-caller.ts:65`, `context-bootstrap.ts:51` | Arbitrary code execution | 8h |
| 2 | **Path Traversal** | `run-council.ts:391`, `node-platform.ts:11`, `context-bootstrap.ts:68` | Unauthorized file access | 6h |
| 3 | **Unsafe JSON Parsing** | `council-config.ts:114`, `run-council.ts:217`, `run-pipeline.ts:154`, `localStorage-shim.ts:31` | Prototype pollution RCE | 4h |
| 4 | **API Key Exposure** | `llm-caller.ts:78,123`, `claude-caller.ts:122` | Credential leakage | 3h |
| 5 | **Child Process Leakage** | `claude-caller.ts:99`, `codex-caller.ts:80`, `run-council.ts:480` | Resource exhaustion | 6h |
| 6 | **Arbitrary File Write** | `node-platform.ts:23`, `council-artifacts.ts:49`, `localStorage-shim.ts:39` | Disk fill DoS | 5h |
| 7 | **No Rate Limiting** | `llm-caller.ts:52-230`, `deliberation-orchestrator.ts` | $10k+ API bills | 12h |
| 8 | **Env Var Leakage** | `codex-caller.ts:69`, `claude-caller.ts:97` | Secret exposure | 2h |
| 9 | **Cleartext Storage** | `localStorage-shim.ts:19,42` | Credential theft | 8h |
| 10 | **No Input Validation** | `claude-caller.ts:142`, `codex-caller.ts:123`, `llm-caller.ts:142` | Message injection | 4h |
| 11 | **Weak Session IDs** | `context-store.ts:95`, `store.ts:129` | Session fixation | 2h |
| 12 | **Unvalidated Configs** | `council-config.ts:89`, `run-pipeline.ts:142` | Malicious execution | 10h |

**Subtotal Critical:** 70 hours

---

## 🟠 HIGH SEVERITY (18) - FIX WITHIN 1 WEEK

| # | Issue | File(s) | Impact | Fix Time |
|---|-------|---------|--------|----------|
| 13 | Blocking I/O | `localStorage-shim.ts:30`, `council-config.ts:111`, `node-platform.ts:27,33` | Event loop blocking | 8h |
| 14 | Missing Timeouts | `llm-caller.ts:69-182` (3 locations) | Indefinite hangs | 2h |
| 15 | No Retry Logic | `llm-caller.ts`, `claude-caller.ts`, `deliberation-orchestrator.ts` | Transient failures | 6h |
| 16 | Debounce Data Loss | `localStorage-shim.ts:86` | Data corruption | 3h |
| 17 | Magic Numbers | `claude-caller.ts:102`, `run-council.ts:358`, `node-platform.ts:44`, etc. | Poor maintainability | 4h |
| 18 | Unhandled Promises | Multiple files | Process crashes | 6h |
| 19 | Symlink Bypass | `node-platform.ts:11` | Path traversal | 2h |
| 20 | Excessive Token Budget | `run-council.ts:272,302` | Cost overruns | 3h |
| 21 | No Connection Pooling | `llm-caller.ts:69` | Poor performance | 4h |
| 22 | Memory Leaks | `context-store.ts:576` | Resource exhaustion | 3h |
| 23 | Timezone Issues | Multiple `new Date()` calls | Data corruption | 2h |
| 24 | No Pagination | `ledger-store.ts` | Memory exhaustion | 4h |
| 25 | Inconsistent Errors | Exit codes: 1, 130, 143 | Poor debugging | 2h |
| 26 | No Health Checks | Integration servers | Poor monitoring | 3h |
| 27 | Console.log Spam | Throughout codebase | Performance & security | 6h |
| 28 | Missing Strict Mode | `tsconfig.json` partially | Type safety gaps | 8h |
| 29 | No CORS Headers | Integration endpoints | XSS risk | 2h |
| 30 | Prototype Pollution v2 | `executor.ts:130` | RCE via templates | 3h |

**Subtotal High:** 71 hours

---

## 🟡 MEDIUM SEVERITY (22) - FIX WITHIN 1 MONTH

| # | Issue | File(s) | Impact | Fix Time |
|---|-------|---------|--------|----------|
| 31 | No Streaming | `node-platform.ts:30` | Memory exhaustion | 4h |
| 32 | Inefficient JSON | `localStorage-shim.ts:42` | Wasted space | 1h |
| 33 | No File Size Limits | `node-platform.ts:23` | DoS | 2h |
| 34 | ReDoS Risk | `output-parsers.ts:18` | CPU exhaustion | 3h |
| 35 | Duplicate Code | `claude-caller.ts` vs `codex-caller.ts` | Maintenance burden | 8h |
| 36 | Long Functions | `run-pipeline.ts:455`, `run-council.ts:195` | Poor readability | 12h |
| 37 | Missing JSDoc | Most public APIs | Poor documentation | 16h |
| 38 | Naming Inconsistency | camelCase vs snake_case | Confusion | 4h |
| 39 | Dead Code | Multiple unused exports | Bloat | 6h |
| 40 | No Linter | Missing ESLint config | Quality issues | 3h |
| 41 | Hardcoded Paths | `claude-caller.ts:40` | Portability issues | 2h |
| 42 | No Graceful Fallback | `llm-caller.ts` | Hidden errors | 3h |
| 43 | Weak Type Casts | Multiple `as any` | Type safety bypass | 8h |
| 44 | No Test Coverage | 0% coverage | Regression risk | 40h |
| 45 | Verbose Logic | Complex conditionals | Readability | 6h |
| 46 | Magic Strings | Throughout | Maintainability | 4h |
| 47 | Missing Readonly | Mutable state | Bugs | 3h |
| 48 | Poor Variable Names | `p`, `c`, `s` | Confusion | 4h |
| 49 | Commented Code | Production files | Clutter | 2h |
| 50 | TODOs | Multiple files | Incomplete work | 8h |
| 51 | No Dependency Scan | `package.json` | Vulnerable deps | 2h |
| 52 | Insecure File Perms | `council-artifacts.ts` | Data leakage | 1h |

**Subtotal Medium:** 142 hours

---

## 🔵 LOW SEVERITY (10) - FIX AS TIME PERMITS

| # | Issue | File(s) | Impact | Fix Time |
|---|-------|---------|--------|----------|
| 53 | Inconsistent Indent | Multiple files | Poor readability | 2h |
| 54 | Missing EOF Newlines | Multiple files | Git diffs | 1h |
| 55 | Unused Imports | Multiple files | Bundle size | 2h |
| 56 | Inconsistent File Naming | Various | Organization | 3h |
| 57 | No .editorconfig | Root | Formatting issues | 1h |
| 58 | No Pre-commit Hooks | Root | Quality drift | 2h |
| 59 | No .gitattributes | Root | Line ending issues | 1h |
| 60 | No Security.txt | Root | Disclosure process | 1h |
| 61 | No Vulnerability Scan | CI/CD | Unknown issues | 2h |
| 62 | No Semver Enforcement | `package.json` | Breaking changes | 1h |

**Subtotal Low:** 16 hours

---

## SUMMARY BY CATEGORY

### Security Issues: 35
- Command injection, path traversal, prototype pollution
- API key exposure, cleartext storage
- No rate limiting, cost controls
- Insufficient input validation

### Performance Issues: 15
- Blocking I/O operations
- No streaming, no connection pooling
- Memory leaks, inefficient data structures
- No caching, no pagination

### Code Quality Issues: 12
- Duplicate code, long functions
- Poor naming, missing documentation
- No tests, weak typing
- Dead code, inconsistent style

---

## REMEDIATION TIMELINE

### Week 1 (Critical)
**Focus:** Security vulnerabilities that enable RCE or data theft  
**Effort:** 70 hours  
**Issues:** #1-12

**Deliverables:**
- [ ] Command injection fixed
- [ ] Path traversal fixed
- [ ] JSON parsing secured
- [ ] Secrets redacted from errors
- [ ] Child processes cleanup properly
- [ ] File operations restricted
- [ ] Rate limiting implemented
- [ ] Environment variables filtered
- [ ] Credentials encrypted
- [ ] Input validation added
- [ ] Session IDs secured
- [ ] Config validation enforced

### Week 2-3 (High Priority)
**Focus:** Performance, stability, cost control  
**Effort:** 71 hours  
**Issues:** #13-30

**Deliverables:**
- [ ] Async I/O throughout
- [ ] Timeouts on all network calls
- [ ] Retry logic with exponential backoff
- [ ] Data loss prevention
- [ ] Configurable timeouts
- [ ] Promise rejection handling
- [ ] Connection pooling
- [ ] Token budget controls
- [ ] Proper logging framework
- [ ] TypeScript strict mode
- [ ] Security headers added

### Month 2 (Medium Priority)
**Focus:** Code quality, maintainability  
**Effort:** 142 hours  
**Issues:** #31-52

**Deliverables:**
- [ ] Streaming for large files
- [ ] File size limits
- [ ] Code deduplication
- [ ] Function decomposition
- [ ] JSDoc documentation
- [ ] ESLint + Prettier
- [ ] Test coverage >70%
- [ ] Dependency scanning
- [ ] Dead code removal

### Month 3 (Low Priority)
**Focus:** Polish, developer experience  
**Effort:** 16 hours  
**Issues:** #53-62

**Deliverables:**
- [ ] Consistent formatting
- [ ] Pre-commit hooks
- [ ] Editor config
- [ ] Security disclosure process

---

## QUICK WINS (High Impact, Low Effort)

These fixes provide maximum security improvement for minimal time:

1. **Add API key redaction** (3h) - Prevents credential leaks
2. **Filter environment variables** (2h) - Blocks secret exposure  
3. **Add request timeouts** (2h) - Prevents hangs
4. **Fix symlink bypass** (2h) - Closes path traversal
5. **Add file size limits** (2h) - Prevents DoS
6. **Validate session IDs** (2h) - Fixes weak crypto
7. **Add dependency scanning** (2h) - Finds known vulns
8. **Implement error codes** (2h) - Improves debugging
9. **Add .editorconfig** (1h) - Consistent formatting
10. **Create security.txt** (1h) - Disclosure process

**Total Quick Wins:** 20 hours for major security improvements

---

## RISK MATRIX

### Critical Risk (Fix This Week)
- Command injection → RCE
- Path traversal → Data theft
- Prototype pollution → RCE
- No rate limiting → $10k+ bills

### High Risk (Fix This Month)
- Child process leaks → DoS
- Blocking I/O → Poor UX
- No input validation → Injection attacks
- Cleartext storage → Credential theft

### Medium Risk (Fix This Quarter)
- No streaming → OOM crashes
- Memory leaks → Gradual degradation
- No tests → Regression bugs
- Duplicate code → Maintenance burden

### Low Risk (Fix When Convenient)
- Formatting issues → Readability
- Missing docs → Onboarding friction
- Pre-commit hooks → Quality drift

---

## COST ESTIMATE

**Security Fixes (Critical + High):** 141 hours @ $150/hr = **$21,150**

**Quality Improvements (Medium):** 142 hours @ $100/hr = **$14,200**

**Polish (Low):** 16 hours @ $75/hr = **$1,200**

**Total Estimated Cost:** **$36,550**

**Alternative: Hire 2 developers full-time for 1 month**

---

## TOOLING RECOMMENDATIONS

### Security Scanning
```bash
npm install --save-dev \
  eslint-plugin-security \
  @github/semgrep \
  detect-secrets \
  snyk
```

### Code Quality
```bash
npm install --save-dev \
  eslint \
  @typescript-eslint/parser \
  @typescript-eslint/eslint-plugin \
  prettier \
  husky \
  lint-staged \
  ts-prune
```

### Testing
```bash
npm install --save-dev \
  vitest \
  @vitest/coverage-v8 \
  @jazzer.js/core
```

### CI/CD Integration
```yaml
# .github/workflows/security.yml
name: Security Scan
on: [push, pull_request]
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm audit --production
      - run: npx snyk test
      - run: npx semgrep --config=auto
      - run: npx detect-secrets scan
```

---

## ACCEPTANCE CRITERIA

Before marking an issue as "FIXED":

1. **Code Review:** Approved by 2+ developers
2. **Security Review:** Approved by security team
3. **Tests Added:** Unit + integration tests passing
4. **Documentation Updated:** JSDoc + README changes
5. **No Regressions:** All existing tests pass
6. **Performance Check:** No degradation vs baseline
7. **Deployed to Staging:** Tested in staging environment
8. **Sign-off:** Product owner approval

---

## CONTACT & ESCALATION

**Security Issues:**
- Email: security@kondi.example.com
- Severity P0 (Critical): Notify CTO immediately
- Severity P1 (High): Notify within 24h
- Severity P2 (Medium): Weekly summary
- Severity P3 (Low): Monthly review

**Development Team:**
- Project Lead: [Name]
- Security Lead: [Name]
- DevOps Lead: [Name]

---

## NEXT STEPS

1. **Review this document** with engineering team
2. **Assign owners** to each critical issue
3. **Create JIRA tickets** for all issues
4. **Sprint planning** - allocate capacity
5. **Daily standups** - track progress
6. **Weekly security reviews** - verify fixes
7. **Penetration test** after critical fixes
8. **Production deployment** only after sign-off

---

**Last Updated:** 2026-04-02  
**Next Review:** Weekly until all Critical + High issues resolved  
**Document Owner:** Security Team
