# Phase 1: Architecture Refactoring — Implementation Plan

**Project**: FreeWeb MCP Server (`@mehmet/freeweb-mcp`)
**Target**: Refactor `src/index.ts` (1307 lines) into focused modules
**Constraint**: Zero breakage at every step — build must pass after each extraction

---

## 1. Function Extraction Map

### Legend
- **Target Module**: Where the function should live after refactoring
- **In lib.ts**: Whether the function already exists in `src/lib.ts` (exact duplicate)
- **Deps**: What the function imports/calls from other project modules

### Functions Currently in `index.ts` (lines 1–1307)

#### A. Security Functions

| Function | Lines | Target Module | In lib.ts | Internal Deps |
|----------|-------|---------------|-----------|---------------|
| `isUrlSafe()` | 25–47 | `security.ts` | Yes (L86–108) | `BLOCKED_DOMAINS` |
| `checkDownloadRequest()` | 49–59 | `security.ts` | Yes (L110–120) | `BLOCKED_DOWNLOAD_EXTENSIONS` |
| `checkDateFreshness()` | 61–71 | `dates.ts` | Yes (L122–132) | None |

#### B. Constants & Types

| Constant/Type | Lines | Target Module | In lib.ts |
|---------------|-------|---------------|-----------|
| `BLOCKED_DOMAINS` | 18–21 | `security.ts` | Yes (L4–7) |
| `BLOCKED_DOWNLOAD_EXTENSIONS` | 23 | `security.ts` | Yes (L9) |
| `TRUSTED_DOMAINS` | 123–139 | `constants.ts` | Yes (L11–27) |
| `LOW_QUALITY_DOMAINS` | 141–146 | `constants.ts` | Yes (L29–34) |
| `QUERY_STOP_WORDS` | 148–151 | `constants.ts` | Yes (L36–39) |
| `WEB_SEARCH_ENGINES` | 73 | `constants.ts` | Yes (L41) |
| `WebSearchEngine` (type) | 74 | `types.ts` | Yes (L42) |
| `WebSearchMode` (type) | 75 | `types.ts` | Yes (L43) |
| `SearchAttemptStatus` (type) | 76 | `types.ts` | Yes (L44) |
| `SearchAttempt` (interface) | 78–83 | `types.ts` | Yes (L46–51) |
| `WebSearchResult` (interface) | 85–95 | `types.ts` | Yes (L53–63) |
| `SearchCollection` (interface) | 97–100 | `types.ts` | No |
| `BrowsedSearchResult` (interface) | 102–114 | `types.ts` | Yes (L65–77) |
| `LlmsRouteDecision` (interface) | 116–121 | `types.ts` | Yes (L79–84) |
| `RESEARCH_POLICY` | 10 | `constants.ts` | No |

#### C. URL / Domain Utilities

| Function | Lines | Target Module | In lib.ts | Internal Deps |
|----------|-------|---------------|-----------|---------------|
| `normalizeDomainFilter()` | 153–161 | `url.ts` | Yes (L134–142) | None |
| `domainMatches()` | 163–166 | `url.ts` | Yes (L144–147) | None |
| `buildWebSearchUrl()` | 168–189 | `url.ts` | Yes (L149–170) | `normalizeDomainFilter` |
| `getWebSearchOrder()` | 191–194 | `url.ts` | Yes (L172–175) | `WEB_SEARCH_ENGINES` |
| `normalizeSearchResultUrl()` | 196–229 | `url.ts` | Yes (L177–210) | None |
| `normalizeComparableUrl()` | 231–239 | `url.ts` | Yes (L212–220) | None |
| `isSameSiteUrl()` | 241–249 | `url.ts` | Yes (L222–230) | `domainMatches` |
| `deriveRouteTargetUrl()` | 251–266 | `url.ts` | Yes (L232–247) | None |
| `isInternalSearchEngineUrl()` | 303–316 | `url.ts` | Yes (L284–297) | None |

#### D. Text Processing Utilities

| Function | Lines | Target Module | In lib.ts | Internal Deps |
|----------|-------|---------------|-----------|---------------|
| `cleanSearchText()` | 318–324 | `text.ts` | Yes (L299–305) | None |
| `escapeRegExp()` | 326–328 | `text.ts` | Yes (L307–309) | None |
| `cleanSearchSnippet()` | 330–342 | `text.ts` | Yes (L311–323) | `cleanSearchText`, `escapeRegExp` |
| `buildQueryTokens()` | 344–352 | `text.ts` | Yes (L325–333) | `QUERY_STOP_WORDS` |
| `countQueryHits()` | 354–357 | `text.ts` | Yes (L335–338) | None |

#### E. Date Utilities

| Function | Lines | Target Module | In lib.ts | Internal Deps |
|----------|-------|---------------|-----------|---------------|
| `extractDateHint()` | 359–397 | `dates.ts` | Yes (L340–378) | `cleanSearchText` |
| `formatDateForDisplay()` | 399–403 | `dates.ts` | Yes (L380–384) | None |

#### F. Scoring Functions

| Function | Lines | Target Module | In lib.ts | Internal Deps |
|----------|-------|---------------|-----------|---------------|
| `getDomainScore()` | 405–415 | `scoring.ts` | Yes (L386–396) | `LOW_QUALITY_DOMAINS`, `TRUSTED_DOMAINS`, `domainMatches` |
| `scoreSearchResult()` | 417–447 | `scoring.ts` | Yes (L398–428) | `buildQueryTokens`, `countQueryHits`, `getDomainScore`, `domainMatches`, `normalizeDomainFilter`, `extractDateHint`, `checkDateFreshness` |
| `mergeSearchResults()` | 449–460 | `scoring.ts` | Yes (L430–441) | None |
| `normalizeEngineResults()` | 462–500 | `scoring.ts` | No | `cleanSearchText`, `normalizeSearchResultUrl`, `cleanSearchSnippet`, `scoreSearchResult`, `isInternalSearchEngineUrl`, `isUrlSafe` |
| `formatAttemptSummary()` | 502–508 | `scoring.ts` | Yes (L443–449) | None |

#### G. Routing Functions

