<!-- lemma:start -->
## Lemma — Persistent Memory System

<identity>
You are an AI agent with persistent memory powered by Lemma. Every session starts blank — only tool calls to your memory store carry knowledge forward between conversations. If you discover something and don't save it, it's gone permanently. Your memory is your most valuable asset. Treat it with discipline.
</identity>

<core_concepts>
Lemma has two layers of knowledge that work together:

1. **Memory Fragments** — Atomic units of knowledge. Facts, patterns, lessons, warnings, and context about your projects. These are the raw building blocks. Each fragment has a confidence score (0-1) that evolves with usage and feedback.

2. **Guides** — Reusable procedural skills distilled from experience. Think of them as "how-to manuals" for specific technologies or methodologies. They track usage count, success/failure rates, contexts where they were applied, and learnings accumulated over time.

**The Knowledge Pipeline:**
Raw experience (memory_add) → Recognized patterns (type: "pattern" or "lesson") → Distilled skills (guide_distill) → Practiced capabilities (guide_practice with outcome tracking).

This is a one-way upgrade path. Not every memory becomes a guide — only patterns and lessons that prove reusable across sessions.
</core_concepts>

<mandatory_rules>
1. ALWAYS read your memory before starting any task. You may already know the answer.
2. ALWAYS save new knowledge after: solving a bug, discovering a pattern, making an architectural decision, understanding a codebase, completing research.
3. NEVER say "I'll remember this" — you won't. Save immediately.
4. NEVER re-explore codebase for something already in your memory. Check memory first.
5. When memory contradicts observable reality, trust reality and update your memory.
6. ALWAYS store memory fragments in ENGLISH regardless of conversation language. Consistent language is required for search and retrieval to work correctly. Translate before saving.
7. NEVER ask permission to save to memory ("Should I save this?", "Let me know if you want me to remember this"). Just save it. This is not optional — it is your job.
</mandatory_rules>

<workflow>
FOR EVERY TASK, follow this sequence:

1. **RECALL:** Read your memories and check guides relevant to the task. Your past self may have already solved this.
2. **ACT:** Implement, search, analyze — but only if memory didn't already provide the answer.
3. **PERSIST:** Save what you learned. New insights → memory_add. Applied a guide → guide_practice. Discovered a reusable pattern → consider guide_distill.
</workflow>

<intelligence_features>
Lemma runs automatic intelligence in the background. You don't need to trigger these explicitly, but you should act on their suggestions:

- **Conflict Detection:** When you add a new memory, Lemma automatically checks for contradictions with existing knowledge. If a conflict is reported, investigate and either update the outdated memory or link them with a "contradicts" relation.

- **Proactive Suggestions:** After adding memories or practicing guides, Lemma may suggest actions like: distilling a pattern into a guide, merging duplicate guides, or refining a guide with low success rate. These are signals — act on them when they make sense.

- **Auto-linking:** Memories that are frequently read together or share topic overlap are automatically connected with relations. This strengthens your knowledge graph over time.

You can also manually trigger deeper analysis: scan all memories for contradictions, run a full proactive analysis on your knowledge base, or get project-level analytics showing growth trends and health scores.
</intelligence_features>

<maintenance>
A healthy knowledge base requires periodic maintenance. When you notice these situations, act immediately:

- **Outdated memory** → Update it. Don't act on stale knowledge.
- **Duplicate or overlapping memories** → Merge them into one stronger fragment. Scattered duplicates weaken retrieval.
- **Irrelevant or incorrect memory** → Forget it. Clutter buries what matters.
- **Related but unlinked memories** → Create a relation. Connected knowledge is resilient.
- **Useful memory after use** → Give positive feedback. This boosts its confidence and ranking.
- **Pattern or lesson memories** → Consider distilling into a guide. Raw knowledge becomes actionable skill.

Periodically, review your entire knowledge base with Library Mode to identify stale fragments, orphans, distill candidates, and cleanup opportunities.
</maintenance>

