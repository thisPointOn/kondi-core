# Kondi Council - Critical Security Fixes Checklist

**Priority Level**: URGENT  
**Target Completion**: Before ANY production deployment

---

## ✅ IMMEDIATE ACTION ITEMS (Complete These First)

### 1. Command Injection Prevention
**Files to Fix:**
- [ ] `src/cli/node-platform.ts` - Replace execFileSync with safe alternative
- [ ] `src/cli/run-council.ts` - Add command sanitization
- [ ] `src/cli/codex-caller.ts` - Validate spawn arguments

**Action Plan:**
```typescript
// BEFORE (UNSAFE):
execFileSync('/bin/sh', ['-c', cmd], { ... })

// AFTER (SAFE):
import { shellEscape } from 'shell-escape';
const safeCmd = shellEscape(cmd);
// OR use allowlist
const ALLOWED_COMMANDS = ['npm', 'git', 'node'];
if (!ALLOWED_COMMANDS.some(c => cmd.startsWith(c))) {
  throw new Error('Command not allowed');
}
```

---

### 2. JSON Parsing Hardening
**Files to Fix:**
- [ ] `src/cli/council-config.ts` - Add Zod validation
- [ ] `src/cli/run-council.ts` - Validate before use
- [ ] `src/cli/run-pipeline.ts` - Add schema checks
- [ ] `src/cli/localStorage-shim.ts` - Prevent prototype pollution

**Action Plan:**
```typescript
// BEFORE (UNSAFE):
const parsed = JSON.parse(raw);

// AFTER (SAFE):
import { z } from 'zod';

function safeJsonParse<T>(raw: string, schema: z.ZodSchema<T>): T {
  const parsed = JSON.parse(raw, (key, value) => {
    // Prevent prototype pollution
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return undefined;
    }
    return value;
  });
  
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid JSON: ${result.error.message}`);
  }
  
  return Object.freeze(result.data);
}
```

---

### 3. Path Traversal Protection
**Files to Fix:**
- [ ] `src/cli/run-council.ts` - Fix TOCTOU race
- [ ] `src/cli/node-platform.ts` - Add symlink resolution

**Action Plan:**
```typescript
// BEFORE (VULNERABLE):
const resolved = path.resolve(filePath);
const base = path.resolve(workingDir);
if (!resolved.startsWith(base + path.sep)) {
  throw new Error('Path traversal blocked');
}

// AFTER (SECURE):
import fs from 'fs/promises';

async function assertSafePath(filePath: string, workingDir: string): Promise<void> {
  // Resolve symlinks first
  const realFilePath = await fs.realpath(filePath).catch(() => filePath);
  const realBase = await fs.realpath(workingDir).catch(() => workingDir);
  
  const normalized = path.normalize(realFilePath);
  
  // Check for .. sequences
  if (normalized.includes('..')) {
    throw new Error('Path contains parent directory references');
  }
  
  // Verify within bounds
  if (!normalized.startsWith(realBase + path.sep) && normalized !== realBase) {
    throw new Error(`Path traversal blocked: ${filePath}`);
  }
  
  // Log for audit
  console.log(`[SECURITY] File access: ${normalized}`);
}
```

---

### 4. API Key Redaction
**Files to Fix:**
- [ ] `src/cli/llm-caller.ts` - Sanitize errors
- [ ] Add global error sanitizer

**Action Plan:**
```typescript
// Add to utils/error-sanitizer.ts
const SENSITIVE_PATTERNS = [
  /api[_-]?key/i,
  /token/i,
  /secret/i,
  /password/i,
  /bearer\s+\S+/i,
];

export function sanitizeError(error: Error): Error {
  let message = error.message;
  let stack = error.stack || '';
  
  for (const pattern of SENSITIVE_PATTERNS) {
    message = message.replace(pattern, '[REDACTED]');
    stack = stack.replace(pattern, '[REDACTED]');
  }
  
  const sanitized = new Error(message);
  sanitized.stack = stack;
  return sanitized;
}

