# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [2.0.0] - 2026-04-10

### Added

**Architecture (Phase 1)**
- Split 1333-line `index.ts` into 11 focused modules: `types.ts`, `constants.ts`, `security.ts`, `text.ts`, `url.ts`, `dates.ts`, `scoring.ts`, `routing.ts`, `browse.ts`, `search.ts`, `rate-limit.ts`
- Unified `browseUrl()` pipeline replacing 3x duplicated browse logic
- `withContext()` helper eliminating manual context management boilerplate
- `src/lib.ts` as backward-compatible re-export barrel for tests

**Multi-Browser (Phase 2)**
- Firefox and WebKit browser engine support alongside Chromium
- Weight-based engine rotation (Chromium 50%, Firefox 30%, WebKit 20%)
- Engine-specific stealth scripts (different UA, headers, plugins per engine)
- Automatic fallback: Chromium blocked → Firefox → WebKit
- Lazy engine launch with 5-minute idle timeout cleanup
- `FREEWEB_ENGINES` env var for engine allowlist configuration
- Parallel llms.txt and markdown candidate fetching via `Promise.allSettled()`

**LRU Cache (Phase 0)**
- Generic `LRUCache<T>` with configurable max size and TTL
- `InflightMap<T>` for concurrent request deduplication
- llms.txt cache: max 500 entries, 30 min TTL
- Markdown cache: max 300 entries, 20 min TTL
- Null results no longer cached (transient errors)

**Search Quality (Phase 5)**
- DuckDuckGo search engine activated (weight: 15)
- `extractStructuredContent()`: JSON-LD, tables, and lists extraction
- `extractBySelector()`: CSS selector-based targeted content extraction
- Relative URL support in llms.txt parser (`/docs/api`, `./guide.html`)
- `llms-full.txt` support (parallel candidates + short-content fallback)
- `SearchEngineConfig` interface with `SEARCH_ENGINES` registry

**Security (Phase 6)**
- Segment-based domain blocking (fixes `hackney.gov.uk`, `adultlearning.edu` false positives)
- `localhost`, `localhost.localdomain`, `[::1]`, `::1` blocking
- Expanded download extensions: `.pdf`, `.doc/.docx`, `.xls/.xlsx`, `.ppt/.pptx`, `.odt`
- Rate limiting infrastructure: `checkRateLimit()` pure function

**Test Infrastructure (Phase 3)**
- 491 tests total (477 unit + 14 integration), all passing
- vitest v4.1.4 with TypeScript support
- 17 unit test files covering security, URL normalization, scoring, llms parsing, routing, dates, markdown, content extraction, search parsing, browser rotation, rate limiting, structured content, relative URLs, regression
- 8 HTML search fixtures (Yahoo, Marginalia, Ask, DuckDuckGo, Google, Bing)
- GLM-5-Turbo integration tests via Z.AI coding endpoint

**DevEx (Phase 7)**
- `docs/multi-browser-design.md`: Full multi-browser architecture document
- `docs/phase1-implementation-plan.md`: Detailed refactoring roadmap
- `DEVELOPMENT_PLAN.md`: 8-phase improvement plan with progress tracking
- `AGENTS.md`: Project overview for AI agents

### Changed
- `index.ts`: 1333 → 508 lines (god-module eliminated)
- `github_search`: Now tries multiple query variations (`z.ai` → zai, z-org, zai-org)
- `isUrlSafe()`: Substring matching replaced with segment-based matching
- `browser.ts`: Full rewrite with per-engine instances, concurrent-launch guards, crash recovery
- Unbounded `Map` caches replaced with `LRUCache` + `InflightMap`
- Sequential llms.txt/markdown fetching changed to parallel

### Fixed
- Browser crash leaving `this.browser` non-null (permanent server breakage)
- 8 tool handlers missing `try/finally` (10-30MB memory leak per error)
- Silent `page.goto` error swallowing
- `QUERY_STOP_WORDS` divergence between modules (24 vs 30 words)
- `normalizeTargetUrl` inconsistency (markdown strips search params, llms doesn't)
- False-positive blocked domains (`hackney.gov.uk`, `adultlearning.edu`)
- Routing score inflation (same-site bonus routing irrelevant pages)

## [0.2.0] - 2026-03-19

### Added
- **General Web Search**: Search the public web without API keys using multiple search engines (Yahoo, Marginalia, Ask.com)
- **Search + Browse**: Combined tool to search and automatically browse top results with content extraction
- **LLMS.txt Inspection**: New `inspect_llms_txt` tool to inspect and parse site llms.txt guidance files
- **LLMS.txt Aware Browsing**: Automatically reads llms.txt when available and includes guidance in browse output
- **Best Next Page Routing**: Query-intent based routing to the most relevant same-site page using llms.txt links
- **Markdown Fallback**: Tries .md page variants before falling back to HTML extraction for llms-aware sites
- **Result Quality Ranking**: Domain-aware scoring, snippet cleanup, freshness hints, deduplication, and optional llms.txt badges

### Changed
- Improved search result parsing with multi-engine support (Yahoo, Ask.com, Marginalia, Google, Bing, DuckDuckGo)
- Refined download blocking heuristics (block-list approach instead of allow-list)
- Relaxed TLD blocking (removed blanket blocks on .tk, .ml, .ga, .cf, .gq, .xyz)

## [0.1.0] - 2026-03-18

### Added
- Initial release
- Playwright-based MCP server for web browsing
- GitHub repository search and file listing
- Page browsing with content extraction
- SPA detection and handling
- Freshness control with date detection
- URL validation and security features

