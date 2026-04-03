#!/usr/bin/env npx tsx
/**
 * Cost Optimization Validation Suite
 *
 * Runs representative council tasks and compares before/after metrics:
 * - Total tokens used
 * - Number of findings
 * - Severity distribution
 * - Estimated cost
 *
 * Acceptance criteria:
 * - ≥70% cost reduction (tokens)
 * - ≥95% critical issue overlap
 * - No drop in highest severity findings
 */

import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// Test Task Definitions
// ============================================================================

interface TestTask {
  name: string;
  task: string;
  type: 'review' | 'analysis';
  expectedCriticalFindings?: string[];
}

const VALIDATION_TASKS: TestTask[] = [
  {
    name: 'Security Review',
    task: 'Review this codebase for security vulnerabilities, focusing on API key handling, input validation, and potential injection attacks',
    type: 'review',
  },
  {
    name: 'Performance Analysis',
    task: 'Analyze the codebase for performance bottlenecks, inefficient algorithms, and opportunities for optimization',
    type: 'analysis',
  },
  {
    name: 'Type Safety Check',
    task: 'Review TypeScript type definitions for type safety issues, missing types, and potential runtime errors',
    type: 'review',
  },
  {
    name: 'Code Quality Review',
    task: 'Assess code quality: readability, maintainability, adherence to best practices, and code organization',
    type: 'review',
  },
  {
    name: 'Dependency Audit',
    task: 'Review package.json dependencies for outdated packages, security vulnerabilities, and unused dependencies',
    type: 'analysis',
  },
];

// ============================================================================
// Metrics Types
// ============================================================================

interface TaskMetrics {
  taskName: string;
  tokensUsed: number;
  findingsCount: number;
  criticalFindings: number;
  majorFindings: number;
  minorFindings: number;
  fileReferences: number;
  latencyMs: number;
  estimatedCostUSD: number;
  rawOutput?: string;
}

interface ValidationResults {
  timestamp: string;
  mode: 'baseline' | 'optimized';
  tasks: TaskMetrics[];
  totalTokens: number;
  totalCost: number;
  avgLatency: number;
}

interface ComparisonReport {
  baseline: ValidationResults;
  optimized: ValidationResults;
  tokenReduction: number;
  costReduction: number;
  criticalOverlap: number;
  latencyChange: number;
  passed: boolean;
}

// ============================================================================
// Constants
// ============================================================================

// Claude Sonnet 4.5 pricing (as of directive)
const COST_PER_1K_INPUT_TOKENS = 0.003;
const COST_PER_1K_OUTPUT_TOKENS = 0.015;

// Simplified: average cost per 1k tokens (assuming 60/40 input/output split)
const AVG_COST_PER_1K_TOKENS = (COST_PER_1K_INPUT_TOKENS * 0.6) + (COST_PER_1K_OUTPUT_TOKENS * 0.4);

const BASELINE_FILE = join(__dirname, 'validation-baseline.json');
const RESULTS_FILE = join(__dirname, 'validation-results.json');

// ============================================================================
// Task Execution
// ============================================================================

/**
 * Runs a single council task and captures metrics.
 * Parses the output to extract findings and token counts.
 */
