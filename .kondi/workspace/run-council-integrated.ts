#!/usr/bin/env -S npx tsx
/**
 * CLI Council Runner (Budget-Integrated)
 *
 * Integrated version with budget-aware invocation, phase-to-stage mapping,
 * persistent budget state, and unified retry logic.
 */

// ── localStorage shim MUST be imported first ──
import { storage } from '../../src/cli/localStorage-shim';

import fs from 'node:fs';
import path from 'node:path';
import { councilStore } from '../../src/council/store';
import { createCouncilFromSetup } from '../../src/council/factory';
import { DeliberationOrchestrator } from '../../src/council/deliberation-orchestrator';
import { CodingOrchestrator } from '../../src/council/coding-orchestrator';
import { ledgerStore } from '../../src/council/ledger-store';
import { buildAbbreviatedSummary } from '../../src/services/deliberationSummary';
import { DEFAULT_MODELS, type CallerResult } from '../../src/cli/llm-caller';
import { loadCouncilConfig, mergeConfigWithArgs } from '../../src/cli/council-config';
import { writeCouncilArtifacts, buildJsonResult } from '../../src/cli/council-artifacts';
import { exportCouncilSession } from '../../src/cli/council-session-export';
import type { CouncilCliArgs, OutputFormat } from '../../src/cli/council-config';
import type { Council, Persona, CouncilStepType } from '../../src/council/types';

// Budget integration imports
import { createBudgetAwareInvoker } from '../../src/budget/budget-aware-invoker';
import { mapPhaseToStage } from '../../src/budget/phase-stage-map';
import type { ModelTier } from '../../src/budget/budget-tracker';

// ── ANSI colors ──
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
};

let quietMode = false;

function log(color: string, prefix: string, msg: string) {
  if (quietMode) return;
  const ts = new Date().toLocaleTimeString();
  console.log(`${C.dim}${ts}${C.reset} ${color}${C.bold}[${prefix}]${C.reset} ${msg}`);
}

// ── Parse CLI args ──
function parseArgs(): CouncilCliArgs {
  const args = process.argv.slice(2);
  const parsed: CouncilCliArgs = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--working-dir':
        parsed.workingDir = next ? path.resolve(args[++i]) : undefined;
        break;
      case '--type':
        parsed.type = next as CouncilStepType;
        i++;
        break;
      case '--task':
        parsed.task = args[++i];
        break;
      case '--model':
        parsed.model = args[++i];
        break;
      case '--provider':
        parsed.provider = args[++i];
        break;
      case '--config':
        parsed.configPath = args[++i];
        break;
      case '--output':
        parsed.outputFormat = next as OutputFormat;
        i++;
        break;
      case '--output-dir':
        parsed.outputDir = path.resolve(args[++i]);
        break;
      case '--no-session-export':
        parsed.noSessionExport = true;
        break;
      case '--no-cache':
        parsed.noCache = true;
        break;
      case '--dry-run':
        parsed.dryRun = true;
        break;
      case '--quiet':
        parsed.quiet = true;
        break;
      case '--json-stdout':
        parsed.jsonStdout = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        if (!arg.startsWith('--') && !parsed.councilJsonPath) {
          parsed.councilJsonPath = path.resolve(arg);
        }
        break;
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`
${C.bold}Kondi Council Runner (Budget-Integrated)${C.reset}

Usage:
  kondi council <council.json> [options]
  kondi council --task "Your task" [options]
  kondi council --config <config.json> [options]
  kondi council [options]                          (auto-discovers council.json)

Options:
  --config <path>        Path to council config file (JSON)
  --task "..."           Task/problem for the council to work on
  --type <type>          Council type: council, coding, review, analysis, agent (default: council)
  --working-dir <path>   Working directory for file operations
  --model <model>        Override model for all personas
  --provider <provider>  Override provider for all personas
  --output <format>      Output format: full, abbreviated, output-only, json, none (default: full)
  --output-dir <path>    Override artifact output directory
  --no-session-export    Skip session export to ~/.local/share/kondi/sessions/
  --no-cache             Disable Anthropic prompt caching for bootstrap context (default: enabled)
  --dry-run              Print council structure without running
  --quiet                Suppress progress output (for automation)
  --json-stdout          Print structured JSON result to stdout
  --help                 Show this help
`);
}