| Function | Lines | Target Module | In lib.ts | Internal Deps |
|----------|-------|---------------|-----------|---------------|
| `resolveLlmsRoute()` | 268–301 | `routing.ts` | Yes (L249–282) | `normalizeComparableUrl`, `findRelevantLlmsLinks`, `deriveRouteTargetUrl`, `isSameSiteUrl`, `isUrlSafe`, `checkDownloadRequest` |

#### H. Browse Pipeline Functions

| Function | Lines | Target Module | In lib.ts | Internal Deps |
|----------|-------|---------------|-----------|---------------|
| `detectSearchBlock()` | 510–524 | `browse.ts` | No | `browserManager` (Playwright Page) |
| `browseSearchResults()` | 626–706 | `browse.ts` | No | `genContextId`, `isUrlSafe`, `checkDownloadRequest`, `findLlmsTxt`, `resolveLlmsRoute`, `findMarkdownVersion`, `browserManager`, `extractContent`, `extractDate`, `checkDateFreshness` |

#### I. Search Orchestration Functions

| Function | Lines | Target Module | In lib.ts | Internal Deps |
|----------|-------|---------------|-----------|---------------|
| `collectWebSearchResults()` | 526–579 | `search.ts` | No | `genContextId`, `browserManager`, `buildWebSearchUrl`, `detectSearchBlock`, `parseSearchResults`, `normalizeEngineResults`, `mergeSearchResults`, `getWebSearchOrder` |
| `formatWebSearchResults()` | 581–601 | `search.ts` | No | `normalizeDomainFilter`, `formatDateForDisplay`, `formatAttemptSummary` |
| `enrichResultsWithLlms()` | 603–624 | `search.ts` | No | `findLlmsTxt` |

#### J. Tool Handlers (remain in index.ts, but slimmed)

| Tool | Lines | Target Module | Stays? | Delegated To |
|------|-------|---------------|--------|--------------|
| `github_search` | 708–794 | `index.ts` | Yes | Inline (unique logic) |
| `inspect_llms_txt` | 796–819 | `index.ts` | Yes | `isUrlSafe`, `findLlmsTxt`, `formatLlmsInspection` |
| `web_search` | 821–848 | `index.ts` | Yes | `collectWebSearchResults`, `enrichResultsWithLlms`, `formatWebSearchResults` |
| `search_and_browse` | 850–919 | `index.ts` | Yes | `collectWebSearchResults`, `browseSearchResults`, `formatWebSearchResults` |
| `browse_page` | 921–977 | `index.ts` | Yes | `browseUrl()` (new unified pipeline) |
| `smart_browse` | 979–1063 | `index.ts` | Yes | `browseUrl()` (new unified pipeline) |
| `deep_search` | 1065–1132 | `index.ts` | Yes | Inline (unique source iteration) |
| `github_repo_files` | 1134–1179 | `index.ts` | Yes | Inline (simple) |
| `parallel_browse` | 1181–1238 | `index.ts` | Yes | Inline (simple parallel) |
| `get_page_links` | 1240–1267 | `index.ts` | Yes | Inline (simple) |
| `screenshot` | 1269–1294 | `index.ts` | Yes | Inline (simple) |
| Server startup | 1296–1307 | `index.ts` | Yes | — |

### Summary: What's Already in lib.ts

`src/lib.ts` (449 lines) already contains **exact duplicates** of:
- All constants (`BLOCKED_DOMAINS`, `BLOCKED_DOWNLOAD_EXTENSIONS`, `TRUSTED_DOMAINS`, `LOW_QUALITY_DOMAINS`, `QUERY_STOP_WORDS`, `WEB_SEARCH_ENGINES`)
- All types (`WebSearchEngine`, `WebSearchMode`, `SearchAttemptStatus`, `SearchAttempt`, `WebSearchResult`, `BrowsedSearchResult`, `LlmsRouteDecision`)
- All pure utility functions (security, URL, text, scoring, routing)

**What's NOT in lib.ts** (still only in index.ts):
- `SearchCollection` interface (L97–100)
- `RESEARCH_POLICY` constant (L10)
- `normalizeEngineResults()` (L462–500)
- `detectSearchBlock()` (L510–524)
- `collectWebSearchResults()` (L526–579)
- `formatWebSearchResults()` (L581–601)
- `enrichResultsWithLlms()` (L603–624)
- `browseSearchResults()` (L626–706)
- All 11 tool handler registrations (L708–1307)

---

## 2. Import Dependency Graph

### Tier 0 — External-only (no internal deps)

```
constants.ts
  Imports: none
  Exports: RESEARCH_POLICY, TRUSTED_DOMAINS, LOW_QUALITY_DOMAINS,
           QUERY_STOP_WORDS, WEB_SEARCH_ENGINES

types.ts
  Imports: ./llms.js (LlmsDocument type only)
  Exports: WebSearchEngine, WebSearchMode, SearchAttemptStatus,
           SearchAttempt, WebSearchResult, SearchCollection,
           BrowsedSearchResult, LlmsRouteDecision,
           BrowseOptions, BrowseResult
```

### Tier 1 — Pure utilities (depend only on tier 0)

```
security.ts
  Imports: ./constants.js (BLOCKED_DOMAINS, BLOCKED_DOWNLOAD_EXTENSIONS)
  Exports: isUrlSafe, checkDownloadRequest

text.ts
  Imports: ./constants.js (QUERY_STOP_WORDS)
  Exports: cleanSearchText, escapeRegExp, cleanSearchSnippet,
           buildQueryTokens, countQueryHits

url.ts
  Imports: ./constants.js (WEB_SEARCH_ENGINES)
  Exports: normalizeDomainFilter, domainMatches, buildWebSearchUrl,
           getWebSearchOrder, normalizeSearchResultUrl,
           normalizeComparableUrl, isSameSiteUrl,
           deriveRouteTargetUrl, isInternalSearchEngineUrl

dates.ts
  Imports: ./text.js (cleanSearchText)
  Exports: checkDateFreshness, extractDateHint, formatDateForDisplay
```

### Tier 2 — Scoring & routing (depend on tier 0 + tier 1)

