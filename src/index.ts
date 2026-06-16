#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { RESEARCH_POLICY } from "./constants.js";
import type { WebSearchResult } from "./types.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { isUrlSafe, checkDownloadRequest, tagExternalContent } from "./security.js";
import { formatDateForDisplay } from "./dates.js";
import { normalizeDomainFilter } from "./url.js";
import { formatAttemptSummary } from "./scoring.js";
import { browseUrl, browseSearchResults, withContext } from "./browse.js";
import { fetchWithChainSoft } from "./fetcher/chain.js";
import {
  collectWebSearchResults, formatWebSearchResults, enrichResultsWithLlms,
} from "./search.js";
import { browserManager } from "./browser.js";
import { extractContent, extractLinks, extractDate, genContextId } from "./utils.js";
import { findLlmsTxt, formatLlmsGuidance, formatLlmsInspection } from "./llms.js";
import { checkDateFreshness } from "./dates.js";

const server = new McpServer({
  name: "freeweb",
  version: "1.0.0",
});

const READ_ONLY_OPEN_WORLD: ToolAnnotations = {
  readOnlyHint: true,
  openWorldHint: true,
};

function generateQueryVariations(query: string): string[] {
  const variations = [query];
  const cleaned = query.replace(/\./g, "").replace(/-/g, " ").trim();
  if (cleaned !== query) variations.push(cleaned);
  const noSpaces = query.replace(/\s+/g, "-").trim();
  if (noSpaces !== query) variations.push(noSpaces);
  const withHyphen = query.replace(/\./g, "-").trim();
  if (withHyphen !== query && !variations.includes(withHyphen)) variations.push(withHyphen);
  const orgStyle = query.replace(/\./g, "").replace(/\s+/g, "-").trim();
  if (orgStyle !== query && !variations.includes(orgStyle)) variations.push(orgStyle);
  if (query.includes(".")) {
    const parts = query.split(".");
    if (parts.length === 2) {
      const orgName = `${parts[0]}-org`;
      if (!variations.includes(orgName)) variations.push(orgName);
      const bare = parts[0];
      if (bare.length > 1 && !variations.includes(bare)) variations.push(bare);
    }
  }
  return [...new Set(variations)].slice(0, 5);
}

