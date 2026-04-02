# Kondi Council — Launch Plan

## What We Built

### The Product (works now, tested)
- Standalone council CLI: `kondi council --task "..." --working-dir ./project`
- 4 preset configs: analysis, code-planning, coding, debate
- Multi-provider: Claude CLI + OpenAI Codex CLI + API providers
- Artifact output: deliberation.md, decision.md, output.md
- Session exports for GUI import
- `/council` slash command for Claude Code

### 8 Integration Packages (built, compiled, ready to publish)
All are thin wrappers (~50 lines) that shell out to `kondi council --json-stdout`.
The value is discoverability in each ecosystem, not the wrapper code itself.

| Package | npm/PyPI Name | Target Ecosystem |
|---------|--------------|------------------|
| npm CLI | `kondi-council` | Anyone with Node.js |
| MCP Server | `kondi-council-mcp` | Claude Desktop, Cursor, Windsurf, VS Code |
| n8n Node | `n8n-nodes-kondi` | n8n visual workflow users (181k stars) |
| LangGraph.js | `kondi-council-langgraph` | LangChain developers |
| Claude Agent SDK | `kondi-council-agent-tool` | Claude agent builders |
| OpenAI Agents SDK | `kondi-council-openai` | OpenAI agent builders |
| CrewAI (Python) | `kondi-council-crewai` | CrewAI users (47k stars) |
| Mastra | `kondi-council-mastra` | Mastra framework users |

### Scripts
- `./integrations/build-all.sh` — Builds all 8 packages
- `./integrations/build-all.sh --bump patch` — Bumps version + builds
- `./integrations/publish-all.sh` — Builds + publishes to npm/PyPI
- `./integrations/promote.sh` — Full launch: GitHub, publish, PRs, posts, browser tabs

---

## Launch Sequence (Do In This Order)

### Day 1: Ship It

#### Step 1: Record a demo (30 min)

```bash
sudo apt install asciinema

asciinema rec kondi-demo.cast

# In the recording, run:
kondi council \
  --config configs/councils/analysis.json \
  --task "Security and quality review of this codebase" \
  --working-dir ~/some-real-project \
  --output abbreviated

# Show the output:
cat ~/some-real-project/.kondi/outputs/*/summary.md

# End recording:
exit

# Upload (gives you a shareable URL):
asciinema upload kondi-demo.cast

# Or convert to GIF for GitHub/Reddit:
# Install agg: cargo install agg
agg kondi-demo.cast kondi-demo.gif
```

#### Step 2: Push to GitHub (15 min)

```bash
# Make sure you're logged in
gh auth login

# Create repo, push, publish all packages, PR to MCP directory
./integrations/promote.sh
```

Or step by step:
```bash
./integrations/promote.sh --step github    # create repo + push
./integrations/promote.sh --step publish   # npm publish × 7 + PyPI × 1
./integrations/promote.sh --step mcp-pr    # PR to MCP servers directory
```

#### Step 3: Post to Hacker News (5 min)

```bash
./integrations/promote.sh --step posts     # generates post content
./integrations/promote.sh --step announce  # opens browser tabs
```

Paste content from `integrations/.generated-posts/hackernews.md` into the HN submit form.

**The hook:** "Show HN: Kondi — I made Claude and GPT argue with each other before giving you an answer"

Best posting times for HN: Tuesday-Thursday, 8-10am ET.

---

### Week 1: Follow-Up

#### Submit to MCP directories
- Smithery.ai — MCP server marketplace (browser opened by promote script)
- mcp.so — community MCP directory
- The official PR to modelcontextprotocol/servers (handled by promote script)

#### n8n Community Forum
- Paste content from `integrations/.generated-posts/n8n-forum.md`
- Post in "Share a workflow" category

#### Twitter/X thread
- Paste from `integrations/.generated-posts/twitter.md`
- Include the demo GIF
- Tag @AnthropicAI @OpenAI @naboris (n8n creator)

#### Reddit comments
- Search r/LocalLLaMA and r/MachineLearning for threads about:
  - "multi-agent", "CrewAI", "AutoGen", "code review tool", "Claude vs GPT"
- Paste relevant snippet from `integrations/.generated-posts/reddit-comments.md`
- Don't self-promote — add value to existing conversations

---

### Week 2+: Grow

- Write a blog post explaining the deliberation pattern (why multiple models > one model)
- Create a YouTube walkthrough (5 min)
- Add more preset configs for specific use cases (API design review, test coverage analysis, etc.)
- Respond to GitHub issues and feature requests
- Monitor npm download stats: `npm info kondi-council`

---

## Where the Greatest Value Is

**MCP Server** is the highest leverage:
1. One config line adds councils to Claude Desktop
2. Users say "review my code" and it just works
3. MCP directories are actively browsed by early adopters
4. No code required from the user

**Hacker News** is the fastest path to eyes:
1. One post, one demo GIF
2. Front page = thousands of developers in hours
3. The multi-model debate angle is genuinely novel
4. "Show HN" posts get a ranking boost

**npm package** is the foundation:
1. Everything else depends on `kondi-council` being installable
2. People searching npm for "multi-agent" or "code review CLI" find you
3. Download count builds credibility over time

---

## Version Management

When you make changes:
```bash
# Make your code changes, then:
./integrations/build-all.sh --bump patch     # 0.1.0 → 0.1.1
./integrations/publish-all.sh               # publish new version everywhere
```

Bump types:
- `patch` — bug fixes (0.1.0 → 0.1.1)
- `minor` — new features (0.1.0 → 0.2.0)
- `major` — breaking changes (0.1.0 → 1.0.0)

---

## Prerequisites Checklist

Before launch, make sure you have:
- [ ] GitHub account with `gh auth login` working
- [ ] npm account with `npm login` working
- [ ] A real project to run the demo against (not the test project)
- [ ] asciinema installed for recording
- [ ] Demo GIF recorded and looking good
- [ ] Repo URL updated in all package.json files (replace "yourusername")

To update the repo URL everywhere:
```bash
find integrations/ -name "package.json" -exec sed -i 's|yourusername|YOUR_ACTUAL_USERNAME|g' {} +
find integrations/ -name "pyproject.toml" -exec sed -i 's|yourusername|YOUR_ACTUAL_USERNAME|g' {} +
```