```
scoring.ts
  Imports: ./types.js (WebSearchResult, WebSearchEngine, SearchAttempt)
           ./text.js (buildQueryTokens, countQueryHits, cleanSearchText, cleanSearchSnippet)
           ./url.js (normalizeSearchResultUrl, normalizeDomainFilter, domainMatches, isInternalSearchEngineUrl)
           ./security.js (isUrlSafe)
           ./dates.js (extractDateHint, checkDateFreshness)
           ./constants.js (TRUSTED_DOMAINS, LOW_QUALITY_DOMAINS)
  Exports: getDomainScore, scoreSearchResult, mergeSearchResults,
           normalizeEngineResults, formatAttemptSummary

routing.ts
  Imports: ./types.js (LlmsRouteDecision)
           ./url.js (normalizeComparableUrl, deriveRouteTargetUrl, isSameSiteUrl)
           ./security.js (isUrlSafe, checkDownloadRequest)
           ./llms.js (findRelevantLlmsLinks)
  Exports: resolveLlmsRoute
```

### Tier 3 — Browse pipeline (stateful, depends on browser)

```
browse.ts
  Imports: ./types.js (BrowseOptions, BrowseResult, BrowsedSearchResult, WebSearchResult)
           ./security.js (isUrlSafe, checkDownloadRequest)
           ./url.js (normalizeComparableUrl)
           ./routing.js (resolveLlmsRoute)
           ./dates.js (checkDateFreshness)
           ./browser.js (browserManager)
           ./utils.js (extractContent, extractDate, extractLinks, genContextId)
           ./llms.js (findLlmsTxt)
           ./markdown.js (findMarkdownVersion)
  Exports: browseUrl, browseSearchResults, detectSearchBlock,
           withContext
```

### Tier 4 — Search orchestration

```
search.ts
  Imports: ./types.js (WebSearchResult, SearchCollection, SearchAttempt)
           ./url.js (buildWebSearchUrl, getWebSearchOrder)
           ./scoring.js (normalizeEngineResults, mergeSearchResults, formatAttemptSummary,
                         scoreSearchResult)
           ./browse.js (detectSearchBlock)
           ./llms.js (findLlmsTxt)
           ./browser.js (browserManager)
           ./utils.js (parseSearchResults, genContextId)
           ./dates.js (formatDateForDisplay)
           ./text.js (cleanSearchText)
           ./url.js (normalizeDomainFilter)
  Exports: collectWebSearchResults, formatWebSearchResults,
           enrichResultsWithLlms
```

### Tier 5 — Entry point (wiring only)

```
index.ts
  Imports: ./constants.js, ./types.js, ./security.js, ./browse.js,
           ./search.js, ./scoring.js, ./routing.js, ./dates.js
           + MCP SDK, zod
  Contains: 11 server.tool() registrations, server startup
```

### Visual Dependency DAG

```
constants.ts ──┐
types.ts ──────┤
               ├──> security.ts ──────────┐
               ├──> text.ts ────┐          │
               ├──> url.ts ─────┤          │
               │               │          │
               │    ┌──────────┴──┐       │
               │    │             │       │
               │    v             v       │
               │  dates.ts    scoring.ts──┤
               │                 │        │
               │    ┌────────────┤        │
               │    v            │        │
               │  routing.ts     │        │
               │    │            │        │
               │    v            v        │
               │  browse.ts ◄─── search.ts
               │    │            │
               │    v            v
               │    └─────► index.ts
               │
llms.ts ───────┤ (already extracted, no changes needed)
markdown.ts ───┤ (already extracted, no changes needed)
browser.ts ────┤ (already extracted, no changes needed)
utils.ts ──────┘ (already extracted, no changes needed)
```

---

## 3. Step-by-Step Migration Order

### Strategy

Each step produces a **compilable build**. After every step, run `npm run build` to verify. `lib.ts` serves as a staging area — it already has the duplicated pure functions. We'll rename/split `lib.ts` into the target modules, then update `index.ts` imports.

### Step 1: Create `types.ts` and `constants.ts`

**What moves:**
- From `lib.ts`: All type/interface definitions → `types.ts`
- From `lib.ts`: `RESEARCH_POLICY`, `TRUSTED_DOMAINS`, `LOW_QUALITY_DOMAINS`, `QUERY_STOP_WORDS`, `WEB_SEARCH_ENGINES` → `constants.ts`
- From `index.ts`: `RESEARCH_POLICY` (L10), `SearchCollection` interface (L97–100) → add to `types.ts`

**New files:**
```
src/types.ts      — all interfaces and type aliases
src/constants.ts  — all const values
```

**Import changes in `index.ts`:**
```diff
- const RESEARCH_POLICY = "CONTENT RESEARCH POLICY: ...";
+ import { RESEARCH_POLICY } from "./constants.js";
+ import type { SearchCollection, WebSearchResult, ... } from "./types.js";
```

**Import changes in `lib.ts`:**
```diff
- export const TRUSTED_DOMAINS = [...]
- export const QUERY_STOP_WORDS = ...
- ... (all constants and types)
+ import { TRUSTED_DOMAINS, ... } from "./constants.js";
+ import type { ... } from "./types.js";
  (keep all functions exporting from lib.ts for now)
```

**Verify:** `npm run build` — lib.ts re-exports from new modules, index.ts imports from new modules. No behavior change.

### Step 2: Create `security.ts`

**What moves:**
- From `lib.ts`: `BLOCKED_DOMAINS`, `BLOCKED_DOWNLOAD_EXTENSIONS`, `isUrlSafe()`, `checkDownloadRequest()` → `security.ts`

**New file:**
```
src/security.ts — URL safety checks, domain blocking, download detection
```

**Implementation:**
```typescript
// src/security.ts
import { BLOCKED_DOMAINS, BLOCKED_DOWNLOAD_EXTENSIONS } from "./constants.js";

export { BLOCKED_DOMAINS, BLOCKED_DOWNLOAD_EXTENSIONS };

export function isUrlSafe(url: string): { safe: boolean; reason?: string } {
  // ... exact copy from lib.ts L86–108
}

export function checkDownloadRequest(url: string): { allowed: boolean; warning?: string } {
  // ... exact copy from lib.ts L110–120
}
```

