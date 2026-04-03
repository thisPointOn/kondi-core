/**
 * Persistent Budget State
 *
 * Provides crash-durable budget state persistence with atomic writes.
 * State is saved immediately after each mutation and restored on startup.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface PersistedBudgetState {
  version: number;
  runId: string;
  timestamp: string;
  totalSpendUSD: number;
  stageSpend: Record<string, number>;
  callCount: number;
  anthropicCalls: number;
  anthropicSpend: number;
  lastPhase?: string;
}

/**
 * Get the deterministic state file path.
 * Uses project runtime data directory or falls back to temp dir.
 */
function getStatePath(): string {
  // Try to use .kondi/runtime directory in current working directory
  const projectDir = path.join(process.cwd(), '.kondi', 'runtime');

  try {
    fs.mkdirSync(projectDir, { recursive: true });
    return path.join(projectDir, 'budget-state.json');
  } catch (err) {
    // Fall back to temp directory if project dir is not writable
    const tempDir = os.tmpdir();
    return path.join(tempDir, 'kondi-budget-state.json');
  }
}

/**
 * Load persisted budget state from disk.
 * Returns null if file doesn't exist or is corrupt.
 */
export function loadBudgetState(): PersistedBudgetState | null {
  const statePath = getStatePath();

  try {
    if (!fs.existsSync(statePath)) {
      return null;
    }

    const data = fs.readFileSync(statePath, 'utf-8');
    const state = JSON.parse(data) as PersistedBudgetState;

    // Validate version
    if (state.version !== 1) {
      console.warn(`[Budget] Unsupported state version ${state.version}, ignoring`);
      return null;
    }

    return state;
  } catch (err) {
    console.warn(`[Budget] Failed to load state: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Save budget state to disk with atomic write (temp + rename).
 * Fails gracefully if write fails.
 */
export function saveBudgetState(state: PersistedBudgetState): void {
  const statePath = getStatePath();
  const tempPath = `${statePath}.tmp`;

  try {
    // Write to temp file
    fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf-8');

    // Atomic rename
    fs.renameSync(tempPath, statePath);
  } catch (err) {
    console.warn(`[Budget] Failed to save state: ${err instanceof Error ? err.message : String(err)}`);

    // Clean up temp file if it exists
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Clear persisted budget state (for new runs).
 */
export function clearBudgetState(): void {
  const statePath = getStatePath();

  try {
    if (fs.existsSync(statePath)) {
      fs.unlinkSync(statePath);
    }
  } catch (err) {
    console.warn(`[Budget] Failed to clear state: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Create a new run ID for tracking.
 */
export function createRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