// ── Print council structure (for --dry-run) ──
function printCouncilStructure(council: Council, councilType: string, task: string, workingDir?: string) {
  console.log(`\n${C.bold}${C.cyan}Council: ${council.name}${C.reset}`);
  console.log(`${C.dim}Type: ${councilType}${C.reset}`);
  console.log(`${C.dim}Task: ${task.slice(0, 300)}${task.length > 300 ? '...' : ''}${C.reset}`);
  if (workingDir) console.log(`${C.dim}Working dir: ${workingDir}${C.reset}`);

  console.log(`\n${C.bold}Personas:${C.reset}`);
  for (const p of council.personas) {
    const role = p.preferredDeliberationRole || 'unassigned';
    const roleColor = role === 'manager' ? C.blue :
                      role === 'worker' ? C.yellow :
                      role === 'reviewer' ? C.cyan : C.green;
    console.log(`  ${roleColor}${p.avatar || ''} ${p.name}${C.reset} (${role}) — ${p.model} [${p.provider}]`);
    if (p.predisposition?.domain) console.log(`    ${C.dim}Domain: ${p.predisposition.domain}${C.reset}`);
    if (p.predisposition?.traits?.length) console.log(`    ${C.dim}Traits: ${p.predisposition.traits.join(', ')}${C.reset}`);
  }

  if (council.deliberation) {
    console.log(`\n${C.bold}Orchestration:${C.reset}`);
    console.log(`  ${C.dim}Max rounds: ${council.deliberation.maxRounds}${C.reset}`);
    console.log(`  ${C.dim}Max revisions: ${council.deliberation.maxRevisions}${C.reset}`);
    console.log(`  ${C.dim}Context budget: ${council.deliberation.contextTokenBudget} tokens${C.reset}`);
  }
  console.log();
}

/**
 * Map provider + model to a budget tier.
 * Simplified mapping for demonstration.
 */
function mapProviderModelToTier(provider: string, model: string): ModelTier {
  if (provider === 'anthropic-api') {
    return 'anthropic-premium';
  }
  if (model.includes('gpt-4o-mini')) {
    return 'openai-mini';
  }
  if (model.includes('gpt-4')) {
    return 'openai-mid';
  }
  return 'openai-mid'; // Default
}

