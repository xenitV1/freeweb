# AGENTS.md — FreeWeb MCP Server

## Project Overview

FreeWeb is a Playwright-based MCP (Model Context Protocol) server that gives LLMs unlimited web access without API keys. It uses real browser automation to search the web, browse pages, extract content, and interact with GitHub — all through the MCP protocol over stdio.

- **Package**: `freeweb-mcp`
- **Repo**: https://github.com/xenitV1/freeweb
- **License**: MIT
- **Runtime**: Node.js >= 18, ESM (`"type": "module"`)

## Tech Stack

- **Language**: TypeScript 5.7+ (strict mode)
- **Module system**: ES2022 / Node16 module resolution
- **Core deps**: `@modelcontextprotocol/sdk`, `playwright` (Chromium/Firefox/WebKit), `jsdom`, `dotenv`
- **Dev deps**: `@types/node`, `@types/jsdom`, `typescript`, `vitest`
- **Test framework**: Vitest (`npm test`). 537 unit tests in `tests/unit/`, 20 integration tests in `tests/integration/` (require external API access).

## Commands

```bash
npm run build        # tsc — compile src/ → dist/
npm run dev          # tsc --watch
npm start            # node dist/index.js
npm test             # vitest run (all tests)
npx vitest run tests/unit   # unit tests only (fast, no network deps)
```

- **Before committing**: always run `npm run build` and `npx vitest run tests/unit`, verify no type errors and all tests pass.

## Architecture

FreeWeb uses a **multi-layer fetcher chain** with HTTP-first strategy: it tries fast static fetchers (native `fetch`, ~400ms) before falling back to heavy Playwright browser automation (~3-5s). Most pages load 10x faster than Playwright-only.

```
src/
├── index.ts            — MCP server entry, 11 tool definitions
├── browser.ts          — BrowserManager singleton: multi-engine stealth (chromium/firefox/webkit)
├── browse.ts           — Browse orchestrator: browseUrl, browseSearchResults, withContext
├── search.ts           — Web search orchestrator: collectWebSearchResults, formatting
├── search-html.ts      — HTML parsers for search SERPs (Yahoo/Marginalia/Ask/DuckDuckGo)
├── scoring.ts          — Result scoring, normalization, deduplication, attempt summary
├── routing.ts          — llms.txt best-next-page routing (resolveLlmsRoute)
├── llms.ts             — llms.txt fetch/parse/score, formatLlmsGuidance, formatLlmsInspection
├── markdown.ts         — .md variant discovery (findMarkdownVersion, buildMarkdownCandidates)
├── url.ts              — URL normalization, search-URL building, redirect unwrapping, same-site check
├── text.ts             — Shared text utilities (cleanText, stripMarkdown, stripTags, query tokenization)
├── security.ts         — isUrlSafe, checkDownloadRequest, tagExternalContent (prompt-injection guard)
├── dates.ts            — Freshness check, date hint extraction, date formatting
├── cache.ts            — LRUCache<T> + InflightMap<T> primitives (TTL + eviction)
├── rate-limit.ts       — Sliding-window rate limiter
├── constants.ts        — Policy strings, domain lists, stop words, engine list
├── types.ts            — Shared types (Fetcher, WebSearchResult, SearchAttempt, etc.)
├── lib.ts              — Public barrel re-export surface for library consumers
├── utils.ts            — Playwright page extractors (extractContent, extractDate, extractLinks), SEARCH_ENGINES config
└── fetcher/
    ├── chain.ts        — Fetcher chain orchestrator (fetchWithChain, fetchWithChainSoft)
    ├── types.ts        — Fetcher interface, FetcherResult, FetcherOptions, defaults
    ├── markdown.ts     — Fetcher adapter: llms.txt-aware .md fetcher (priority 5)
    ├── github-raw.ts   — Fetcher: raw.githubusercontent.com README/files (priority 10)
    ├── rss.ts          — Fetcher: RSS/Atom feed discovery + parse (priority 30)
    ├── http.ts         — Fetcher: fetch() + jsdom static HTML (priority 40)
    ├── cache.ts        — Fetcher: Archive.org Wayback fallback (priority 80)
    └── playwright.ts   — Fetcher: full Playwright browser, SPA-aware (priority 100)
```

### Key Modules

