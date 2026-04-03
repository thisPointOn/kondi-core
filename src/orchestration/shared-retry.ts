/**
 * Shared Retry Utility
 *
 * Centralized retry logic with unified contract for both council and pipeline orchestrators.
 * Provides: retryable error detection, exponential backoff with jitter, timeout handling,
 * and idempotence guard expectations.
 */

/**
 * Retryable error patterns
 */
const RETRYABLE_ERROR_PATTERNS = [
  /rate limit/i,
  /too many requests/i,
  /429/,
  /503/,
  /timeout/i,
  /ECONNRESET/,
  /ETIMEDOUT/,
  /ENOTFOUND/,
  /network error/i,
  /socket hang up/i,
  /overloaded/i,
];

/**
 * Check if an error is retryable.
 */
export function isRetryableError(error: Error): boolean {
  const message = error.message || error.toString();

  for (const pattern of RETRYABLE_ERROR_PATTERNS) {
    if (pattern.test(message)) {
      return true;
    }
  }

  return false;
}

/**
 * Calculate backoff delay with exponential growth and jitter.
 * @param attempt - Current attempt number (0-indexed)
 * @param baseDelayMs - Base delay in milliseconds (default: 1000)
 * @param maxDelayMs - Maximum delay in milliseconds (default: 30000)
 * @returns Delay in milliseconds
 */
export function calculateBackoff(
  attempt: number,
  baseDelayMs: number = 1000,
  maxDelayMs: number = 30000
): number {
  // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (capped)
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

  // Add jitter (±20% randomness)
  const jitter = cappedDelay * 0.2 * (Math.random() - 0.5) * 2;
  return Math.floor(cappedDelay + jitter);
}

/**
 * Sleep for a specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 2) */
  maxRetries?: number;

  /** Base delay between retries in ms (default: 1000) */
  baseDelayMs?: number;

  /** Maximum delay between retries in ms (default: 30000) */
  maxDelayMs?: number;

  /** Timeout for the entire operation in ms (default: none) */
  timeoutMs?: number;

  /** Called before each retry */
  onRetry?: (error: Error, attempt: number, delayMs: number) => void;

  /** Custom retryable error checker */
  isRetryable?: (error: Error) => boolean;
}

export interface RetryResult<T> {
  /** The successful result */
  result: T;

  /** Number of attempts made (1 = success on first try) */
  attempts: number;

  /** Total elapsed time in milliseconds */
  elapsedMs: number;

  /** Whether any retries were performed */
  hadRetries: boolean;
}

/**
 * Execute a function with retry logic.
 *
 * IMPORTANT: The function should be idempotent or have its own side-effect guards.
 * This utility does NOT provide idempotence guarantees.
 *
 * @param fn - The function to execute
 * @param options - Retry configuration
 * @returns Result with retry metadata
 * @throws The last error if all retries are exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  const {
    maxRetries = 2,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    timeoutMs,
    onRetry,
    isRetryable: customIsRetryable = isRetryableError,
  } = options;

  const startTime = Date.now();
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Check timeout before attempting
      if (timeoutMs) {
        const elapsed = Date.now() - startTime;
        if (elapsed >= timeoutMs) {
          throw new Error(`Operation timed out after ${elapsed}ms`);
        }
      }

      const result = await fn();

      return {
        result,
        attempts: attempt + 1,
        elapsedMs: Date.now() - startTime,
        hadRetries: attempt > 0,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on last attempt
      if (attempt === maxRetries) {
        break;
      }

      // Check if error is retryable
      if (!customIsRetryable(lastError)) {
        throw lastError;
      }

      // Calculate backoff delay
      const delayMs = calculateBackoff(attempt, baseDelayMs, maxDelayMs);

      // Call onRetry callback
      if (onRetry) {
        onRetry(lastError, attempt + 1, delayMs);
      }

      // Check if we have time to retry
      if (timeoutMs) {
        const elapsed = Date.now() - startTime;
        if (elapsed + delayMs >= timeoutMs) {
          throw new Error(`Cannot retry: would exceed timeout (${elapsed + delayMs}ms > ${timeoutMs}ms)`);
        }
      }

      // Wait before retrying
      await sleep(delayMs);
    }
  }

  // All retries exhausted
  throw lastError!;
}

/**
 * Retry policy presets for common scenarios.
 */
export const RetryPresets = {
  /** Fast retry for quick operations (2 retries, 500ms base delay) */
  fast: {
    maxRetries: 2,
    baseDelayMs: 500,
    maxDelayMs: 5000,
  } as RetryOptions,

  /** Standard retry for most operations (2 retries, 1s base delay) */
  standard: {
    maxRetries: 2,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
  } as RetryOptions,

  /** Aggressive retry for critical operations (5 retries, 1s base delay) */
  aggressive: {
    maxRetries: 5,
    baseDelayMs: 1000,
    maxDelayMs: 60000,
  } as RetryOptions,

  /** No retry (for idempotence-sensitive operations) */
  none: {
    maxRetries: 0,
  } as RetryOptions,
};
