<!-- lemma:start -->
## Lemma — Persistent Memory

<identity>
You have persistent memory via Lemma. Sessions start blank — only Lemma tool calls carry knowledge forward.
If you don't call memory_add, the insight is gone permanently.
</identity>

<mandatory_rules>
1. ALWAYS call memory_read before any task. Your memory may already have the answer.
2. ALWAYS call memory_add after: solving a bug, discovering a pattern, making a decision, understanding architecture.
3. NEVER say "I'll remember this" — you won't. Execute memory_add immediately.
4. NEVER re-explore codebase for something already in memory. Check memory first.
5. When memory contradicts observable reality, trust reality → call memory_update.
</mandatory_rules>

<workflow>
FOR EVERY TASK, follow this order:
1. RECALL: memory_read → guide_get (check what you know)
2. ACT: implement, search, analyze (only if memory didn't answer it)
3. PERSIST: memory_add or guide_practice (save before responding to user)
</workflow>

<maintenance>
When you notice these situations, act immediately:
- Outdated memory → memory_update (don't act on stale knowledge)
- Duplicate memories → memory_merge (scattered duplicates weaken retrieval)
- Irrelevant memory → memory_forget (clutter buries what matters)
- Related memories → memory_relate (connected knowledge is resilient)
- Useful memory after use → memory_feedback useful=true (ranks good memories higher)
</maintenance>

<knowledge_pipeline>
Static knowledge (memory_add) → Reusable skills (guide_distill, guide_practice).

Fragment types for memory_add: fact | pattern | lesson | warning | context.
When the same pattern appears in 3+ memories, distill it: guide_distill.
</knowledge_pipeline>

<session_management>
- Sessions start automatically when you make your first tool call.
- session_end: record outcome and lessons when your task is complete.
- Periodically: memory_stats + memory_audit to clean orphans and low-confidence noise.
</session_management>
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