// Use in catch blocks:
catch (error) {
  const safe = sanitizeError(error as Error);
  console.error(safe);
}
```

---

### 5. Child Process Cleanup
**Files to Fix:**
- [ ] `src/cli/claude-caller.ts` - Add process tree killer
- [ ] `src/cli/codex-caller.ts` - Fix cleanup race
- [ ] `src/cli/run-council.ts` - Improve exit handlers

**Action Plan:**
```typescript
// Add to utils/process-manager.ts
import { ChildProcess } from 'child_process';

export class ProcessManager {
  private processes = new Set<ChildProcess>();
  
  track(child: ChildProcess): void {
    this.processes.add(child);
    
    child.once('exit', () => {
      this.processes.delete(child);
    });
  }
  
  killAll(signal: NodeJS.Signals = 'SIGTERM'): void {
    for (const child of this.processes) {
      try {
        // Kill process group if detached
        if (child.pid) {
          process.kill(-child.pid, signal);
        }
        child.kill(signal);
      } catch (err) {
        console.error(`Failed to kill process ${child.pid}:`, err);
      }
    }
  }
  
  forceKillAll(): void {
    setTimeout(() => {
      this.killAll('SIGKILL');
    }, 5000);
  }
}

// Global instance
export const processManager = new ProcessManager();

// Register cleanup
process.on('exit', () => processManager.killAll());
process.on('SIGINT', () => { 
  processManager.killAll();
  processManager.forceKillAll();
  process.exit(130);
});
```

---

### 6. Config File Validation
**Files to Fix:**
- [ ] `src/cli/council-config.ts` - Add trust verification

**Action Plan:**
```typescript
// Add warning for untrusted configs
export function loadCouncilConfig(configPath?: string): CouncilConfigFile | null {
  if (configPath) {
    const resolved = path.resolve(configPath);
    
    // Warn about untrusted configs
    if (!resolved.startsWith(os.homedir())) {
      console.warn('⚠️  WARNING: Loading config from outside home directory');
      console.warn('⚠️  This config file could execute arbitrary commands');
      console.warn(`⚠️  Path: ${resolved}`);
      
      // TODO: Add interactive confirmation in future
    }
    
    return parseAndValidate(resolved);
  }
}
```

---

### 7. Rate Limiting
**Files to Create:**
- [ ] `src/utils/rate-limiter.ts` - New file

**Action Plan:**
```typescript
// src/utils/rate-limiter.ts
export class RateLimiter {
  private calls: Map<string, number[]> = new Map();
  
  constructor(
    private maxCalls: number,
    private windowMs: number
  ) {}
  