// ── TOOL: github_search ───────────────────────────────────────────
server.tool(
  "github_search",
  "Search GitHub repositories, code, or issues. Returns title, URL, description, stars, language, and last-updated date for each hit. Tries multiple query variations automatically (e.g. 'react hooks' → 'react-hooks', 'react-hooks') to improve recall.",
  {
    query: z.string().describe("Search term"),
    type: z.enum(["repos", "code", "issues"]).optional().default("repos"),
    maxResults: z.number().min(1).max(10).optional().default(5),
    sortByUpdated: z.boolean().optional().default(true),
  },
  READ_ONLY_OPEN_WORLD,
  async ({ query, type, maxResults, sortByUpdated }) => {
    const ctxId = genContextId();
    let results: { title: string; url: string; snippet: string; updatedAt: string; stars: string; language: string }[] = [];
    try {
    const page = await browserManager.openPage(ctxId);

    const queryVariations = generateQueryVariations(query);
    const sortParam = sortByUpdated ? "&s=updated&o=desc" : "";
    const typeParam = type === "repos" ? "repositories" : type;

    for (const q of queryVariations) {
      if (results.length >= maxResults) break;
      const url = `https://github.com/search?q=${encodeURIComponent(q)}&type=${typeParam}${sortParam}`;

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      await page.waitForSelector('[data-testid="results-list"], .repo-list-item, .search-title, [data-testid="search-result-title"]', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2000);

      const batch = await page.evaluate(() => {
        const items: { title: string; url: string; snippet: string; updatedAt: string; stars: string; language: string }[] = [];

        document.querySelectorAll('[data-testid="results-list"] > div').forEach((item) => {
          const titleEl = item.querySelector("a");
          const descEl = item.querySelector("p");
          const dateEl = item.querySelector("relative-time, time, [datetime]");
          const starsEl = item.querySelector('[data-testid="stars-count"], .starring-container span');
          const langEl = item.querySelector('[data-testid="language"], [itemprop="programmingLanguage"]');
          if (titleEl) {
            items.push({
              title: titleEl.textContent?.trim() || "",
              url: `https://github.com${titleEl.getAttribute("href") || ""}`,
              snippet: descEl?.textContent?.trim() || "",
              updatedAt: dateEl?.getAttribute("datetime") || "",
              stars: starsEl?.textContent?.trim() || "",
              language: langEl?.textContent?.trim() || "",
            });
          }
        });

        if (items.length === 0) {
          document.querySelectorAll(".repo-list-item").forEach((item) => {
            const titleEl = item.querySelector("a.v-align-middle");
            const descEl = item.querySelector("p.col-9");
            const dateEl = item.querySelector("relative-time");
            const starsEl = item.querySelector(".pl-2 span");
            const langEl = item.querySelector("[itemprop='programmingLanguage']");
            if (titleEl) {
              items.push({
                title: titleEl.textContent?.trim() || "",
                url: `https://github.com${titleEl.getAttribute("href") || ""}`,
                snippet: descEl?.textContent?.trim() || "",
                updatedAt: dateEl?.getAttribute("datetime") || "",
                stars: starsEl?.textContent?.trim() || "",
                language: langEl?.textContent?.trim() || "",
              });
            }
          });
        }
        return items;
      });

      results.push(...batch);
    }

    } finally {
    await browserManager.closeContext(ctxId);
    }

    const uniqueResults = results.filter((r, i, arr) => arr.findIndex((x) => x.url === r.url) === i);
    if (uniqueResults.length === 0) {
      return { content: [{ type: "text" as const, text: `No results found on GitHub for "${query}".` }] };
    }

    const formatted = uniqueResults.slice(0, maxResults).map((r, i) => {
      let line = `[${i + 1}] ${r.title}`;
      if (r.language) line += ` (${r.language})`;
      if (r.stars) line += ` ⭐ ${r.stars}`;
      if (r.updatedAt) {
        const dateCheck = checkDateFreshness(r.updatedAt, 12);
        line += `\n    📅 ${new Date(r.updatedAt).toLocaleDateString("en-US")}${dateCheck.warning ? " " + dateCheck.warning : ""}`;
      }
      line += `\n    URL: ${r.url}`;
      if (r.snippet) line += `\n    ${r.snippet.slice(0, 100)}`;
      return line;
    }).join("\n\n");

    return { content: [{ type: "text" as const, text: formatted }] };
  }
);

// ── TOOL: inspect_llms_txt ───────────────────────────────────────
server.tool(
  "inspect_llms_txt",
  "Fetch and parse a site's llms.txt file, showing its structured guidance (sections, links, notes). Use this to understand what a site recommends LLMs read, or to debug why browse_page routed to a particular page. Returns ranked links when a query is provided.",
  {
    url: z.string().url().describe("Any page or site URL"),
    query: z.string().optional().describe("Optional query to rank the most relevant llms.txt links"),
  },
  READ_ONLY_OPEN_WORLD,
  async ({ url, query }) => {
    const safety = isUrlSafe(url);
    if (!safety.safe) {
      return { content: [{ type: "text" as const, text: `🔒 SECURITY: ${safety.reason}` }] };
    }

    const llms = await findLlmsTxt(url);
    if (!llms) {
      return { content: [{ type: "text" as const, text: `No llms.txt found for ${url}` }] };
    }

    return {
      content: [{ type: "text" as const, text: formatLlmsInspection(url, llms, { query, maxSections: 12, maxNotesPerSection: 5, maxLinksPerSection: 8 }) }],
    };
  }
);