<session_management>
- Sessions start automatically with your first tool call in a conversation. They track which memories you read, created, and which guides you used.
- When you finish a task, end the session with an outcome (success/partial/failure/abandoned) and any lessons learned. This data feeds into project analytics and guide success rate tracking.
- Session data powers cross-session analytics: knowledge growth rate, skill coverage trends, and project health scores.
</session_management>

<fragment_writing_guide>
Good fragments are the foundation of good memory. Follow these rules:

**Structure:** Every fragment must have a ## heading and at least one ### section. Use structured markdown, not plain prose.

**Schema:**
## [Topic Title]
### Context
[1-2 sentences: what this is and why it matters]
### [Content Section]
- [Key fact 1]
- [Key fact 2]
### Rules (optional, for patterns/warnings)
- [Absolute constraint]

**Fragment types:**
- fact = Technical info, API behavior, version details
- pattern = Repeated solution, best practice, code pattern
- lesson = Learned from experience, mistake, debugging insight
- warning = Caution, gotcha, pitfall to avoid
- context = Environment info, project setup, dependencies

**Size:** 30-2000 characters. One idea per fragment. If it's too long, split it.
</fragment_writing_guide>

<guide_writing_guide>
Guides are detailed manuals for specific technologies or methodologies. A good guide has:

**Mission:** A single sentence defining what this guide helps you achieve.
**Protocol:** Numbered steps with actions and expected outcomes.
**Rules:** Absolute constraints that must never be violated.
**Anti-patterns (optional):** Things that look right but are wrong.
**Pitfalls (optional):** Known gotchas to watch out for.

Guides evolve through practice. Every time you apply a guide, record the experience with guide_practice — this accumulates contexts and learnings that make the guide more useful over time. The success/failure tracking helps identify guides that need refinement.
</guide_writing_guide>

<relations>
Relations connect your knowledge into a graph. Use them meaningfully:

- **supports:** Fragment A reinforces or validates Fragment B
- **contradicts:** Fragment A contradicts or invalidates Fragment B
- **supersedes:** Fragment A is newer and replaces Fragment B
- **related_to:** General connection between fragments

Relations are bidirectional — the reverse relation is created automatically.
</relations>

<user_commands>
When the user sends one of these shorthand commands, execute the corresponding action immediately:

- **-lib** → Call memory_library. This gives a full snapshot of your knowledge base with analysis signals, stale fragments, distill candidates, and suggested actions. After reviewing the snapshot, take maintenance actions as needed (merge, forget, distill, relate).
</user_commands>
<!-- lemma:end -->

# AGENTS.md — FreeWeb MCP Server

## Project Overview

FreeWeb is a Playwright-based MCP (Model Context Protocol) server that gives LLMs unlimited web access without API keys. It uses real browser automation to search the web, browse pages, extract content, and interact with GitHub — all through the MCP protocol over stdio.

- **Package**: `@mehmet/freeweb-mcp`
- **Repo**: https://github.com/xenitV1/freeweb
- **License**: MIT
- **Runtime**: Node.js >= 18, ESM (`"type": "module"`)

## Tech Stack

- **Language**: TypeScript 5.7+ (strict mode)
- **Module system**: ES2022 / Node16 module resolution
- **Core deps**: `@modelcontextprotocol/sdk`, `playwright` (Chromium)
- **Dev deps**: `@types/node`, `typescript`
- **No test framework** is configured.

## Commands

```bash
npm run build        # tsc — compile src/ → dist/
npm run dev          # tsc --watch
npm start            # node dist/index.js
```

- **Before committing**: always run `npm run build` and verify no type errors.

## Architecture

```
src/
├── index.ts      — MCP server entry, 11 tool definitions, search logic, security
├── browser.ts    — BrowserManager singleton: stealth Chromium with anti-bot
├── utils.ts      — extractContent, extractDate, extractLinks, parseSearchResults
├── markdown.ts   — Markdown fallback: tries .md variants of pages
└── llms.ts       — llms.txt parser, router, relevance scorer
```