**Import changes in `index.ts`:**
```diff
- const BLOCKED_DOMAINS = [...]
- const BLOCKED_DOWNLOAD_EXTENSIONS = [...]
- function isUrlSafe(url) { ... }
- function checkDownloadRequest(url) { ... }
+ import { isUrlSafe, checkDownloadRequest } from "./security.js";
```

**Import changes in `lib.ts`:**
```diff
- export const BLOCKED_DOMAINS = [...]
- export const BLOCKED_DOWNLOAD_EXTENSIONS = [...]
- export function isUrlSafe(...)  { ... }
- export function checkDownloadRequest(...) { ... }
+ export { isUrlSafe, checkDownloadRequest, BLOCKED_DOMAINS, BLOCKED_DOWNLOAD_EXTENSIONS } from "./security.js";
```

**Verify:** `npm run build`

### Step 3: Create `text.ts`

**What moves:**
- From `lib.ts`: `cleanSearchText()`, `escapeRegExp()`, `cleanSearchSnippet()`, `buildQueryTokens()`, `countQueryHits()` → `text.ts`

**New file:**
```
src/text.ts — text cleaning, tokenization, snippet processing
```

**Import changes in `index.ts`:**
```diff
- function cleanSearchText(text) { ... }
- function escapeRegExp(text) { ... }
- function cleanSearchSnippet(snippet, title) { ... }
- function buildQueryTokens(query) { ... }
- function countQueryHits(text, tokens) { ... }
+ import { cleanSearchText, escapeRegExp, cleanSearchSnippet, buildQueryTokens, countQueryHits } from "./text.js";
```

**Verify:** `npm run build`

### Step 4: Create `url.ts`

**What moves:**
- From `lib.ts`: `normalizeDomainFilter()`, `domainMatches()`, `buildWebSearchUrl()`, `getWebSearchOrder()`, `normalizeSearchResultUrl()`, `normalizeComparableUrl()`, `isSameSiteUrl()`, `deriveRouteTargetUrl()`, `isInternalSearchEngineUrl()` → `url.ts`

**New file:**
```
src/url.ts — URL normalization, domain matching, search URL building
```

**Import changes in `index.ts`:**
```diff
- function normalizeDomainFilter(domain) { ... }
- function domainMatches(host, domain) { ... }
- function buildWebSearchUrl(query, engine, domain) { ... }
- ... (all 9 URL functions)
+ import { normalizeDomainFilter, domainMatches, buildWebSearchUrl, ... } from "./url.js";
```

**Verify:** `npm run build`

### Step 5: Create `dates.ts`

**What moves:**
- From `lib.ts`: `checkDateFreshness()`, `extractDateHint()`, `formatDateForDisplay()` → `dates.ts`
- Depends on: `text.ts` (for `cleanSearchText`)

**New file:**
```
src/dates.ts — date parsing, freshness checking, formatting
```

**Import changes in `index.ts`:**
```diff
- function checkDateFreshness(dateStr, maxAgeMonths) { ... }
- function extractDateHint(text) { ... }
- function formatDateForDisplay(dateStr) { ... }
+ import { checkDateFreshness, extractDateHint, formatDateForDisplay } from "./dates.js";
```

**Verify:** `npm run build`

### Step 6: Create `scoring.ts`

**What moves:**
- From `lib.ts`: `getDomainScore()`, `scoreSearchResult()`, `mergeSearchResults()`, `formatAttemptSummary()` → `scoring.ts`
- From `index.ts`: `normalizeEngineResults()` (L462–500) → `scoring.ts`

**New file:**
```
src/scoring.ts — domain scoring, result scoring, normalization, merging
```

**Dependencies:** `text.ts`, `url.ts`, `security.ts`, `dates.ts`, `constants.ts`, `types.ts`

**Import changes in `index.ts`:**
```diff
- function getDomainScore(host) { ... }
- function scoreSearchResult(query, result, domain, maxAgeMonths) { ... }
- function mergeSearchResults(existing, incoming) { ... }
- function normalizeEngineResults(query, rawResults, engine, domain, maxAgeMonths) { ... }
- function formatAttemptSummary(attempts) { ... }
+ import { getDomainScore, scoreSearchResult, mergeSearchResults, normalizeEngineResults, formatAttemptSummary } from "./scoring.js";
```

**Verify:** `npm run build`

### Step 7: Create `routing.ts`

**What moves:**
- From `lib.ts`: `resolveLlmsRoute()` → `routing.ts`

**New file:**
```
src/routing.ts — llms.txt-based URL routing
```

**Dependencies:** `url.ts`, `security.ts`, `llms.ts`

**Import changes in `index.ts`:**
```diff
- function resolveLlmsRoute(url, llms, query, followLlmsLinks) { ... }
+ import { resolveLlmsRoute } from "./routing.js";
```

**Verify:** `npm run build`

### Step 8: Create `browse.ts` (the unified browse pipeline)

**What moves:**
- From `index.ts`: `detectSearchBlock()` (L510–524), `browseSearchResults()` (L626–706) → `browse.ts`
- New: `browseUrl()` function, `withContext()` helper

**New file:**
```
src/browse.ts — unified browse pipeline, withContext helper, browseSearchResults
```

**This is the biggest single step.** See Section 4 for `browseUrl()` design.

**Import changes in `index.ts`:**
```diff
- async function detectSearchBlock(page) { ... }
- async function browseSearchResults(results, browseTop, excerptChars, maxAgeMonths, query, followLlmsLinks) { ... }
+ import { browseUrl, browseSearchResults, detectSearchBlock, withContext } from "./browse.js";
```

**Verify:** `npm run build` + manual smoke test of `browse_page`, `smart_browse`, and `search_and_browse`

### Step 9: Create `search.ts`

**What moves:**
- From `index.ts`: `collectWebSearchResults()` (L526–579), `formatWebSearchResults()` (L581–601), `enrichResultsWithLlms()` (L603–624) → `search.ts`

**New file:**
```
src/search.ts — search orchestration, result formatting, llms enrichment
```

**Import changes in `index.ts`:**
```diff
- async function collectWebSearchResults(query, engine, domain, maxResults, maxAgeMonths) { ... }
- function formatWebSearchResults(query, results, attempts, maxResults, domain) { ... }
- async function enrichResultsWithLlms(results, probeCount) { ... }
+ import { collectWebSearchResults, formatWebSearchResults, enrichResultsWithLlms } from "./search.js";
```