// ── TOOL: web_search ──────────────────────────────────────────────
server.tool(
  "web_search",
  `Search the public web without API keys. Tries engines in order (Yahoo primary, DuckDuckGo, Marginalia) and stops once enough results are found; uses fast native fetch() first and only launches a browser if an engine blocks the request. Returns deduplicated, ranked results with clean URLs (redirect/UTM params stripped). Set engine explicitly to target a specific source. ${RESEARCH_POLICY}`,
  {
    query: z.string().describe("Search term"),
    maxResults: z.number().min(1).max(10).optional().default(5),
    engine: z.enum(["auto", "yahoo", "duckduckgo", "marginalia", "ask"]).optional().default("auto"),
    domain: z.string().optional().describe("Optional domain filter, e.g. react.dev or github.com"),
    maxAgeMonths: z.number().optional().default(18),
    checkLlmsTxt: z.boolean().optional().default(false),
  },
  READ_ONLY_OPEN_WORLD,
  async ({ query, maxResults, engine, domain, maxAgeMonths, checkLlmsTxt }) => {
    const { results, attempts } = await collectWebSearchResults(query, engine, domain, maxResults, maxAgeMonths);

    if (results.length === 0) {
      return {
        content: [{ type: "text" as const, text: `No web results found for "${query}". Engines tried: ${formatAttemptSummary(attempts) || "none"}.` }],
      };
    }

    const enrichedResults = checkLlmsTxt ? await enrichResultsWithLlms(results, Math.min(results.length, maxResults + 2)) : results;

    return {
      content: [{ type: "text" as const, text: formatWebSearchResults(query, enrichedResults, attempts, maxResults, domain) }],
    };
  }
);

// ── TOOL: search_and_browse ───────────────────────────────────────
server.tool(
  "search_and_browse",
  `Search the web, then open and extract readable content from the top results in one call — combines web_search + browse_page. Use this when you want both the ranked result list AND the actual page text, without a separate browse step for each URL. ${RESEARCH_POLICY}`,
  {
    query: z.string().describe("Search term"),
    maxResults: z.number().min(1).max(10).optional().default(5),
    browseTop: z.number().min(1).max(5).optional().default(3),
    engine: z.enum(["auto", "yahoo", "duckduckgo", "marginalia", "ask"]).optional().default("auto"),
    domain: z.string().optional().describe("Optional domain filter, e.g. react.dev or github.com"),
    maxAgeMonths: z.number().optional().default(18),
    excerptChars: z.number().min(500).max(5000).optional().default(2200),
    followLlmsLinks: z.boolean().optional().default(true),
  },
  READ_ONLY_OPEN_WORLD,
  async ({ query, maxResults, browseTop, engine, domain, maxAgeMonths, excerptChars, followLlmsLinks }) => {
    const { results, attempts } = await collectWebSearchResults(query, engine, domain, maxResults, maxAgeMonths);

    if (results.length === 0) {
      return {
        content: [{ type: "text" as const, text: `No web results found for "${query}". Engines tried: ${formatAttemptSummary(attempts) || "none"}.` }],
      };
    }

    const browsed = await browseSearchResults(results, browseTop, excerptChars, maxAgeMonths, query, followLlmsLinks);
    if (browsed.length === 0) {
      return {
        content: [{ type: "text" as const, text: `${formatWebSearchResults(query, results, attempts, maxResults, domain)}\n\nNo browsable pages were retrieved from the top results.` }],
      };
    }

    const summaryResults = results.map((result) => browsed.find((item) => item.url === result.url) || result);
    const searchSummary = formatWebSearchResults(query, summaryResults, attempts, maxResults, domain);
    const detailSections = browsed.map((result, index) => {
      let section = `## ${index + 1}. ${result.pageTitle || result.title}`;
      section += `\nURL: ${result.finalUrl}`;
      section += `\nSource: ${result.engine}${result.llms ? " 🤖 LLMS.txt" : ""}`;
      if (result.routedByLlms && result.routedFromUrl) {
        section += `\nLLMS route: ${result.routedFromUrl} → ${result.finalUrl}`;
        if (result.routedReason) section += `\nRoute reason: ${result.routedReason}`;
      }
      if (result.contentSource === "markdown" && result.markdownUrl) {
        section += `\nContent source: Markdown fallback (${result.markdownUrl})`;
      }
      if (result.pageDate) {
        section += `\n📅 ${formatDateForDisplay(result.pageDate)}`;
        if (result.freshnessWarning) section += ` ${result.freshnessWarning}`;
      } else if (result.publishedDate) {
        section += `\n📅 ${formatDateForDisplay(result.publishedDate)}`;
        if (result.freshnessWarning) section += ` ${result.freshnessWarning}`;
      }
      if (result.snippet) section += `\nSearch snippet: ${result.snippet.slice(0, 220)}`;
      if (result.llms) {
        section += `\n\n${formatLlmsGuidance(result.llms, {
          headingLevel: 3,
          maxSections: 2,
          maxNotesPerSection: 2,
          maxLinksPerSection: 2,
          query,
          maxRelevantLinks: 3,
        })}`;
      }
      section += `\n\n${result.excerpt || "[No readable content extracted]"}`;
      return section;
    }).join("\n\n---\n\n");

    return {
      content: [{ type: "text" as const, text: tagExternalContent(`${searchSummary}\n\n---\n\n# Search & Browse\nBrowsed ${browsed.length} result(s).\n\n${detailSections}`) }],
    };
  }
);