// ── Main ──
async function main() {
  const args = parseArgs();
  quietMode = args.quiet || false;

  // ── Resolve council source (same as original) ──
  let council: Council;
  let councilType: CouncilStepType = args.type || 'council';
  let task: string;
  let workingDir = args.workingDir;
  let outputFormat: OutputFormat = args.outputFormat || 'full';
  let outputDir = args.outputDir;
  let sessionExport = !args.noSessionExport;

  if (args.councilJsonPath) {
    // Path 1: Explicit council JSON export
    if (!fs.existsSync(args.councilJsonPath)) {
      console.error(`File not found: ${args.councilJsonPath}`);
      process.exit(1);
    }
    let raw: any;
    try {
      raw = JSON.parse(fs.readFileSync(args.councilJsonPath, 'utf-8'));
    } catch (e) {
      console.error(`Invalid JSON in council file: ${args.councilJsonPath}`);
      process.exit(1);
    }

    if (raw.personas && raw.deliberation) {
      council = raw as Council;
      councilStore.create({
        name: council.name,
        topic: council.topic || council.name,
        personas: council.personas,
        orchestration: council.orchestration,
        deliberation: council.deliberation,
      });
      council = councilStore.getAll().at(-1)!;
    } else {
      console.error('Invalid council JSON format — expected personas and deliberation fields');
      process.exit(1);
    }
    task = args.task || council.deliberation?.savedProblem || council.topic;

  } else {
    // Path 2: Config file (explicit or auto-discovered)
    const configFile = loadCouncilConfig(args.configPath);

    if (configFile) {
      const resolved = mergeConfigWithArgs(configFile, args);
      councilType = resolved.type;
      task = resolved.task;
      outputFormat = resolved.outputFormat;
      outputDir = resolved.outputDir;
      sessionExport = resolved.sessionExport;

      const defaultProvider = resolved.provider || 'anthropic-api';

      council = createCouncilFromSetup({
        name: configFile.name,
        topic: task,
        personas: configFile.personas.map(p => {
          const prov = p.provider || defaultProvider;
          return {
          name: p.name,
          role: p.role,
          provider: prov,
          model: p.model || resolved.model || DEFAULT_MODELS[prov] || '',
          avatar: p.avatar,
          systemPrompt: p.systemPrompt || `You are ${p.name}.`,
          traits: p.traits || [],
          stance: p.stance,
          domain: p.domain,
          temperature: p.temperature,
          suppressPersona: p.suppressPersona,
          toolAccess: p.toolAccess,
        }}),
        workingDirectory: workingDir,
        stepType: councilType,
        contextTokenBudget: configFile.orchestration?.contextTokenBudget || 80000,
        summarizeAfterRound: configFile.orchestration?.summarizeAfterRound || 2,
        maxRounds: configFile.orchestration?.maxRounds,
        maxRevisions: configFile.orchestration?.maxRevisions,
        consultantExecution: configFile.orchestration?.consultantExecution,
        evolveContext: configFile.orchestration?.evolveContext,
        bootstrapContext: configFile.orchestration?.bootstrapContext,
        expectedOutput: configFile.expectedOutput,
        decisionCriteria: configFile.decisionCriteria,
        testCommand: configFile.testCommand,
        maxDebugCycles: configFile.maxDebugCycles,
        maxReviewCycles: configFile.maxReviewCycles,
      });

    } else if (args.task) {
      // Path 3: Inline task with default personas
      task = args.task;
      const defaultProvider = args.provider || 'anthropic-api';
      const defaultModel = args.model || 'claude-sonnet-4-5-20250929';

      council = createCouncilFromSetup({
        name: task.slice(0, 60),
        topic: task,
        personas: [
          { name: 'Manager', role: 'manager', provider: defaultProvider, model: defaultModel, avatar: '👔', systemPrompt: 'You are the manager.', traits: ['analytical'], suppressPersona: true },
          { name: 'Worker', role: 'worker', provider: defaultProvider, model: defaultModel, avatar: '🔧', systemPrompt: 'You are the worker.', traits: ['precise'], temperature: 0.5, suppressPersona: true },
          { name: 'Consultant', role: 'consultant', provider: defaultProvider, model: defaultModel, avatar: '🌟', systemPrompt: 'You are a consultant.', traits: ['creative'], stance: 'advocate' },
        ],
        workingDirectory: workingDir,
        stepType: councilType,
        contextTokenBudget: 80000,
        summarizeAfterRound: 2,
      });

    } else {
      console.error('No council source provided. Use --task, --config, or pass a council.json file.');
      console.error('Run with --help for usage information.');
      process.exit(1);
    }
  }

  // Apply overrides
  if (args.model) {
    council.personas = council.personas.map(p => ({ ...p, model: args.model! }));
  }
  if (args.provider) {
    council.personas = council.personas.map(p => ({ ...p, provider: args.provider! }));
  }
  if (workingDir && council.deliberation) {
    council.deliberation.workingDirectory = workingDir;
  }

  const rawProblem = task!;
  const effectiveWorkingDir = workingDir || process.cwd();

  // ── Dry run ──
  if (args.dryRun) {
    printCouncilStructure(council, councilType, rawProblem, workingDir);
    console.log(`${C.dim}Output format: ${outputFormat}${C.reset}`);
    console.log(`${C.dim}Session export: ${sessionExport}${C.reset}`);
    console.log(`${C.dim}--dry-run: exiting without executing.${C.reset}`);
    process.exit(0);
  }

  // ── Log startup ──
  log(C.green, 'Council', `"${council.name}" — ${councilType} mode`);
  log(C.green, 'Council', `Personas: ${council.personas.map(p => p.name).join(', ')}`);
  if (workingDir) log(C.green, 'Council', `Working dir: ${workingDir}`);
  log(C.green, 'Council', `Task: ${rawProblem.slice(0, 200)}${rawProblem.length > 200 ? '...' : ''}`);
  log(C.green, 'Council', `Output: ${outputFormat}`);
  if (!quietMode) console.log('');

  // ── Create budget-aware invoker ──
  const budgetInvoker = createBudgetAwareInvoker({
    verbose: !quietMode,
    restoreState: false, // Fresh run
  });

  const startTime = Date.now();

  // Track current phase for stage mapping
  let currentPhase = 'problem_framing';

  const invokeAgent = async (invocation: any, persona: Persona) => {
    log(C.cyan, persona.name, `Thinking... (${persona.model})`);

    // Map provider/model to tier
    const requestedTier = mapProviderModelToTier(persona.provider, persona.model);

    // Map current phase to budget stage
    const stage = mapPhaseToStage(currentPhase as any);

    try {
      const result = await budgetInvoker.invoke({
        stage,
        requestedTier,
        persona,
        invocation: {
          systemPrompt: invocation.systemPrompt,
          userMessage: invocation.userMessage,
          workingDirectory: invocation.workingDirectory || workingDir,
          skipTools: invocation.skipTools,
          allowedTools: invocation.allowedTools,
          timeoutMs: invocation.timeoutMs || 900_000,
          cacheableContext: invocation.cacheableContext,
        },
      });

      log(C.cyan, persona.name, `Done (${result.tokensUsed} tokens, ${(result.latencyMs / 1000).toFixed(1)}s)`);

      if (result.downgraded) {
        log(C.yellow, persona.name, `Model downgraded to ${result.actualModel} (${result.reasonCode})`);
      }

      return { ...result, sessionId: result.sessionId };
    } catch (error) {
      log(C.red, persona.name, `Failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  };

  const callbacks = {
    invokeAgent,
    onPhaseChange: (from: string, to: string) => {
      currentPhase = to;
      log(C.yellow, 'Phase', `${from} → ${to}`);
    },
    onError: (err: Error, ctx: string) => log(C.red, 'Error', `${ctx}: ${err.message}`),
    onAgentThinkingStart: (_persona: Persona) => {},
    onAgentThinkingEnd: (_persona: Persona) => {},
  };

  // ── Execute ──
  let status: 'completed' | 'failed' = 'completed';
  let errorMsg: string | undefined;

  try {
    if (councilType === 'coding') {
      const orchestrator = new CodingOrchestrator({
        ...callbacks,
        runCommand: async (cmd: string, cwd?: string) => {
          const { execFileSync } = await import('node:child_process');
          try {
            const stdout = execFileSync('/bin/sh', ['-c', cmd], { cwd: cwd || workingDir, encoding: 'utf-8', timeout: 120_000 });
            return { stdout, stderr: '', exitCode: 0 };
          } catch (err: any) {
            return { stdout: err.stdout || '', stderr: err.stderr || err.message, exitCode: err.status || 1 };
          }
        },
        readFile: async (filePath: string) => {
          const resolved = path.resolve(filePath);
          const base = path.resolve(effectiveWorkingDir);
          if (!resolved.startsWith(base + path.sep) && resolved !== base) {
            throw new Error(`Path traversal blocked: ${filePath} escapes working directory`);
          }
          return fs.readFileSync(filePath, 'utf-8');
        },
      });
      await orchestrator.runCodingWorkflow(council, rawProblem);
    } else {
      const deliberator = new DeliberationOrchestrator(callbacks);
      await deliberator.runFullDeliberation(council, rawProblem);
    }

    log(C.green, 'Done', 'Council completed');
  } catch (error) {
    status = 'failed';
    errorMsg = error instanceof Error ? error.message : String(error);
    log(C.red, 'Fatal', errorMsg);
  }

  const durationMs = Date.now() - startTime;

  // ── Print budget telemetry ──
  if (!quietMode) {
    const telemetry = budgetInvoker.getTelemetry();
    console.log(`\n${C.bold}Budget Summary:${C.reset}`);
    console.log(`  Total spend: $${telemetry.totalSpendUSD.toFixed(4)} (${telemetry.runUtilization.toFixed(1)}%)`);
    console.log(`  Anthropic calls: ${telemetry.anthropicCalls} ($${telemetry.anthropicSpend.toFixed(4)})`);
    console.log(`  Downgrades: ${telemetry.downgrades}`);
  }

  // ── Print summary ──
  if (!quietMode) {
    const completed = councilStore.get(council.id);
    if (completed) {
      const summary = buildAbbreviatedSummary(completed);
      console.log('\n' + C.bold + '═══ Summary ═══' + C.reset);
      console.log(summary);
    }

    const entries = ledgerStore.getAll(council.id);
    const totalTokens = entries.reduce((s, e) => s + (e.tokensUsed || 0), 0);
    console.log(`\n${C.dim}Entries: ${entries.length} | Tokens: ${totalTokens.toLocaleString()} | Time: ${(durationMs / 1000).toFixed(0)}s${C.reset}`);
  }

  // ── Write artifacts ──
  let artifactPaths: string[] = [];
  try {
    artifactPaths = writeCouncilArtifacts(council, {
      format: outputFormat,
      outputDir,
      workingDir: effectiveWorkingDir,
    });
    if (artifactPaths.length > 0 && !quietMode) {
      log(C.cyan, 'Artifacts', `Written ${artifactPaths.length} file(s):`);
      for (const p of artifactPaths) {
        console.log(`  ${C.dim}${p}${C.reset}`);
      }
    }
  } catch (err) {
    console.error(`${C.red}Failed to write artifacts:${C.reset}`, err);
  }

  // ── Session export ──
  if (sessionExport) {
    try {
      const sessionPath = exportCouncilSession(council.id, storage, {
        status,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs,
        workingDirectory: effectiveWorkingDir,
      });
      if (sessionPath && !quietMode) {
        log(C.cyan, 'Session', `Exported to: ${sessionPath}`);
      }
    } catch (err) {
      console.error(`${C.red}Failed to export session:${C.reset}`, err);
    }
  }

  // ── JSON stdout ──
  if (args.jsonStdout) {
    const jsonResult = buildJsonResult(council, artifactPaths, {
      status,
      durationMs,
      error: errorMsg,
    });
    console.log(JSON.stringify(jsonResult));
  }

  if (status === 'failed') {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`${C.red}Unhandled error:${C.reset}`, err);
  process.exit(1);
});