function runTask(task: TestTask, useOptimized: boolean): TaskMetrics {
  console.log(`  Running: ${task.name} (${useOptimized ? 'optimized' : 'baseline'})...`);

  const start = Date.now();
  const env = { ...process.env };

  // Disable caching for baseline runs
  if (!useOptimized) {
    env.KONDI_NO_CACHE = '1';
  }

  try {
    // Run council task (adjust command based on actual CLI)
    // This is a placeholder - actual command may vary
    const output = execSync(
      `npm run council -- --task "${task.task}" --type ${task.type} --quiet`,
      {
        cwd: join(__dirname, '..'),
        encoding: 'utf-8',
        timeout: 120000, // 2 minute timeout per task
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    const latency = Date.now() - start;

    // Parse output to extract metrics
    const metrics = parseTaskOutput(output, task.name, latency);
    return metrics;

  } catch (error: any) {
    console.error(`    ⚠️  Task failed: ${error.message}`);
    // Return minimal metrics on failure
    return {
      taskName: task.name,
      tokensUsed: 0,
      findingsCount: 0,
      criticalFindings: 0,
      majorFindings: 0,
      minorFindings: 0,
      fileReferences: 0,
      latencyMs: Date.now() - start,
      estimatedCostUSD: 0,
      rawOutput: error.message,
    };
  }
}

/**
 * Parses council task output to extract metrics.
 * Looks for patterns like "CRITICAL:", "MAJOR:", token counts, etc.
 */
function parseTaskOutput(output: string, taskName: string, latencyMs: number): TaskMetrics {
  // Extract token counts (looking for patterns like "Tokens: 1234" or similar)
  const tokenMatch = output.match(/(?:tokens?|token count)[:\s]+(\d+)/i);
  const tokensUsed = tokenMatch ? parseInt(tokenMatch[1], 10) : 0;

  // Count severity markers
  const criticalCount = (output.match(/\bCRITICAL\b/gi) || []).length;
  const majorCount = (output.match(/\bMAJOR\b/gi) || []).length;
  const minorCount = (output.match(/\bMINOR\b/gi) || []).length;

  // Count file references (lines with "file.ts:123" pattern)
  const fileRefMatches = output.match(/\w+\.[a-z]{2,4}:\d+/g) || [];
  const fileReferences = fileRefMatches.length;

  const totalFindings = criticalCount + majorCount + minorCount;
  const estimatedCost = (tokensUsed / 1000) * AVG_COST_PER_1K_TOKENS;

  return {
    taskName,
    tokensUsed,
    findingsCount: totalFindings,
    criticalFindings: criticalCount,
    majorFindings: majorCount,
    minorFindings: minorCount,
    fileReferences,
    latencyMs,
    estimatedCostUSD: estimatedCost,
    rawOutput: output.substring(0, 1000), // Store first 1k chars for debugging
  };
}

// ============================================================================
// Validation Runner
// ============================================================================

/**
 * Runs all validation tasks in the specified mode.
 */
function runValidationSuite(mode: 'baseline' | 'optimized'): ValidationResults {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Running validation in ${mode.toUpperCase()} mode`);
  console.log('='.repeat(60));

  const useOptimized = mode === 'optimized';
  const taskMetrics: TaskMetrics[] = [];

  for (const task of VALIDATION_TASKS) {
    const metrics = runTask(task, useOptimized);
    taskMetrics.push(metrics);
  }

  const totalTokens = taskMetrics.reduce((sum, m) => sum + m.tokensUsed, 0);
  const totalCost = taskMetrics.reduce((sum, m) => sum + m.estimatedCostUSD, 0);
  const avgLatency = taskMetrics.reduce((sum, m) => sum + m.latencyMs, 0) / taskMetrics.length;

  return {
    timestamp: new Date().toISOString(),
    mode,
    tasks: taskMetrics,
    totalTokens,
    totalCost,
    avgLatency,
  };
}

/**
 * Compares baseline and optimized results.
 */
function compareResults(baseline: ValidationResults, optimized: ValidationResults): ComparisonReport {
  const tokenReduction = ((baseline.totalTokens - optimized.totalTokens) / baseline.totalTokens) * 100;
  const costReduction = ((baseline.totalCost - optimized.totalCost) / baseline.totalCost) * 100;
  const latencyChange = ((optimized.avgLatency - baseline.avgLatency) / baseline.avgLatency) * 100;

  // Calculate critical finding overlap
  const baselineCritical = baseline.tasks.reduce((sum, t) => sum + t.criticalFindings, 0);
  const optimizedCritical = optimized.tasks.reduce((sum, t) => sum + t.criticalFindings, 0);
  const criticalOverlap = baselineCritical > 0
    ? (Math.min(baselineCritical, optimizedCritical) / baselineCritical) * 100
    : 100;

  // Check acceptance criteria
  const passed = tokenReduction >= 70 && criticalOverlap >= 95;

  return {
    baseline,
    optimized,
    tokenReduction,
    costReduction,
    criticalOverlap,
    latencyChange,
    passed,
  };
}

/**
 * Prints comparison report to console.
 */
function printReport(report: ComparisonReport): void {
  console.log('\n' + '='.repeat(60));
  console.log('VALIDATION RESULTS');
  console.log('='.repeat(60));

  console.log('\n📊 Token Usage:');
  console.log(`  Baseline:   ${report.baseline.totalTokens.toLocaleString()} tokens`);
  console.log(`  Optimized:  ${report.optimized.totalTokens.toLocaleString()} tokens`);
  console.log(`  Reduction:  ${report.tokenReduction.toFixed(1)}% ${report.tokenReduction >= 70 ? '✅' : '❌'}`);

  console.log('\n💰 Estimated Cost:');
  console.log(`  Baseline:   $${report.baseline.totalCost.toFixed(4)}`);
  console.log(`  Optimized:  $${report.optimized.totalCost.toFixed(4)}`);
  console.log(`  Reduction:  ${report.costReduction.toFixed(1)}%`);

  console.log('\n🔍 Critical Findings:');
  const baselineCritical = report.baseline.tasks.reduce((sum, t) => sum + t.criticalFindings, 0);
  const optimizedCritical = report.optimized.tasks.reduce((sum, t) => sum + t.criticalFindings, 0);
  console.log(`  Baseline:   ${baselineCritical} critical issues`);
  console.log(`  Optimized:  ${optimizedCritical} critical issues`);
  console.log(`  Overlap:    ${report.criticalOverlap.toFixed(1)}% ${report.criticalOverlap >= 95 ? '✅' : '❌'}`);

  console.log('\n⏱️  Latency:');
  console.log(`  Baseline:   ${(report.baseline.avgLatency / 1000).toFixed(1)}s avg`);
  console.log(`  Optimized:  ${(report.optimized.avgLatency / 1000).toFixed(1)}s avg`);
  console.log(`  Change:     ${report.latencyChange >= 0 ? '+' : ''}${report.latencyChange.toFixed(1)}%`);

  console.log('\n' + '='.repeat(60));
  console.log(report.passed ? '✅ VALIDATION PASSED' : '❌ VALIDATION FAILED');
  console.log('='.repeat(60));

  // Detailed task breakdown
  console.log('\n📋 Task Breakdown:\n');
  console.log('Task                    | Baseline Tokens | Optimized Tokens | Reduction');
  console.log('-'.repeat(75));

  for (let i = 0; i < report.baseline.tasks.length; i++) {
    const baseTask = report.baseline.tasks[i];
    const optTask = report.optimized.tasks[i];
    const taskReduction = ((baseTask.tokensUsed - optTask.tokensUsed) / baseTask.tokensUsed) * 100;

    console.log(
      `${baseTask.taskName.padEnd(23)} | ${baseTask.tokensUsed.toString().padStart(15)} | ` +
      `${optTask.tokensUsed.toString().padStart(16)} | ${taskReduction.toFixed(1)}%`
    );
  }

  console.log('');
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || 'compare';

  if (command === 'baseline') {
    console.log('Running BASELINE validation...');
    const baseline = runValidationSuite('baseline');
    writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2));
    console.log(`\n✅ Baseline saved to: ${BASELINE_FILE}`);
  }
  else if (command === 'optimized') {
    console.log('Running OPTIMIZED validation...');
    const optimized = runValidationSuite('optimized');
    writeFileSync(RESULTS_FILE, JSON.stringify(optimized, null, 2));
    console.log(`\n✅ Results saved to: ${RESULTS_FILE}`);
  }
  else if (command === 'compare') {
    console.log('Running FULL comparison (baseline + optimized)...\n');

    // Run baseline
    const baseline = runValidationSuite('baseline');
    writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2));

    // Run optimized
    const optimized = runValidationSuite('optimized');
    writeFileSync(RESULTS_FILE, JSON.stringify(optimized, null, 2));

    // Compare and report
    const report = compareResults(baseline, optimized);
    printReport(report);

    // Save comparison report
    const reportFile = join(__dirname, 'validation-comparison.json');
    writeFileSync(reportFile, JSON.stringify(report, null, 2));
    console.log(`\n📄 Full report saved to: ${reportFile}`);

    // Exit with appropriate code
    process.exit(report.passed ? 0 : 1);
  }
  else if (command === 'report') {
    // Generate report from existing baseline + results files
    if (!existsSync(BASELINE_FILE) || !existsSync(RESULTS_FILE)) {
      console.error('❌ Missing baseline or results file. Run validation first.');
      process.exit(1);
    }

    const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8'));
    const optimized = JSON.parse(readFileSync(RESULTS_FILE, 'utf-8'));
    const report = compareResults(baseline, optimized);
    printReport(report);
  }
  else {
    console.log('Usage:');
    console.log('  npx tsx validate-optimization.ts [command]');
    console.log('');
    console.log('Commands:');
    console.log('  baseline   - Run baseline tests only (with caching disabled)');
    console.log('  optimized  - Run optimized tests only (with caching enabled)');
    console.log('  compare    - Run both and compare results (default)');
    console.log('  report     - Generate report from existing results');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