**Verify:** `npm run build` + manual smoke test of `web_search`, `search_and_browse`

### Step 10: Delete `lib.ts`

At this point, `lib.ts` is just a re-export barrel. Replace it with a short barrel file or delete it entirely.

- Move any remaining re-exports into the consuming modules
- Update any test files that import from `./lib.js`
- Delete `lib.ts`

**Verify:** `npm run build` + `npm test`

### Step 11: Final cleanup

- Verify `index.ts` is under ~500 lines (server setup + 11 tool handlers)
- Ensure no circular imports exist
- Run full test suite
- Spot-check all 11 tools via MCP client

---

## 4. `browseUrl()` Pipeline Design

### Core Abstraction

The three browse tools (`browse_page`, `smart_browse`, and the inner loop of `browseSearchResults`) share a common pattern:

1. Check URL safety
2. Check download request
3. Fetch llms.txt
4. Resolve llms route
5. Fetch markdown fallback
6. Open browser context
7. Navigate to URL
8. Optionally detect SPA and wait
9. Extract content
10. Extract date
11. Close context
12. Format output

The unified pipeline extracts steps 1–11 into a single function.

### Type Definitions (in `types.ts`)

```typescript
export interface BrowseOptions {
  url: string;
  query?: string;
  followLlmsLinks?: boolean;
  checkFreshness?: boolean;
  maxAgeMonths?: number;
  maxContentLength?: number;
  waitFor?: "domcontentloaded" | "load" | "networkidle";
  detectSpa?: boolean;
  spaTimeout?: number;
  staticTimeout?: number;
  extractLinks?: boolean;
}

export interface BrowseResult {
  url: string;
  finalUrl: string;
  title: string;
  content: string;
  date?: string;
  dateWarning?: string;
  isFresh: boolean;
  llms: LlmsDocument | null;
  markdownUrl?: string;
  contentSource: "html" | "markdown";
  routedByLlms: boolean;
  routedFromUrl?: string;
  routedReason?: string;
  isSpa: boolean;
  links?: { text: string; href: string }[];
}
```

### Implementation (in `browse.ts`)

```typescript
import type { Page } from "playwright";
import { browserManager } from "./browser.js";
import { genContextId, extractContent, extractDate, extractLinks } from "./utils.js";
import { isUrlSafe, checkDownloadRequest } from "./security.js";
import { resolveLlmsRoute } from "./routing.js";
import { checkDateFreshness } from "./dates.js";
import { findLlmsTxt } from "./llms.js";
import { findMarkdownVersion } from "./markdown.js";
import type { BrowseOptions, BrowseResult } from "./types.js";

export async function withContext<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const ctxId = genContextId();
  try {
    const page = await browserManager.openPage(ctxId);
    return await fn(page);
  } finally {
    await browserManager.closeContext(ctxId);
  }
}

export async function browseUrl(options: BrowseOptions): Promise<BrowseResult> {
  const {
    url,
    query,
    followLlmsLinks = true,
    checkFreshness = true,
    maxAgeMonths = 24,
    maxContentLength = 15000,
    waitFor = "domcontentloaded",
    detectSpa = false,
    spaTimeout = 4000,
    staticTimeout = 2500,
    extractLinks: shouldExtractLinks = false,
  } = options;

  const llms = await findLlmsTxt(url);
  const route = resolveLlmsRoute(url, llms, query, followLlmsLinks);
  const activeUrl = route.targetUrl;
  const markdown = llms ? await findMarkdownVersion(activeUrl) : null;

  return withContext(async (page) => {
    await page.goto(activeUrl, { waitUntil: waitFor, timeout: 60000 }).catch(() => {});

    let isSpa = false;
    if (detectSpa) {
      isSpa = await page.evaluate(() => {
        return window.location.hash.length > 0
          || !!document.querySelector("[data-reactroot], [data-v-app], #__next, #app");
      }).catch(() => false);

      if (isSpa) {
        await page.waitForTimeout(spaTimeout);
        await page.waitForSelector("main, article, .content, [role='main']", { timeout: 10000 }).catch(() => {});
      } else {
        await page.waitForTimeout(staticTimeout);
      }
    } else {
      await page.waitForTimeout(staticTimeout);
    }

    const content = await extractContent(page);
    const pageDate = await extractDate(page);
    const finalUrl = page.url();

    const links = shouldExtractLinks ? await extractLinks(page) : undefined;

    const preferredTitle = markdown?.title || content.title;
    const preferredText = markdown?.content || content.text;
    const truncated = maxContentLength < preferredText.length
      ? preferredText.slice(0, maxContentLength)
      : preferredText;

    let dateWarning = "";
    let isFresh = true;
    if (pageDate && checkFreshness) {
      const dateCheck = checkDateFreshness(pageDate, maxAgeMonths);
      isFresh = dateCheck.isFresh;
      dateWarning = dateCheck.warning;
    }

    return {
      url,
      finalUrl,
      title: preferredTitle,
      content: truncated,
      date: pageDate,
      dateWarning,
      isFresh,
      llms,
      markdownUrl: markdown?.sourceUrl,
      contentSource: markdown ? "markdown" as const : "html" as const,
      routedByLlms: route.routed,
      routedFromUrl: route.routed ? route.requestUrl : undefined,
      routedReason: route.reason,
      isSpa,
      links,
    } satisfies BrowseResult;
  });
}
```

### How Each Tool Calls `browseUrl()`

#### `browse_page` tool (currently L932–976)

