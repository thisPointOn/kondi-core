# Kondi Council — Content Series

## Strategy

Two types of content, alternating:
1. **Development story posts** — How and why you built it (builds authority)
2. **Council showcase posts** — Actual debate excerpts with interesting results (shows value)

Post 2-3x per week. LinkedIn favors longer-form, Twitter favors threads with hooks.

---

## Series 1: Development Journey (LinkedIn + Twitter)

### Post 1: The Hook
**"I made Claude and GPT argue with each other before answering me"**

I got tired of asking one AI model for code reviews and getting a single perspective.

So I built a system where multiple models debate each other in structured rounds — with assigned roles:

- A Manager frames the problem
- Consultants argue FOR and AGAINST (across different models)
- A Worker produces the final output
- The Manager reviews and requests revisions

The result? Consistently better than any single model alone.

Here's a 4-minute security review that found 8 critical vulnerabilities a single model missed:

[screenshot of analysis output]

Open source: [link]

#AI #LLM #OpenSource #CodeReview

---

### Post 2: The Problem
**"Why single-model AI reviews miss things"**

I ran the same code review task three ways:

1. Claude alone → found 5 issues
2. GPT-o3 alone → found 6 issues (different ones)
3. Council (Claude + o3 debating) → found 8 issues, prioritized correctly

The difference? When the security-focused o3 persona challenged Claude's "this is probably fine" assessment of the auth system, it forced a deeper analysis that caught two critical vulnerabilities neither found alone.

This is the same principle as code review in teams — a second pair of eyes with a different perspective catches what you miss.

That's why I built Kondi Council — structured multi-model deliberation from the CLI.

[screenshot of debate excerpt]

---

### Post 3: The Architecture
**"How to orchestrate a debate between AI models"**

The deliberation protocol I built for Kondi Council:

```
Round 1: Manager frames the problem
Round 2: Consultants analyze independently
  - Advocate: strongest case FOR
  - Critic: strongest case AGAINST
  - Wildcard: unconventional angles
Round 3: Manager synthesizes, makes decision
Round 4: Worker executes based on decision
Round 5: Manager reviews output, may request revisions
```

Key design decisions:
- Each persona call is stateless (no session bleeding)
- Context budget prevents token overflow
- Consultants can run in parallel or sequential
- Every contribution is logged (full audit trail)

The whole thing runs from one command:
```
kondi council --task "Review this API" --working-dir ./myapp
```

[architecture diagram or flow screenshot]

---

### Post 4: The Multi-Provider Angle
**"Claude as the manager. GPT as the critic. Here's what happened."**

The most interesting thing about multi-model councils isn't that they're smarter — it's that they're *differently wrong*.

Claude tends to be diplomatic. GPT-o3 tends to be thorough but verbose. When you make o3 the critic and Claude the manager, you get:

- o3 pushes back hard on every assumption
- Claude synthesizes and cuts through the noise
- The final output has the rigor of o3 and the clarity of Claude

Example from a real council debate on "Should we use SQLite or PostgreSQL?":

[excerpt from debate]

---

### Post 5: Making It Distributable
**"From 'works on my machine' to 8 platforms in one script"**

This week I packaged Kondi Council for distribution:

- npm package (anyone: `npm install -g kondi-council`)
- MCP server (Claude Desktop, Cursor, Windsurf users)
- n8n node (visual workflow builder)
- LangGraph.js integration
- Claude Agent SDK tool
- OpenAI Agents SDK tool
- CrewAI bridge (Python)
- Mastra integration

All 8 are thin wrappers around the same CLI. One build script, one publish command.

The trick: bundle everything into a single 884KB file with zero runtime dependencies. esbuild does the heavy lifting.

```bash
./integrations/publish-all.sh --bump patch
# → 7 npm packages + 1 PyPI package published
```

---

### Post 6: The MCP Server
**"I added one line to my Claude Desktop config and got multi-model code review"**

MCP (Model Context Protocol) lets you add tools to Claude Desktop.

I built an MCP server for Kondi Council. Now I can say "run a security council on this project" in Claude Desktop and it orchestrates a full multi-model deliberation.

Setup:
```json
{
  "mcpServers": {
    "kondi-council": {
      "command": "npx",
      "args": ["-y", "kondi-council-mcp"]
    }
  }
}
```