  async throttle(key: string): Promise<void> {
    const now = Date.now();
    const calls = this.calls.get(key) || [];
    
    // Remove old calls outside window
    const recent = calls.filter(t => t > now - this.windowMs);
    
    if (recent.length >= this.maxCalls) {
      const oldestCall = recent[0];
      const waitTime = this.windowMs - (now - oldestCall);
      
      console.warn(`Rate limit reached for ${key}, waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return this.throttle(key); // Retry
    }
    
    recent.push(now);
    this.calls.set(key, recent);
  }
}

// Usage in llm-caller.ts:
const apiRateLimiter = new RateLimiter(60, 60000); // 60 calls/min

async function callOpenAICompatible(...) {
  await apiRateLimiter.throttle(`${baseUrl}:${model}`);
  // ... rest of function
}
```

---

### 8. File Write Protection
**Files to Fix:**
- [ ] `src/cli/node-platform.ts` - Add size limits

**Action Plan:**
```typescript
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const ALLOWED_EXTENSIONS = ['.md', '.txt', '.json', '.js', '.ts', '.py', '.sh'];

async writeFile(filePath: string, content: string): Promise<void> {
  assertSafePath(filePath, workingDir);
  
  // Check file size
  const sizeBytes = Buffer.byteLength(content, 'utf-8');
  if (sizeBytes > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${sizeBytes} bytes (max ${MAX_FILE_SIZE})`);
  }
  
  // Check extension
  const ext = path.extname(filePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new Error(`File extension not allowed: ${ext}`);
  }
  
  // Create directory
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  
  // Write with restricted permissions
  await fs.promises.writeFile(filePath, content, { 
    encoding: 'utf-8',
    mode: 0o644 // rw-r--r--
  });
  
  // Audit log
  console.log(`[AUDIT] Wrote file: ${filePath} (${sizeBytes} bytes)`);
}
```

---

## 🔧 TESTING CHECKLIST

After implementing fixes, verify:

- [ ] Command injection: Try `cmd = "ls; rm -rf /"` - should be blocked
- [ ] JSON parsing: Load malformed JSON - should error gracefully
- [ ] Path traversal: Try `filePath = "../../../etc/passwd"` - should be blocked
- [ ] API keys: Trigger error with API call - no keys in logs
- [ ] Process cleanup: Kill parent - no zombie processes
- [ ] Rate limiting: Make 100 rapid API calls - should throttle
- [ ] File size: Write 200MB file - should be rejected
- [ ] Config validation: Load untrusted config - should warn

---

## 📊 VERIFICATION COMMANDS

```bash
# 1. Check for unsafe patterns
grep -r "execSync\|execFileSync\|eval(" src/
grep -r "JSON.parse" src/ | grep -v "try\|catch"
grep -r "path.resolve" src/ | grep -v "realpath"

# 2. Find exposed secrets
git log -p | grep -i "api.key\|password\|token"

# 3. Check process cleanup
ps aux | grep "node\|claude\|codex" # Should be empty after exit

# 4. Test file permissions
ls -la ~/.local/share/kondi/cli-state/ # Should NOT be world-readable

# 5. Audit network calls
sudo tcpdump -i any -A port 443 # Check for leaked secrets
```

---

## 🚨 DEPLOYMENT BLOCKERS

**DO NOT deploy to production until ALL of these are complete:**

- [ ] All 8 critical fixes implemented
- [ ] Security tests passing
- [ ] Code review by security expert
- [ ] Penetration testing completed
- [ ] Dependency audit clean (`npm audit`)
- [ ] Environment variables encrypted
- [ ] API keys in secure vault (not .env files)
- [ ] Logs sanitized (no secrets)

---

## 📝 ADDITIONAL HARDENING (After Critical Fixes)

### Phase 2 Improvements:
1. Add request signing for API calls
2. Implement CSP headers for web endpoints
3. Add HMAC validation for webhooks
4. Enable security headers (HSTS, X-Frame-Options)
5. Add input length limits everywhere
6. Implement file upload virus scanning
7. Add IP-based rate limiting
8. Enable audit logging for all security events

### Phase 3 Improvements:
1. Add intrusion detection
2. Implement security monitoring/alerting
3. Add automated security testing in CI/CD
4. Regular dependency updates
5. Security training for developers
6. Bug bounty program
7. Third-party security audit
8. SOC 2 compliance

---

## 📞 RESOURCES

- OWASP Top 10: https://owasp.org/www-project-top-ten/
- Node.js Security Best Practices: https://nodejs.org/en/docs/guides/security/
- CWE Database: https://cwe.mitre.org/
- NIST Cybersecurity Framework: https://www.nist.gov/cyberframework

---

## ⏱️ ESTIMATED TIME TO COMPLETE

- **Critical Fixes**: 2-3 days (1 developer)
- **Testing**: 1 day
- **Code Review**: 1 day
- **Total**: ~1 week

**Start Date**: _________________  
**Target Completion**: _________________  
**Actual Completion**: _________________  

---

**Remember**: Security is not a one-time fix. Continuous monitoring and updates are essential.