```typescript
// Before: 46 lines of inline browsing logic
// After:
server.tool("browse_page", ..., async ({ url, query, followLlmsLinks, waitFor, warnIfOlderThanMonths }) => {
  const safety = isUrlSafe(url);
  if (!safety.safe) return { content: [{ type: "text" as const, text: `🔒 SECURITY: ${safety.reason}` }] };

  const download = checkDownloadRequest(url);
  if (!download.allowed) return { content: [{ type: "text" as const, text: download.warning || "" }] };

  const result = await browseUrl({
    url,
    query,
    followLlmsLinks,
    maxAgeMonths: warnIfOlderThanMonths,
    maxContentLength: 15000,
    waitFor,
    detectSpa: false,
    staticTimeout: 3000,
  });

  const routeInfo = result.routedByLlms
    ? `\nLLMS route: ${result.routedFromUrl} → ${result.finalUrl}${result.routedReason ? `\nRoute reason: ${result.routedReason}` : ""}`
    : "";
  const dateInfo = result.date ? `\n📅 ${new Date(result.date).toLocaleDateString("en-US")}` : "";
  const dateWarning = result.dateWarning ? `\n\n${result.dateWarning}` : "";
  const contentSourceInfo = result.markdownUrl ? `\nContent source: Markdown fallback (${result.markdownUrl})` : "";
  const llmsSection = result.llms
    ? `${formatLlmsGuidance(result.llms, { headingLevel: 2, maxSections: 3, maxNotesPerSection: 2, maxLinksPerSection: 3, query, maxRelevantLinks: 3 })}\n\n---\n\n`
    : "";

  return {
    content: [{
      type: "text" as const,
      text: `# ${result.title}\n\nURL: ${result.finalUrl}${routeInfo}${dateInfo}${contentSourceInfo}${dateWarning}\n\n${llmsSection}${result.content}`,
    }],
  };
});
```

#### `smart_browse` tool (currently L990–1063)

```typescript
// Before: 74 lines with duplicated browsing logic
// After:
server.tool("smart_browse", ..., async ({ url, query, followLlmsLinks, requireFreshContent, maxAgeMonths }) => {
  const safety = isUrlSafe(url);
  if (!safety.safe) return { content: [{ type: "text" as const, text: `🔒 SECURITY: ${safety.reason}` }] };

  const download = checkDownloadRequest(url);
  if (!download.allowed) return { content: [{ type: "text" as const, text: download.warning || "" }] };

  const result = await browseUrl({
    url,
    query,
    followLlmsLinks,
    checkFreshness: true,
    maxAgeMonths,
    maxContentLength: 12000,
    waitFor: "domcontentloaded",
    detectSpa: true,
    spaTimeout: 4000,
    staticTimeout: 2000,
    extractLinks: true,
  });

  let output = `# ${result.title}\n\nURL: ${result.finalUrl}`;
  if (result.isSpa) output += ` (SPA)`;
  if (result.routedByLlms) {
    output += `\nLLMS route: ${result.routedFromUrl} → ${result.finalUrl}`;
    if (result.routedReason) output += `\nRoute reason: ${result.routedReason}`;
  }
  if (result.date) output += `\n📅 ${new Date(result.date).toLocaleDateString("en-US")}`;
  if (result.markdownUrl) output += `\nContent source: Markdown fallback (${result.markdownUrl})`;
  if (result.dateWarning) {
    output += `\n\n${result.dateWarning}`;
    if (requireFreshContent && !result.isFresh) output += "\n\n⚠️ FRESH CONTENT REQUIRED!";
  }
  if (result.llms) {
    output += `\n\n---\n\n${formatLlmsGuidance(result.llms, { headingLevel: 2, maxSections: 3, maxNotesPerSection: 2, maxLinksPerSection: 3, query, maxRelevantLinks: 3 })}`;
  }
  output += `\n\n---\n\n${result.content}`;

  if (result.links && result.links.length > 0) {
    output += `\n\n---\n\n## Links (${result.links.length})\n`;
    output += result.links.slice(0, 15).map((l) => `- [${l.text}](${l.href})`).join("\n");
  }

  return { content: [{ type: "text" as const, text: output }] };
});
```

#### `browseSearchResults()` inner loop (currently L626–706)

```typescript
// The function still manages its own context (parallel browsing within one context),
// but each individual page browse is simplified:

export async function browseSearchResults(
  results: WebSearchResult[],
  browseTop: number,
  excerptChars: number,
  maxAgeMonths: number,
  query?: string,
  followLlmsLinks = true,
): Promise<BrowsedSearchResult[]> {
  const safeResults = results
    .filter((result) => isUrlSafe(result.url).safe)
    .filter((result) => checkDownloadRequest(result.url).allowed)
    .slice(0, browseTop);

  // NOTE: browseSearchResults uses its OWN context (parallel pages in one context),
  // not withContext(). This is intentional — it opens multiple pages concurrently.
  const ctxId = genContextId();

  try {
    const browsed = await Promise.all(safeResults.map(async (result) => {
      const llms = result.llms ?? await findLlmsTxt(result.url);
      const route = resolveLlmsRoute(result.url, llms, query, followLlmsLinks);
      const activeUrl = route.targetUrl;
      const markdown = llms ? await findMarkdownVersion(activeUrl) : null;
      const page = await browserManager.openPage(ctxId);

      try {
        await page.goto(activeUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});

        const isSPA = await page.evaluate(() => {
          return window.location.hash.length > 0
            || !!document.querySelector("[data-reactroot], [data-v-app], #__next, #app");
        }).catch(() => false);

        if (isSPA) {
          await page.waitForTimeout(4000);
          await page.waitForSelector("main, article, .content, [role='main']", { timeout: 10000 }).catch(() => {});
        } else {
          await page.waitForTimeout(2500);
        }

        const content = await extractContent(page);
        const pageDate = await extractDate(page);
        const finalUrl = page.url();
        const freshnessWarning = pageDate
          ? checkDateFreshness(pageDate, maxAgeMonths).warning
          : result.freshnessWarning;
        const excerpt = (markdown?.content || content.text).slice(0, excerptChars);

        return {
          ...result,
          finalUrl,
          pageTitle: markdown?.title || content.title || result.title,
          excerpt,
          pageDate,
          freshnessWarning,
          browseError: undefined,
          llms,
          markdownUrl: markdown?.sourceUrl,
          contentSource: markdown ? "markdown" as const : "html" as const,
          routedByLlms: route.routed,
          routedFromUrl: route.routed ? route.requestUrl : undefined,
          routedReason: route.reason,
        } satisfies BrowsedSearchResult;
      } catch (error) {
        return {
          ...result,
          finalUrl: activeUrl,
          pageTitle: result.title,
          excerpt: markdown?.content.slice(0, excerptChars) || "",
          browseError: error instanceof Error ? error.message : "Unknown browse error",
          llms,
          markdownUrl: markdown?.sourceUrl,
          contentSource: markdown ? "markdown" as const : "html" as const,
          routedByLlms: route.routed,
          routedFromUrl: route.routed ? route.requestUrl : undefined,
          routedReason: route.reason,
        } satisfies BrowsedSearchResult;
      } finally {
        await page.close().catch(() => {});
      }
    }));

    return browsed.filter((r) => r.excerpt || !r.browseError);
  } finally {
    await browserManager.closeContext(ctxId);
  }
}
```

**Note:** `browseSearchResults()` does NOT use `browseUrl()` because it needs to manage multiple pages in a single browser context (for parallelism). However, the SPA detection and content extraction pattern is identical. A future Phase 2 could further unify by having `browseUrl` accept an existing page.

---

## 5. `withContext()` Helper Design

### Purpose

Replace the repeated `genContextId()` / `openPage()` / `closeContext()` pattern used in 8+ tool handlers.

### Current Pattern (repeated 8 times in index.ts)

```typescript
const ctxId = genContextId();
const page = await browserManager.openPage(ctxId);
try {
  // ... work with page ...
} finally {
  await browserManager.closeContext(ctxId);
}
```

### Proposed Helper

```typescript
// src/browse.ts
import type { Page } from "playwright";
import { browserManager } from "./browser.js";
import { genContextId } from "./utils.js";

