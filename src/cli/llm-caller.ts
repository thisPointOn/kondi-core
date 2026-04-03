/**
 * LLM Router — CLI + API
 *
 * CLI providers (anthropic-cli, openai-cli) spawn their binary for tool use.
 * API providers use direct HTTP calls for text-only analysis.
 * CLI is preferred when available — it uses subscriptions and supports tools.
 */

// ============================================================================
// Cache Key Generation for Anthropic Prompt Caching
// ============================================================================

interface CacheKeyOptions {
  repoHash: string;
  taskSignature: string;
  configVersion: string;
  diffFingerprint: string;
}

/**
 * Generates a cache key for Anthropic prompt caching.
 * Format: kondi-v1:<repo-hash>:<task-sig>:<config-ver>:<diff-fp>
 */
function generateCacheKey(opts: CacheKeyOptions): string {
  return `kondi-v1:${opts.repoHash}:${opts.taskSignature}:${opts.configVersion}:${opts.diffFingerprint}`;
}

/**
 * Gets the current git repository hash (short version).
 * Falls back to 'no-repo' if git is unavailable.
 */
async function getRepoHash(workingDir: string): Promise<string> {
  try {
    const { execSync } = await import('node:child_process');
    const hash = execSync('git rev-parse --short HEAD', {
      cwd: workingDir,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    return hash;
  } catch {
    return 'no-repo';
  }
}

/**
 * Generates a fingerprint of the current git diff.
 * Uses line count as a simple invalidation mechanism.
 * Falls back to 'no-git' if git is unavailable.
 */
async function getRepoDiffFingerprint(workingDir: string): Promise<string> {
  try {
    const { execSync } = await import('node:child_process');
    const diff = execSync('git diff HEAD', {
      cwd: workingDir,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const linesChanged = diff.split('\n').length;
    return `diff-${linesChanged}`;
  } catch {
    return 'no-git';
  }
}

// ============================================================================
// Types
// ============================================================================

export interface CallerResult {
  content: string;
  tokensUsed: number;
  latencyMs: number;
  sessionId?: string;
}

interface CallLLMOpts {
  provider: string;
  model?: string;
  systemPrompt: string;
  userMessage: string;
  workingDir?: string;
  skipTools?: boolean;
  timeoutMs?: number;
  enableCache?: boolean;         // Default: true for Anthropic
  cacheableContext?: string;     // Optional bootstrap context to cache
  maxTokens?: number;            // Optional override, default: 8000
}

export const DEFAULT_MODELS: Record<string, string> = {
  'anthropic-cli': 'claude-sonnet-4-5-20250929',
  'openai-cli': '',  // empty = let Codex use account default
  'anthropic-api': 'claude-sonnet-4-5-20250929',
  'openai-api': 'gpt-4o',
  'deepseek': 'deepseek-chat',
  'google': 'models/gemini-2.5-flash',
  'xai': 'grok-3',
  'ollama': 'llama3.1',
};

function getApiKey(provider: string): string | undefined {
  switch (provider) {
    case 'anthropic-api': return process.env.ANTHROPIC_API_KEY;
    case 'openai-api': return process.env.OPENAI_API_KEY;
    case 'deepseek': return process.env.DEEPSEEK_API_KEY;
    case 'xai': return process.env.XAI_API_KEY;
    case 'google': return process.env.GOOGLE_API_KEY;
    default: return undefined;
  }
}

// ============================================================================
// Provider implementations
// ============================================================================

/**
 * Calls Anthropic API with optional prompt caching support.
 *
 * When enableCache=true and cacheableContext is provided, the system prompt
 * is split into two parts: a cacheable bootstrap context and the remaining prompt.
 * This uses Anthropic's cache_control API to reduce input token costs by ~95%
 * for repeated context (cache TTL: 5 minutes).
 *
 * @param apiKey - Anthropic API key
 * @param model - Model name (e.g., claude-sonnet-4-5-20250929)
 * @param systemPrompt - System instructions
 * @param userMessage - User message content
 * @param enableCache - Enable prompt caching (default: false)
 * @param cacheableContext - Bootstrap context to cache (optional)
 * @param maxTokens - Maximum output tokens (default: 8000)
 */
async function callAnthropicAPI(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  enableCache?: boolean,
  cacheableContext?: string,
  maxTokens?: number,
): Promise<CallerResult> {
  const start = Date.now();

  // Prepare system prompt with optional caching
  let systemContent: any;

  if (enableCache && cacheableContext) {
    // Split into cacheable + non-cacheable parts
    systemContent = [
      {
        type: "text",
        text: cacheableContext,
        cache_control: { type: "ephemeral" }
      },
      {
        type: "text",
        text: systemPrompt
      }
    ];
  } else {
    // Standard non-cached system prompt
    systemContent = systemPrompt;
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens || 8000,
      system: systemContent,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Anthropic API ${resp.status}: ${text.substring(0, 500)}`);
  }

  const data = await resp.json();
  const content = data.content
    ?.filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n') || '';
  const usage = data.usage || {};

  // Log cache performance metrics
  const cacheCreationTokens = usage.cache_creation_input_tokens || 0;
  const cacheReadTokens = usage.cache_read_input_tokens || 0;
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;

  if (enableCache && cacheableContext) {
    const cacheStatus = cacheReadTokens > 0 ? 'HIT' : cacheCreationTokens > 0 ? 'MISS (created)' : 'MISS';
    console.log(
      `[Cache:${cacheStatus}] input=${inputTokens} output=${outputTokens} ` +
      `cached=${cacheReadTokens} created=${cacheCreationTokens} ` +
      `savings=${cacheReadTokens > 0 ? Math.round((cacheReadTokens / (inputTokens + cacheReadTokens)) * 100) : 0}%`
    );
  }

  return {
    content,
    tokensUsed: inputTokens + outputTokens,
    latencyMs: Date.now() - start,
  };
}

async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens?: number,
): Promise<CallerResult> {
  const start = Date.now();

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: maxTokens || 8000,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI API ${resp.status}: ${text.substring(0, 500)}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || '';
  const usage = data.usage || {};

  return {
    content,
    tokensUsed: (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
    latencyMs: Date.now() - start,
  };
}

async function callGeminiAPI(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens?: number,
): Promise<CallerResult> {
  const start = Date.now();

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: { maxOutputTokens: maxTokens || 8000 },
      }),
    },
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Gemini API ${resp.status}: ${text.substring(0, 500)}`);
  }

  const data = await resp.json();
  const content = data.candidates?.[0]?.content?.parts
    ?.map((p: any) => p.text)
    .join('\n') || '';
  const usage = data.usageMetadata || {};

  return {
    content,
    tokensUsed: (usage.promptTokenCount || 0) + (usage.candidatesTokenCount || 0),
    latencyMs: Date.now() - start,
  };
}

// ============================================================================
// Unified router
// ============================================================================

export async function callLLM(opts: CallLLMOpts): Promise<CallerResult> {
  const provider = opts.provider || 'anthropic-cli';
  const model = opts.model || DEFAULT_MODELS[provider] || 'claude-sonnet-4-5-20250929';

  // CLI binary providers — preferred when available (subscription-based, tool use)
  if (provider === 'anthropic-cli') {
    const { callClaude } = await import('./claude-caller');
    return callClaude({ ...opts, model });
  }
  if (provider === 'openai-cli') {
    const { callCodex } = await import('./codex-caller');
    return callCodex({ ...opts, model: model || undefined });
  }

  // API providers — require API keys
  const apiKey = getApiKey(provider);
  if (!apiKey && provider !== 'ollama') {
    const envVar = provider === 'anthropic-api' ? 'ANTHROPIC_API_KEY'
      : provider === 'openai-api' ? 'OPENAI_API_KEY'
      : provider === 'deepseek' ? 'DEEPSEEK_API_KEY'
      : provider === 'xai' ? 'XAI_API_KEY'
      : provider === 'google' ? 'GOOGLE_API_KEY'
      : 'API_KEY';
    throw new Error(`No API key for "${provider}". Set ${envVar} in environment or .env file.`);
  }

  // Check for cache disable flag (env var or explicit option)
  const cacheDisabled = process.env.KONDI_NO_CACHE === '1' || opts.enableCache === false;
  const enableCache = !cacheDisabled && (opts.enableCache ?? true);

  if (provider === 'anthropic-api') {
    return callAnthropicAPI(
      apiKey!,
      model,
      opts.systemPrompt,
      opts.userMessage,
      enableCache,
      opts.cacheableContext,
      opts.maxTokens
    );
  }
  if (provider === 'openai-api') {
    return callOpenAICompatible(
      'https://api.openai.com/v1',
      apiKey!,
      model,
      opts.systemPrompt,
      opts.userMessage,
      opts.maxTokens
    );
  }
  if (provider === 'deepseek') {
    return callOpenAICompatible(
      'https://api.deepseek.com/v1',
      apiKey!,
      model,
      opts.systemPrompt,
      opts.userMessage,
      opts.maxTokens
    );
  }
  if (provider === 'xai') {
    return callOpenAICompatible(
      'https://api.x.ai/v1',
      apiKey!,
      model,
      opts.systemPrompt,
      opts.userMessage,
      opts.maxTokens
    );
  }
  if (provider === 'google') {
    return callGeminiAPI(
      apiKey!,
      model,
      opts.systemPrompt,
      opts.userMessage,
      opts.maxTokens
    );
  }
  if (provider === 'ollama') {
    return callOpenAICompatible(
      'http://localhost:11434/v1',
      'ollama',
      model,
      opts.systemPrompt,
      opts.userMessage,
      opts.maxTokens
    );
  }

  throw new Error(`Unknown provider "${provider}". Supported: anthropic-api, openai-api, deepseek, xai, google, ollama`);
}
