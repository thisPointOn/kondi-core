# Kondi Council

Multi-LLM council deliberation system. Runs structured debates between AI personas across providers to produce reviewed, high-quality outputs.

## Quick Start

```bash
git clone https://github.com/thisPointOn/kondi-core.git
cd kondi-core
npm install

# Set API keys (get from console.anthropic.com and platform.openai.com)
cp .env.example .env
# Edit .env with your keys

# Run a council
npx tsx src/cli/kondi.ts council --task "Review this codebase" --working-dir ~/my-project
```

## How It Works

You define a council of AI personas with assigned roles and stances. They deliberate in structured rounds:

```
1. Manager frames the problem
2. Consultants argue from assigned positions (advocate, critic, wildcard)
3. Manager evaluates arguments, decides direction
4. Worker produces the final deliverable
5. Manager reviews, may request revisions
```

Each persona can be a different model from a different provider. Claude as the manager synthesizing. GPT-4o as the critic poking holes. The tension between models with different strengths produces better output than any single model alone.

## Providers

All calls go through direct HTTP APIs. Set the key for each provider you want to use:

| Provider | Env Var | Models |
|----------|---------|--------|
| Anthropic | `ANTHROPIC_API_KEY` | `claude-sonnet-4-5-20250929`, `claude-haiku-4-5-20251001` |
| OpenAI | `OPENAI_API_KEY` | `gpt-4o`, `gpt-4-turbo` |
| Google | `GOOGLE_API_KEY` | `models/gemini-2.5-flash` |
| DeepSeek | `DEEPSEEK_API_KEY` | `deepseek-chat` |
| xAI | `XAI_API_KEY` | `grok-3` |
| Ollama | (local, no key) | `llama3.1`, any local model |

## Preset Configs

Four ready-to-use council configurations in `configs/councils/`:

### analysis.json — Code Review

5 personas: Lead Analyst (Claude), Security Auditor (GPT-4o), Performance Engineer (Claude), Code Quality Reviewer (GPT-4o), Report Writer (Claude).

```bash
npx tsx src/cli/kondi.ts council \
  --config configs/councils/analysis.json \
  --task "Security and quality audit" \
  --working-dir ~/my-project
```

### debate.json — Structured Debate

5 personas: Moderator (Claude), Advocate (GPT-4o), Critic (Claude), Wildcard (GPT-4o), Synthesizer (Claude).

```bash
npx tsx src/cli/kondi.ts council \
  --config configs/councils/debate.json \
  --task "Should we migrate to microservices?"
```

### code-planning.json — Implementation Planning

4 personas: Architect (Claude), Systems Thinker (GPT-4o), Pragmatist (Claude), Implementer (Claude).

```bash
npx tsx src/cli/kondi.ts council \
  --config configs/councils/code-planning.json \
  --task "Plan adding auth to the API" \
  --working-dir ~/my-project
```

### coding.json — Code Implementation

4 personas: Tech Lead (Claude), Code Reviewer (GPT-4o), Design Consultant (Claude), Developer (Claude).

```bash
npx tsx src/cli/kondi.ts council \
  --config configs/councils/coding.json \
  --task "Add input validation" \
  --working-dir ~/my-project
```

## Options

```
--config <path>        Council config JSON
--task "..."           Task for the council
--type <type>          council, coding, code_planning, analysis, review, agent
--working-dir <path>   Target project directory (default: cwd)
--model <model>        Override model for all personas
--provider <provider>  Override provider for all personas
--output <format>      full, abbreviated, output-only, json, none (default: full)
--output-dir <path>    Override artifact output directory
--no-session-export    Skip session export
--dry-run              Preview structure without running
--quiet                Suppress progress output
--json-stdout          Print JSON result to stdout
```

## Output

After a council completes, artifacts are written to `<working-dir>/.kondi/outputs/<name>_<timestamp>/`:

| Format | Files |
|--------|-------|
| `full` | `deliberation.md` + `decision.md` + `output.md` |
| `abbreviated` | `summary.md` |
| `output-only` | `output.md` |
| `json` | `council-result.json` |

## Custom Configs

```json
{
  "name": "My Council",
  "task": "Default task",
  "type": "council",
  "personas": [
    {
      "name": "Manager",
      "role": "manager",
      "provider": "anthropic-api",
      "model": "claude-sonnet-4-5-20250929",
      "systemPrompt": "You are the decision maker.",
      "traits": ["analytical"],
      "suppressPersona": true
    },
    {
      "name": "Critic",
      "role": "consultant",
      "provider": "openai-api",
      "model": "gpt-4o",
      "systemPrompt": "You find flaws and risks.",
      "traits": ["rigorous"],
      "stance": "critic",
      "domain": "security"
    },
    {
      "name": "Worker",
      "role": "worker",
      "provider": "anthropic-api",
      "model": "claude-sonnet-4-5-20250929",
      "systemPrompt": "You produce the final output.",
      "traits": ["precise"],
      "suppressPersona": true
    }
  ],
  "orchestration": {
    "maxRounds": 4,
    "maxRevisions": 3,
    "contextTokenBudget": 80000,
    "bootstrapContext": true
  },
  "output": {
    "format": "full"
  }
}
```

### Roles

| Role | Purpose |
|------|---------|
| `manager` | Frames problem, evaluates arguments, decides, reviews output |
| `consultant` | Provides expertise, debates from assigned stance |
| `worker` | Produces the final deliverable |
| `reviewer` | Reviews worker output (used in coding type) |

### Stances

| Stance | Behavior |
|--------|----------|
| `advocate` | Argues FOR the approach |
| `critic` | Argues AGAINST, finds risks |
| `wildcard` | Questions the framing, proposes alternatives |
| `neutral` | Balanced perspective |

## Automation

```bash
# Scheduled review
npx tsx src/cli/kondi.ts council \
  --config configs/councils/analysis.json \
  --task "Nightly security scan" \
  --working-dir /opt/myapp \
  --quiet --json-stdout >> /var/log/reviews.jsonl

# Pipe output
npx tsx src/cli/kondi.ts council \
  --task "Review this" \
  --json-stdout --quiet | jq '.output'
```

## License

AGPL-3.0-only