// ── TOOL: browse_page ─────────────────────────────────────────────
server.tool(
  "browse_page",
  `Visit a URL and extract its readable content. Uses a 6-layer fetcher chain: tries fast fetchers first (GitHub raw ~43ms, RSS, static HTML ~400ms) and only falls back to a full browser (~3-5s) when a fast fetcher returns too little or clearly SPA content — so most pages return in under 1s WITHOUT a browser. Use this as the DEFAULT for reading a single page. If the site exposes an llms.txt, it is read first and the most relevant same-site page is routed to automatically. ${RESEARCH_POLICY}`,
  {
    url: z.string().url().describe("URL to fetch and extract content from"),
    query: z.string().optional().describe("Optional intent so llms.txt can route to a more relevant page"),
    followLlmsLinks: z.boolean().optional().default(true),
    waitFor: z.enum(["domcontentloaded", "load", "networkidle"]).optional().default("domcontentloaded"),
    warnIfOlderThanMonths: z.number().optional().default(24),
  },
  READ_ONLY_OPEN_WORLD,
  async ({ url, query, followLlmsLinks, waitFor, warnIfOlderThanMonths }) => {
    const safety = isUrlSafe(url);
    if (!safety.safe) {
      return { content: [{ type: "text" as const, text: `🔒 SECURITY: ${safety.reason}` }] };
    }

    const download = checkDownloadRequest(url);
    if (!download.allowed) {
      return { content: [{ type: "text" as const, text: download.warning || "" }] };
    }

    const result = await browseUrl({
      url,
      query,
      followLlmsLinks,
      waitFor,
      staticTimeout: 3000,
      maxContentLength: 15000,
      maxAgeMonths: warnIfOlderThanMonths,
    });

    const routeInfo = result.route.routed
      ? `\nLLMS route: ${result.route.requestUrl} → ${result.finalUrl}${result.route.reason ? `\nRoute reason: ${result.route.reason}` : ""}`
      : "";
    const dateInfo = result.date ? `\n📅 ${new Date(result.date).toLocaleDateString("en-US")}` : "";
    const dateWarning = result.dateWarning ? `\n\n${result.dateWarning}` : "";
    const contentSourceInfo = result.markdownUrl ? `\nContent source: Markdown fallback (${result.markdownUrl})` : "";
    const llmsSection = result.llms
      ? `${formatLlmsGuidance(result.llms, { headingLevel: 2, maxSections: 3, maxNotesPerSection: 2, maxLinksPerSection: 3, query, maxRelevantLinks: 3 })}\n\n---\n\n`
      : "";

    return { content: [{ type: "text" as const, text: tagExternalContent(`# ${result.title}\n\nURL: ${result.finalUrl}${routeInfo}${dateInfo}${contentSourceInfo}${dateWarning}\n\n${llmsSection}${result.content}`) }] };
  }
);