| Module | Responsibility |
|--------|---------------|
| `index.ts` | Server setup, 11 MCP tools, tool handler orchestration |
| `browser.ts` | Multi-engine browser lifecycle (chromium/firefox/webkit), weighted rotation, stealth fingerprints, idle cleanup |
| `fetcher/chain.ts` | Strategy-pattern chain: sorts fetchers by priority, first non-empty result wins |
| `browse.ts` | Browse pipeline hub: chain-first, Playwright fallback, llms.txt routing integration |
| `search.ts` | HTTP-first search: tries `fetch()` for all engines, falls back to Playwright per-engine |
| `llms.ts` | llms.txt discovery (root→path), markdown parser, link relevance scoring, formatting |
| `text.ts` | Single source of truth for text utilities (cleanText, stripMarkdown, stripTags, query tokens) |

## Fetcher Chain (6 layers)

Every URL request goes through the chain, tried in priority order. First success wins:

| Priority | Fetcher | Speed | Best For |
|----------|---------|-------|----------|
| 5 | **llms.txt + Markdown** | ~300ms | Sites with `.md` variants |
| 10 | **GitHub Raw** | ~43ms | GitHub READMEs and files |
| 30 | **RSS/Atom Feed** | ~450ms | Blogs, news sites |
| 40 | **fetch() + jsdom** | ~400ms | Static HTML pages (~80% of web) |
| 80 | **Archive.org** | ~1.2s | Dead/blocked pages (Wayback) |
| 100 | **Playwright** | ~3-5s | SPA apps, bot-protected sites |

## MCP Tools (11)

| Tool | Purpose |
|------|---------|
| `inspect_llms_txt` | Parse and display a site's `llms.txt` |
| `web_search` | Search via Yahoo / DuckDuckGo / Marginalia / Ask (no API keys) |
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
- **Single source of truth** — text utilities in `text.ts`, search URLs in `url.ts:buildWebSearchUrl`, stop words in `constants.ts`
- **In-memory caches** — `LRUCache` (TTL + eviction) for llms.txt, markdown, and fetcher results
- **Error handling** — `.catch(() => {})` for non-critical failures, try/catch with fallback returns

## Security Model

- Only HTTPS/HTTP allowed (no other protocols)
- Blocked domains: malware, phishing, porn, etc.
- IP addresses blocked
- Download URLs blocked (`.zip`, `.exe`, `.dmg`, etc.)
- Suspicious ports blocked (only 80, 443, 8080, 3000, 5000 allowed)
- No forms filled, no logins, no payments
- **Indirect prompt-injection guard**: `tagExternalContent()` wraps all external web content in `<external-content>` tags with a safety notice before returning to the LLM (applied to 5 content-returning tools)

## Search Engine Strategy

- **Primary**: Yahoo Search (weight: 28) — best coverage
- **Fallback 1**: DuckDuckGo (weight: 15) — `html.duckduckgo.com` endpoint, HTTP-first with Playwright fallback
- **Fallback 2**: Marginalia (weight: 20) — `marginalia-search.com`, niche/indexed content
- **Legacy**: Ask.com (weight: 8) — endpoint deprecated (404), kept for explicit selection only
- **Auto mode order**: `[yahoo, duckduckgo, marginalia, ask]` — Yahoo doyduğunda durur
- Results are deduplicated, normalized (UTM/RK/RS params stripped, redirect URLs unwrapped via Yahoo/DuckDuckGo/Google), scored by domain quality + query relevance + freshness

## Key Patterns

- **Browser context per operation**: each tool call gets its own context ID via `genContextId()`, closed in `finally` blocks; per-page operations wrapped in try/finally to prevent leaks
- **HTTP-first search**: `collectWebSearchResults` tries native `fetch()` for all engines before Playwright; falls back per-engine on failure
- **Anti-bot stealth**: random UA, viewport, canvas noise, WebDriver property hidden, spoofed plugins/languages; multi-engine weighted rotation
- **SPA detection**: checks for `data-reactroot`, `data-v-app`, `#__next`, `#app`, hash-based routing
- **Content extraction priority**: GitHub README → iframe → hash content → main/article → body fallback; strips nav, sidebar, ads, cookie banners
- **llms.txt routing**: fetches `llms.txt` from root up to current path, scores links by query relevance (via shared `buildQueryTokens`/`countQueryHits`), routes to best matching page if score > 10

## Important Notes

- The `browserManager` is a singleton — browser launches lazily on first use
- All tool handlers return `{ content: [{ type: "text", text: ... }] }` or `{ type: "image" }` for screenshots
- Search result URLs go through `normalizeSearchResultUrl` to unwrap Yahoo (`RK`/`RS` path segments, `RU` param), Google (`q`), DuckDuckGo (`uddg`) redirect URLs
- Content is truncated at 12,000–15,000 chars depending on the tool
- No environment variables required; `PLAYWRIGHT_BROWSERS_PATH=0` optional for MCP clients; `FREEWEB_ENGINES` optional to restrict browser engines (e.g. `chromium` only)