export async function withContext<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const ctxId = genContextId();
  try {
    const page = await browserManager.openPage(ctxId);
    return await fn(page);
  } finally {
    await browserManager.closeContext(ctxId);
  }
}
```

### Usage in Tool Handlers

**Before (e.g., `get_page_links`, L1253–1266):**
```typescript
const ctxId = genContextId();
const page = await browserManager.openPage(ctxId);
await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2000);
const links = await extractLinks(page);
await browserManager.closeContext(ctxId);
```

**After:**
```typescript
const links = await withContext(async (page) => {
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2000);
  return extractLinks(page);
});
```

### Tools That Would Use `withContext()`

| Tool | Lines Saved | Note |
|------|-------------|------|
| `github_search` | ~3 | Simple open/close |
| `browse_page` | ~5 | Replaced by `browseUrl()` |
| `smart_browse` | ~5 | Replaced by `browseUrl()` |
| `deep_search` | ~4 | Uses sequential pages in one context |
| `github_repo_files` | ~3 | Simple open/close |
| `get_page_links` | ~3 | Simple open/close |
| `screenshot` | ~3 | Simple open/close |

**Caution for `parallel_browse` (L1181–1238):** This tool opens **multiple pages** in one context. It cannot use `withContext()` as-is. Keep manual context management there, or extend the helper:

```typescript
// Possible future extension for multi-page contexts
export async function withMultiContext<T>(fn: (openPage: () => Promise<Page>) => Promise<T>): Promise<T> {
  const ctxId = genContextId();
  try {
    return await fn(() => browserManager.openPage(ctxId));
  } finally {
    await browserManager.closeContext(ctxId);
  }
}
```

---

## 6. Risk Assessment

### 6.1 Circular Dependency Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `scoring.ts` ↔ `url.ts` | Low | `scoring.ts` imports from `url.ts` but not vice versa. No cycle. |
| `routing.ts` ↔ `security.ts` | Low | `routing.ts` imports `isUrlSafe`/`checkDownloadRequest` from `security.ts`. No reverse dependency. |
| `browse.ts` ↔ `search.ts` | **Medium** | `search.ts` needs `detectSearchBlock()` from `browse.ts`. `browse.ts` needs nothing from `search.ts`. One-way. But verify carefully. |
| `types.ts` ↔ any module | Low | `types.ts` only imports `LlmsDocument` from `llms.ts` (type-only). All other modules import from `types.ts`. No cycle. |

**Verdict:** No circular dependencies in the proposed design. The DAG is clean.

### 6.2 Shared Mutable State

| State | Location | Risk |
|-------|----------|------|
| `browserManager` singleton | `browser.ts` | **Low** — singleton pattern, already module-scoped. Multiple modules importing it is safe. |
| `counter` in `genContextId()` | `utils.ts:324` | **Low** — module-scoped mutable counter. Already isolated. |
| `markdownCache`, `markdownInflight` | `markdown.ts` | **Low** — module-scoped Maps. Already isolated. |
| `llmsCache`, `llmsInflight`, `llmsTargetCache` | `llms.ts` | **Low** — module-scoped Maps. Already isolated. |

**Verdict:** No new shared mutable state is introduced. All existing mutable state is already properly encapsulated in their respective modules.

### 6.3 Type Compatibility Issues

| Issue | Severity | Detail |
|-------|----------|--------|
| `lib.ts` types vs `types.ts` types | **Medium** | If `lib.ts` is still imported anywhere after creating `types.ts`, consumers might get duplicate type definitions. Must ensure all imports switch to `types.ts`. Use TypeScript's `import type` to avoid runtime duplication. |
| `WebSearchResult.llms` field | Low | This field is `LlmsDocument \| null` — same type used in `types.ts` and `lib.ts`. No mismatch. |
| `BrowsedSearchResult` extends `WebSearchResult` | Low | The interface hierarchy is preserved exactly in `types.ts`. |
| `BrowseResult` vs `BrowsedSearchResult` | **Medium** | These are different types. `BrowseResult` is the new unified return type. `BrowsedSearchResult` is the search-specific result. They should coexist: `BrowsedSearchResult` extends `WebSearchResult` with browse data, while `BrowseResult` is a standalone type for single-page browse operations. Ensure tool handlers use the correct type. |
| Playwright `Page` type across modules | Low | All modules that use `Page` import from `"playwright"` directly. No indirection needed. |

### 6.4 Test Breakage Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Tests importing from `./lib.js` | **High** | Search codebase for `from "./lib"` or `from "../lib"`. Update all imports. If tests import specific functions, they need to switch to the new module paths. |
| Tests importing from `./index.js` | Medium | If any test imports types or functions from index.ts directly (unlikely given the current structure), those imports break. |
| Integration tests that test tool behavior | Low | Tool behavior doesn't change — same inputs/outputs. |
| `npm run build` catches import errors | Low | TypeScript will catch missing imports at compile time. This is the primary safety net. |

**Mitigation strategy for tests:**

```bash
# Before each step, check what imports lib.ts
grep -r "from.*lib" src/ tests/ --include="*.ts"
# After each step, run:
npm run build && npm test
```

### 6.5 Specific High-Risk Areas

#### A. `normalizeEngineResults()` — cross-cutting dependencies

This function (index.ts L462–500) touches:
- `cleanSearchText` (text.ts)
- `normalizeSearchResultUrl` (url.ts)
- `cleanSearchSnippet` (text.ts)
- `scoreSearchResult` (scoring.ts)
- `isInternalSearchEngineUrl` (url.ts)
- `isUrlSafe` (security.ts)

It's the most cross-cutting pure function. Moving it to `scoring.ts` is correct but requires importing from 4 other new modules. **Test this move carefully.**

#### B. `browseSearchResults()` — parallel page management

This function opens multiple pages in a single browser context for parallel browsing. It cannot use `withContext()` naively. The page-level error handling (try/catch per page, finally to close page) must be preserved exactly.

#### C. `search_and_browse` tool handler — complex orchestration

This handler (L850–919) calls `collectWebSearchResults`, then `browseSearchResults`, then formats output. It's the most complex tool. After refactoring, verify it with a manual smoke test.

#### D. The `RESEARCH_POLICY` string — used in tool descriptions

This string is embedded in tool descriptions (zod schema descriptions in `server.tool()` calls). It must be importable from `constants.ts` at module level. No issue, but verify the string appears correctly in MCP tool listings.

### 6.6 Build Verification Checklist

After each step:

```bash
# 1. TypeScript compilation (catches import errors, type mismatches)
npm run build