// ── TOOL: smart_browse ────────────────────────────────────────────
server.tool(
  "smart_browse",
  `Visit a URL with freshness validation and forced SPA handling. Like browse_page but: explicitly waits for JavaScript-rendered content (React/Vue/Next.js) to render, extracts the published date, and warns when content is older than maxAgeMonths. Use this PREFERENTIALLY over browse_page for sites you know are client-rendered SPAs (Twitter, dashboards, heavy JS apps) where browse_page's fast static fetcher may return only a stub. ${RESEARCH_POLICY}`,
  {
    url: z.string().url().describe("URL"),
    query: z.string().optional().describe("Optional intent so llms.txt can route to a more relevant page"),
    followLlmsLinks: z.boolean().optional().default(true),
    requireFreshContent: z.boolean().optional().default(true),
    maxAgeMonths: z.number().optional().default(12),
  },
  READ_ONLY_OPEN_WORLD,
  async ({ url, query, followLlmsLinks, requireFreshContent, maxAgeMonths }) => {
    const safety = isUrlSafe(url);
    if (!safety.safe) {
      return { content: [{ type: "text" as const, text: `🔒 SECURITY: ${safety.reason}` }] };
    }

    const download = checkDownloadRequest(url);
    if (!download.allowed) {
      return { content: [{ type: "text" as const, text: download.warning || "" }] };
    }

    const result = await browseUrl({
      url,
      query,
      followLlmsLinks,
      detectSpa: true,
      spaTimeout: 4000,
      staticTimeout: 2000,
      extractLinks: true,
      maxContentLength: 12000,
      maxAgeMonths,
    });

    let output = `# ${result.title}\n\nURL: ${result.finalUrl}`;
    if (result.isSpa) output += ` (SPA)`;
    if (result.route.routed) {
      output += `\nLLMS route: ${result.route.requestUrl} → ${result.finalUrl}`;
      if (result.route.reason) output += `\nRoute reason: ${result.route.reason}`;
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

    return { content: [{ type: "text" as const, text: tagExternalContent(output) }] };
  }
);

// ── TOOL: deep_search ─────────────────────────────────────────────
server.tool(
  "deep_search",
  `Search curated developer sources directly — GitHub repos, npm packages, MDN docs, devdocs — and extract fresh content from each. Prefer this over web_search when researching libraries/packages/APIs, since it pulls structured results from authoritative dev sources. ${RESEARCH_POLICY}`,
  {
    query: z.string().describe("Search term"),
    sources: z.array(z.enum(["github", "npm", "mdn", "devdocs"])).optional().default(["github", "npm", "mdn"]),
    maxAgeMonths: z.number().optional().default(12),
  },
  READ_ONLY_OPEN_WORLD,
  async ({ query, sources, maxAgeMonths }) => {
    const ctxId = genContextId();
    const results: { source: string; title: string; url: string; content: string; date?: string; isFresh: boolean }[] = [];

    const sourceUrls: Record<string, string[]> = {
      github: [`https://github.com/search?q=${encodeURIComponent(query)}&type=repositories&s=updated&o=desc`],
      npm: [`https://www.npmjs.com/search?q=${encodeURIComponent(query)}`],
      mdn: [`https://developer.mozilla.org/en-US/search?q=${encodeURIComponent(query)}`],
      devdocs: [`https://devdocs.io/#q=${encodeURIComponent(query)}`],
    };

    try {
    for (const source of sources) {
      const urls = sourceUrls[source];
      if (!urls) continue;

      for (const url of urls) {
        const safety = isUrlSafe(url);
        if (!safety.safe) continue;

        const chainResult = await fetchWithChainSoft(url, { maxContentLength: 1500, maxAgeMonths });

        if (chainResult && !chainResult.isSpa && chainResult.content.length > 100) {
          const dateCheck = checkDateFreshness(chainResult.date, maxAgeMonths);
          results.push({
            source,
            title: chainResult.title || source,
            url,
            content: chainResult.content,
            date: chainResult.date,
            isFresh: dateCheck.isFresh,
          });
          continue;
        }

        const page = await browserManager.openPage(ctxId);
        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 7000 }).catch(() => {});
          await page.waitForSelector("main, article, .content, [role='main'], body", { timeout: 5000 }).catch(() => {});

          const content = await extractContent(page);
          const pageDate = await extractDate(page);
          const dateCheck = checkDateFreshness(pageDate, maxAgeMonths);

          results.push({
            source,
            title: content.title || source,
            url,
            content: content.text.slice(0, 1500),
            date: pageDate,
            isFresh: dateCheck.isFresh,
          });
        } finally {
          await page.close().catch(() => {});
        }
      }
    }
    } finally {
    await browserManager.closeContext(ctxId);
    }

    const freshResults = results.filter((r) => r.isFresh);
    const oldResults = results.filter((r) => !r.isFresh);
    const sortedResults = [...freshResults, ...oldResults];

    const formatted = sortedResults.map((r, i) => {
      let line = `[${i + 1}] **${r.title}** (${r.source})`;
      if (r.date) {
        line += ` - 📅 ${new Date(r.date).toLocaleDateString("en-US")}`;
        if (!r.isFresh) line += " ⚠️ OLD";
      }
      line += `\n    URL: ${r.url}\n    ${r.content.slice(0, 300)}...`;
      return line;
    }).join("\n\n");

    return { content: [{ type: "text" as const, text: tagExternalContent(`# Deep Search: "${query}"\n${freshResults.length}/${results.length} sources fresh\n\n${formatted}`) }] };
  }
);