That's it. One config line. Claude Desktop now has a council tool.

[screenshot of Claude Desktop using the council tool]

---

### Post 7: Real Results
**"I ran a council on our production codebase. Here's what it found."**

Ran the analysis council (5 personas, 3 rounds) on a real TypeScript API:

Results:
- 8 critical security issues (plaintext passwords, no auth, ReDoS)
- 3 performance bottlenecks (O(n) lookups, missing indexes)
- 11 code quality issues (any types, no error handling, dead code)
- Prioritized by impact/effort
- Specific file paths and line numbers
- Remediation guide with code examples

Total time: 4 minutes
Total cost: ~$0.50 in API calls

Would have taken a senior engineer 2-3 hours to produce the same report.

[screenshot of output.md]

---

## Series 2: Council Showcases (Run these, excerpt results)

### Showcase 1: "The Great Database Debate"
**Topic:** Should a small team use SQLite, PostgreSQL, or just stay with in-memory?
**Config:** debate.json
**Why it's interesting:** The advocate/critic/wildcard dynamic produces surprising arguments

### Showcase 2: "Security Audit — What Did the Council Find?"
**Topic:** Security review of a real open-source project
**Config:** analysis.json
**Why it's interesting:** Concrete findings people can verify. Shows real value.

### Showcase 3: "Architecture Decision: Monolith vs Microservices"
**Topic:** For a 3-person startup, monolith or microservices?
**Config:** debate.json
**Why it's interesting:** Controversial topic, strong opinions on both sides

### Showcase 4: "The Council Plans a Feature"
**Topic:** Plan adding real-time notifications to a web app
**Config:** code-planning.json
**Why it's interesting:** Shows the implementation spec output

### Showcase 5: "TypeScript vs JavaScript — The AI Debate"
**Topic:** Should a new project use TypeScript or JavaScript?
**Config:** debate.json
**Why it's interesting:** Every developer has an opinion. Engagement bait.

### Showcase 6: "The Council Writes Code"
**Topic:** Implement input validation and rate limiting
**Config:** coding.json
**Why it's interesting:** Shows the test/debug cycle, actual files written

### Showcase 7: "REST vs GraphQL — Settled by AI Council"
**Topic:** For a CRUD API, REST or GraphQL?
**Config:** debate.json
**Why it's interesting:** Another hot-take topic, drives comments

### Showcase 8: "Is TDD Worth It? — 5 AI Personas Debate"
**Topic:** Is test-driven development worth the overhead for a startup?
**Config:** debate.json
**Why it's interesting:** Practical question, real trade-offs

---

## Posting Schedule

| Week | Mon | Wed | Fri |
|------|-----|-----|-----|
| 1 | Post 1 (Hook) | Showcase 1 (Database) | Post 2 (Problem) |
| 2 | Showcase 2 (Security) | Post 3 (Architecture) | Showcase 3 (Monolith) |
| 3 | Post 4 (Multi-Provider) | Showcase 5 (TS vs JS) | Post 5 (Distribution) |
| 4 | Showcase 7 (REST vs GQL) | Post 6 (MCP Server) | Showcase 8 (TDD) |
| 5 | Post 7 (Real Results) | Showcase 4 (Planning) | Showcase 6 (Coding) |

---

## LinkedIn vs Twitter Format

**LinkedIn:**
- Full post (up to 3000 chars)
- Include 1-2 screenshots or a code block
- End with a question to drive comments
- Use hashtags: #AI #LLM #OpenSource #SoftwareEngineering #CodeReview

**Twitter/X:**
- Thread format (5-7 tweets)
- First tweet is the hook — must be compelling standalone
- Include GIF or screenshot in first tweet
- Last tweet has the repo link
- Quote-tweet your own thread with a one-liner summary

---

## Content Assets Needed

- [ ] Terminal demo GIF (asciinema → agg)
- [ ] Screenshot of analysis output.md (the security findings)
- [ ] Screenshot of a debate excerpt (advocate vs critic exchange)
- [ ] Architecture flow diagram (can be text-based)
- [ ] Screenshot of Claude Desktop using the MCP server
- [ ] Before/after comparison (single model vs council results)