# 2. Run existing tests
npm test

# 3. (If tests don't cover it) Manual smoke test checklist:
#    - [ ] web_search returns results
#    - [ ] browse_page visits a URL and extracts content
#    - [ ] smart_browse detects SPA pages
#    - [ ] search_and_browse returns browsed excerpts
#    - [ ] inspect_llms_txt finds and displays llms.txt
#    - [ ] github_search returns repos
#    - [ ] screenshot captures a page
#    - [ ] parallel_browse visits multiple URLs
#    - [ ] get_page_links extracts links
#    - [ ] deep_search searches multiple sources
#    - [ ] github_repo_files lists files
```

---

## Appendix A: Final Module Sizes (Estimated)

| Module | Est. Lines | Responsibility |
|--------|-----------|----------------|
| `types.ts` | ~80 | All interfaces and type aliases |
| `constants.ts` | ~30 | All const values |
| `security.ts` | ~40 | URL safety, domain blocking |
| `text.ts` | ~45 | Text cleaning, tokenization |
| `url.ts` | ~110 | URL normalization, domain matching |
| `dates.ts` | ~60 | Date parsing, freshness checking |
| `scoring.ts` | ~100 | Domain scoring, result scoring, normalization |
| `routing.ts` | ~45 | llms.txt URL routing |
| `browse.ts` | ~150 | Unified browse pipeline, withContext, browseSearchResults |
| `search.ts` | ~120 | Search orchestration, formatting, enrichment |
| `index.ts` | ~450 | MCP server setup + 11 tool handlers |
| `browser.ts` | 199 | (unchanged) Browser lifecycle |
| `utils.ts` | 327 | (unchanged) Content extraction, link extraction |
| `llms.ts` | 458 | (unchanged) llms.txt parsing |
| `markdown.ts` | 112 | (unchanged) Markdown fallback |
| ~~`lib.ts`~~ | ~~deleted~~ | Absorbed into new modules |

**Total:** ~2,126 lines (vs current ~2,400 across all files). Slight reduction from eliminating duplication.

## Appendix B: index.ts Import Block (Post-Refactoring)

```typescript
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { RESEARCH_POLICY } from "./constants.js";
import type {
  WebSearchEngine, WebSearchMode, WebSearchResult, SearchCollection,
  SearchAttempt, BrowsedSearchResult, LlmsRouteDecision,
} from "./types.js";
import { isUrlSafe, checkDownloadRequest } from "./security.js";
import { formatDateForDisplay } from "./dates.js";
import { normalizeDomainFilter } from "./url.js";
import { formatAttemptSummary } from "./scoring.js";
import { browseUrl, browseSearchResults, withContext } from "./browse.js";
import {
  collectWebSearchResults, formatWebSearchResults, enrichResultsWithLlms,
} from "./search.js";
import { browserManager } from "./browser.js";
import { extractContent, extractDate, extractLinks, genContextId } from "./utils.js";
import { findLlmsTxt, formatLlmsGuidance, formatLlmsInspection } from "./llms.js";
import { checkDateFreshness } from "./dates.js";
```

## Appendix C: File Creation Order

Execute steps in this order. Each step is independently compilable.

| Step | Action | New File | index.ts Δ |
|------|--------|----------|------------|
| 1a | Create `types.ts` with all interfaces | `src/types.ts` | Remove type defs, import from types |
| 1b | Create `constants.ts` with all const values | `src/constants.ts` | Remove const defs, import from constants |
| 2 | Create `security.ts` | `src/security.ts` | Remove 4 items, import from security |
| 3 | Create `text.ts` | `src/text.ts` | Remove 5 functions, import from text |
| 4 | Create `url.ts` | `src/url.ts` | Remove 9 functions, import from url |
| 5 | Create `dates.ts` | `src/dates.ts` | Remove 3 functions, import from dates |
| 6 | Create `scoring.ts` | `src/scoring.ts` | Remove 5 functions, import from scoring |
| 7 | Create `routing.ts` | `src/routing.ts` | Remove 1 function, import from routing |
| 8 | Create `browse.ts` | `src/browse.ts` | Remove 2 functions, import from browse |
| 9 | Create `search.ts` | `src/search.ts` | Remove 3 functions, import from search |
| 10 | Delete `lib.ts`, fix all imports | — | Remove lib.ts import |
| 11 | Refactor tool handlers to use `browseUrl()` and `withContext()` | — | Slim down handlers |