// ── TOOL: github_repo_files ───────────────────────────────────────
server.tool(
  "github_repo_files",
  "List the folders and files at a path in a GitHub repository (defaults to the repo root on the main branch). Use this to explore a repo's structure before reading specific files via browse_page.",
  {
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
    path: z.string().optional().default(""),
    branch: z.string().optional().default("main"),
  },
  READ_ONLY_OPEN_WORLD,
  async ({ owner, repo, path, branch }) => {
    const url = `https://github.com/${owner}/${repo}/tree/${branch}/${path}`;
    const files = await withContext(async (page) => {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 7000 }).catch(() => {});
      await page.waitForSelector('[data-testid="directory-row"], .react-directory-row, .js-navigation-item, [role="row"]', { timeout: 5000 }).catch(() => {});

      return page.evaluate(() => {
        const items: { name: string; type: string }[] = [];
        document.querySelectorAll('[data-testid="directory-row"], .react-directory-row, .js-navigation-item').forEach((row) => {
          const nameEl = row.querySelector("a");
          const isDir = row.querySelector('.octicon-file-directory, [aria-label="Directory"]');
          if (nameEl) {
            items.push({ name: nameEl.textContent?.trim() || "", type: isDir ? "dir" : "file" });
          }
        });
        return items;
      });
    });

    if (files.length === 0) {
      return { content: [{ type: "text" as const, text: `No files found: ${url}` }] };
    }

    const dirs = files.filter((f) => f.type === "dir");
    const fileList = files.filter((f) => f.type === "file");

    let output = `# ${owner}/${repo}/${path || ""}\n\n`;
    if (dirs.length > 0) output += `📁 Folders:\n${dirs.map((d) => `  ${d.name}/`).join("\n")}\n\n`;
    if (fileList.length > 0) output += `📄 Files:\n${fileList.map((f) => `  ${f.name}`).join("\n")}`;

    return { content: [{ type: "text" as const, text: output }] };
  }
);