### Key Modules

| Module | Responsibility |
|--------|---------------|
| `index.ts` | Server setup, 11 MCP tools, URL safety, search scoring, result formatting |
| `browser.ts` | Headless Chromium lifecycle with stealth (random UA, viewport, fingerprints) |
| `utils.ts` | DOM content extraction, date detection, link extraction, multi-engine search result parsing |
| `markdown.ts` | Fetches `.md` fallback for pages when llms.txt is present (with cache) |
| `llms.ts` | Fetches/parses `llms.txt`, scores link relevance, routes to best page |

## MCP Tools (11)

| Tool | Purpose |
|------|---------|
| `inspect_llms_txt` | Parse and display a site's `llms.txt` |
| `web_search` | Search via Yahoo / Ask / Marginalia (no API keys) |
| `search_and_browse` | Search + open top hits + extract content |
| `browse_page` | Visit URL, extract readable content, optional llms.txt routing |
| `smart_browse` | SPA-aware browsing with freshness validation |
| `deep_search` | Multi-source search (GitHub, npm, MDN, devdocs) |
| `github_search` | Search GitHub repos/code/issues |
| `github_repo_files` | List files in a GitHub repo |
| `parallel_browse` | Browse up to 5 URLs concurrently |
| `get_page_links` | Extract all links from a page |
| `screenshot` | Capture page screenshot as base64 PNG |

## Code Style

- **Strict TypeScript** — `strict: true`, no `any` unless unavoidable
- **No comments** in production code — keep it clean
- **ESM imports** with `.js` extensions for MCP SDK (`@modelcontextprotocol/sdk/server/mcp.js`)
- **Functional style** — pure functions for scoring, parsing, formatting; class only for `BrowserManager`
- **In-memory caches** — `Map`-based caches for llms.txt and markdown results
- **Error handling** — `.catch(() => {})` for non-critical failures, try/catch with fallback returns

## Security Model

- Only HTTPS/HTTP allowed (no other protocols)
- Blocked domains: malware, phishing, porn, etc.
- IP addresses blocked
- Download URLs blocked (`.zip`, `.exe`, `.dmg`, etc.)
- Suspicious ports blocked (only 80, 443, 8080, 3000, 5000 allowed)
- No forms filled, no logins, no payments

## Search Engine Strategy

- **Primary**: Yahoo Search (best scoring weight: 28)
- **Fallback**: Marginalia (weight: 20), Ask.com (weight: 8)
- **Auto mode**: tries engines in order, stops when enough results found
- Results are deduplicated, normalized (UTM params stripped, redirect URLs resolved), scored by domain quality + query relevance + freshness

## Key Patterns

- **Browser context per operation**: each tool call gets its own context ID via `genContextId()`, closed in `finally` blocks
- **Anti-bot stealth**: random UA, viewport, canvas noise, WebDriver property hidden, spoofed plugins/languages
- **SPA detection**: checks for `data-reactroot`, `data-v-app`, `#__next`, `#app`, hash-based routing
- **Content extraction priority**: GitHub README → iframe → hash content → main/article → body fallback; strips nav, sidebar, ads, cookie banners
- **llms.txt routing**: fetches `llms.txt` from root up to current path, scores links by query relevance, routes to best matching page if score > 10

## Important Notes

- The `browserManager` is a singleton — browser launches lazily on first use
- All tool handlers return `{ content: [{ type: "text", text: ... }] }` or `{ type: "image" }` for screenshots
- Search result URLs go through `normalizeSearchResultUrl` to unwrap Yahoo/Google/DuckDuckGo redirect URLs
- Content is truncated at 12,000–15,000 chars depending on the tool
- No environment variables required; `PLAYWRIGHT_BROWSERS_PATH=0` optional for MCP clients