// ── TOOL: parallel_browse ─────────────────────────────────────────
server.tool(
  "parallel_browse",
  "Visit up to 5 URLs concurrently and extract readable content from each in a single call — much faster than calling browse_page 5 times. Use this when you need to read several pages at once (e.g. comparing docs, gathering multiple search hits). Uses the same 6-layer fetcher chain per URL.",
  {
    urls: z.array(z.string().url()).min(1).max(5).describe("URLs (max 5)"),
  },
  READ_ONLY_OPEN_WORLD,
  async ({ urls }) => {
    const safeUrls: string[] = [];
    const blockedUrls: string[] = [];

    for (const url of urls) {
      const safety = isUrlSafe(url);
      const download = checkDownloadRequest(url);
      if (!safety.safe || !download.allowed) {
        blockedUrls.push(url);
      } else {
        safeUrls.push(url);
      }
    }

    if (safeUrls.length === 0) {
      return { content: [{ type: "text" as const, text: `🔒 All URLs blocked.\n${blockedUrls.join("\n")}` }] };
    }

    const ctxId = genContextId();
    let allResults: string[];
    try {

    const tasks = safeUrls.map(async (url) => {
      const chainResult = await fetchWithChainSoft(url, { maxContentLength: 4000 });

      if (chainResult && !chainResult.isSpa && chainResult.content.length > 200) {
        const dateCheck = checkDateFreshness(chainResult.date, 12);
        let output = `## ${chainResult.title}\nURL: ${chainResult.finalUrl}`;
        if (chainResult.date) {
          output += `\n📅 ${new Date(chainResult.date).toLocaleDateString("en-US")}`;
          if (!dateCheck.isFresh) output += " ⚠️ OLD";
        }
        output += `\nSource: ${chainResult.contentSource} (${chainResult.fetcherName}, ${chainResult.ms}ms)`;
        output += `\n\n${chainResult.content}`;
        return output;
      }

      const page = await browserManager.openPage(ctxId);
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 7000 }).catch(() => {});
        await page.waitForSelector("main, article, .content, [role='main'], body", { timeout: 5000 }).catch(() => {});

        const content = await extractContent(page);
        const pageDate = await extractDate(page);
        const dateCheck = checkDateFreshness(pageDate, 12);

        let output = `## ${content.title}\nURL: ${url}`;
        if (pageDate) {
          output += `\n📅 ${new Date(pageDate).toLocaleDateString("en-US")}`;
          if (!dateCheck.isFresh) output += " ⚠️ OLD";
        }
        output += `\n\n${content.text.slice(0, 4000)}`;
        return output;
      } finally {
        await page.close().catch(() => {});
      }
    });

    allResults = await Promise.all(tasks);
    } finally {
    await browserManager.closeContext(ctxId);
    }

    let output = allResults.join("\n\n---\n\n");
    if (blockedUrls.length > 0) {
      output += `\n\n---\n\n🔒 Blocked: ${blockedUrls.join(", ")}`;
    }

    return { content: [{ type: "text" as const, text: tagExternalContent(output) }] };
  }
);

// ── TOOL: get_page_links ──────────────────────────────────────────
server.tool(
  "get_page_links",
  "Extract all safe outbound links from a page (text + href), up to 100. Use this to discover what a page links to — e.g. finding related docs, source files, or navigation targets — without fetching full page content.",
  {
    url: z.string().url().describe("URL"),
  },
  READ_ONLY_OPEN_WORLD,
  async ({ url }) => {
    const safety = isUrlSafe(url);
    if (!safety.safe) {
      return { content: [{ type: "text" as const, text: `🔒 SECURITY: ${safety.reason}` }] };
    }

    const chainResult = await fetchWithChainSoft(url, { extractLinks: true, maxContentLength: 5000 });
    let links: { text: string; href: string }[];

    if (chainResult && chainResult.links && chainResult.links.length > 0) {
      links = chainResult.links;
    } else {
      links = await withContext(async (page) => {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 7000 }).catch(() => {});
        await page.waitForSelector("a[href]", { timeout: 5000 }).catch(() => {});
        return extractLinks(page);
      });
    }

    const safeLinks = links.filter(l => isUrlSafe(l.href).safe);
    const formatted = safeLinks.slice(0, 100).map((l, i) => `[${i + 1}] ${l.text}\n    ${l.href}`).join("\n");

    return { content: [{ type: "text" as const, text: formatted || "No links found." }] };
  }
);

// ── TOOL: screenshot ──────────────────────────────────────────────
server.tool(
  "screenshot",
  "Capture a page as a base64 PNG screenshot (optionally full-page). Use this when you need the VISUAL layout of a page rather than its text — e.g. UI review, debugging design, or reading content that doesn't extract well as text.",
  {
    url: z.string().url().describe("URL"),
    fullPage: z.boolean().optional().default(false),
  },
  READ_ONLY_OPEN_WORLD,
  async ({ url, fullPage }) => {
    const safety = isUrlSafe(url);
    if (!safety.safe) {
      return { content: [{ type: "text" as const, text: `🔒 SECURITY: ${safety.reason}` }] };
    }

    const buffer = await withContext(async (page) => {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 7000 }).catch(() => {});
      await page.waitForTimeout(1500);
      return page.screenshot({ fullPage, type: "png" });
    });

    return { content: [{ type: "image" as const, data: buffer.toString("base64"), mimeType: "image/png" }] };
  }
);

// ── SERVER START ──────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);

// ── GRACEFUL SHUTDOWN ──────────────────────────────────────────────
async function gracefulShutdown(signal: string) {
  await browserManager.close().catch(() => {});
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
