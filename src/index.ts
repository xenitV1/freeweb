#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { browserManager } from "./browser.js";
import { findLlmsTxt, findRelevantLlmsLinks, formatLlmsGuidance, formatLlmsInspection, type LlmsDocument } from "./llms.js";
import { findMarkdownVersion } from "./markdown.js";
import { extractContent, extractLinks, extractDate, genContextId, parseSearchResults } from "./utils.js";

const RESEARCH_POLICY = "CONTENT RESEARCH POLICY: This tool can research ANY publicly available content including PDFs, EPUBs, books, documentation, and web resources. NO legal restrictions on searches - only technical safety checks (malicious URLs, malware, phishing). Users handle their own copyright compliance.";

const server = new McpServer({
  name: "freeweb",
  version: "1.0.0",
});

// ── SECURITY ──────────────────────────────────────────────────────
const BLOCKED_DOMAINS = [
  "malware", "phishing", "spam", "scam", "hack", "crack", "warez", "pirate",
  "porn", "xxx", "adult", "sex",
];

const BLOCKED_DOWNLOAD_EXTENSIONS = [".zip", ".exe", ".dmg", ".pkg", ".msi", ".apk", ".ipa", ".tar", ".gz", ".tgz", ".rar", ".7z", ".bin", ".iso"];

function isUrlSafe(url: string): { safe: boolean; reason?: string } {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { safe: false, reason: `Unsafe protocol: ${parsed.protocol}` };
    }
    const hostname = parsed.hostname.toLowerCase();
    for (const blocked of BLOCKED_DOMAINS) {
      if (hostname.includes(blocked)) {
        return { safe: false, reason: `Blocked domain` };
      }
    }
    if (parsed.port && !["80", "443", "8080", "3000", "5000"].includes(parsed.port)) {
      return { safe: false, reason: `Suspicious port` };
    }
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      return { safe: false, reason: "IP address not allowed" };
    }
    return { safe: true };
  } catch {
    return { safe: false, reason: "Invalid URL" };
  }
}

function checkDownloadRequest(url: string): { allowed: boolean; warning?: string } {
  const parsed = new URL(url);
  const pathname = parsed.pathname.toLowerCase();
  const isDownload = pathname.includes("/download/") ||
                     pathname.includes("/releases/download/") ||
                     BLOCKED_DOWNLOAD_EXTENSIONS.some(ext => pathname.endsWith(ext));
  if (isDownload) {
    return { allowed: false, warning: `⚠️ Download link - user permission required` };
  }
  return { allowed: true };
}

function checkDateFreshness(dateStr: string | undefined, maxAgeMonths = 24): { isFresh: boolean; warning: string } {
  if (!dateStr) return { isFresh: true, warning: "" };
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return { isFresh: true, warning: "" };
  const now = new Date();
  const ageMonths = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
  if (ageMonths > maxAgeMonths) {
    return { isFresh: false, warning: `⚠️ OLD: ${ageMonths} months ago (${date.toLocaleDateString("en-US")})` };
  }
  return { isFresh: true, warning: "" };
}

const WEB_SEARCH_ENGINES = ["yahoo", "marginalia", "ask"] as const;
type WebSearchEngine = typeof WEB_SEARCH_ENGINES[number];
type WebSearchMode = "auto" | WebSearchEngine;
type SearchAttemptStatus = "ok" | "blocked" | "empty";

interface SearchAttempt {
  engine: WebSearchEngine;
  status: SearchAttemptStatus;
  reason?: string;
  count?: number;
}

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  engine: WebSearchEngine;
  host: string;
  score: number;
  publishedDate?: string;
  freshnessWarning?: string;
  llms?: LlmsDocument | null;
}

interface SearchCollection {
  results: WebSearchResult[];
  attempts: SearchAttempt[];
}

interface BrowsedSearchResult extends WebSearchResult {
  finalUrl: string;
  pageTitle: string;
  excerpt: string;
  pageDate?: string;
  browseError?: string;
  llms?: LlmsDocument | null;
  markdownUrl?: string;
  contentSource?: "html" | "markdown";
  routedByLlms?: boolean;
  routedFromUrl?: string;
  routedReason?: string;
}

interface LlmsRouteDecision {
  requestUrl: string;
  targetUrl: string;
  routed: boolean;
  reason?: string;
}

const TRUSTED_DOMAINS = [
  "developer.mozilla.org",
  "react.dev",
  "nextjs.org",
  "vercel.com",
  "github.com",
  "npmjs.com",
  "nodejs.org",
  "typescriptlang.org",
  "python.org",
  "w3.org",
  "w3schools.com",
  "freecodecamp.org",
  "geeksforgeeks.org",
  "stackexchange.com",
  "stackoverflow.com",
];

const LOW_QUALITY_DOMAINS = [
  "consumersearch.com",
  "questionsanswered.net",
  "reference.com",
  "ask.com",
];

const QUERY_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "best", "by", "for", "from", "guide", "how",
  "in", "into", "is", "it", "of", "on", "or", "the", "to", "what", "with",
]);

function normalizeDomainFilter(domain?: string): string | undefined {
  if (!domain) return undefined;
  return domain
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase() || undefined;
}

function domainMatches(host: string, domain?: string): boolean {
  if (!domain) return false;
  return host === domain || host.endsWith(`.${domain}`);
}

function buildWebSearchUrl(query: string, engine: WebSearchEngine, domain?: string): string {
  const normalizedDomain = normalizeDomainFilter(domain);
  const effectiveQuery = normalizedDomain && !query.includes("site:") ? `site:${normalizedDomain} ${query}` : query;

  switch (engine) {
    case "yahoo": {
      const url = new URL("https://search.yahoo.com/search");
      url.searchParams.set("p", effectiveQuery);
      return url.toString();
    }
    case "ask": {
      const url = new URL("https://www.ask.com/web");
      url.searchParams.set("q", effectiveQuery);
      return url.toString();
    }
    case "marginalia": {
      const url = new URL("https://search.marginalia.nu/search");
      url.searchParams.set("query", effectiveQuery);
      return url.toString();
    }
  }
}

function getWebSearchOrder(engine: WebSearchMode): WebSearchEngine[] {
  if (engine === "auto") return [...WEB_SEARCH_ENGINES];
  return [engine, ...WEB_SEARCH_ENGINES.filter((candidate) => candidate !== engine)];
}

function normalizeSearchResultUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();

    if (hostname.startsWith("r.search.yahoo.com")) {
      const target = parsed.searchParams.get("RU");
      if (target) return decodeURIComponent(target);
    }

    if (hostname.includes("google.") && parsed.pathname === "/url") {
      const target = parsed.searchParams.get("q");
      if (target) return target;
    }

    if (hostname.endsWith("duckduckgo.com") && parsed.pathname.startsWith("/l/")) {
      const target = parsed.searchParams.get("uddg");
      if (target) return decodeURIComponent(target);
    }

    const cleaned = new URL(parsed.toString());
    [
      "ad", "qo", "o", "origq", "ueid", "fr", "fr2", "guccounter", "guce_referrer", "guce_referrer_sig",
      "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "ref_src",
    ].forEach((key) => {
      cleaned.searchParams.delete(key);
    });
    cleaned.hash = "";

    return cleaned.toString();
  } catch {
    return rawUrl;
  }
}

function normalizeComparableUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function isSameSiteUrl(baseUrl: string, candidateUrl: string): boolean {
  try {
    const baseHost = new URL(baseUrl).hostname.toLowerCase().replace(/^www\./, "");
    const candidateHost = new URL(candidateUrl).hostname.toLowerCase().replace(/^www\./, "");
    return domainMatches(candidateHost, baseHost) || domainMatches(baseHost, candidateHost);
  } catch {
    return false;
  }
}

function deriveRouteTargetUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.pathname.endsWith(".html.md")) {
      parsed.pathname = parsed.pathname.slice(0, -3);
      return parsed.toString();
    }
    if (parsed.pathname.endsWith(".md")) {
      parsed.pathname = parsed.pathname.slice(0, -3);
      return parsed.toString();
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function resolveLlmsRoute(url: string, llms: LlmsDocument | null | undefined, query?: string, followLlmsLinks = true): LlmsRouteDecision {
  const requestUrl = normalizeComparableUrl(url);
  if (!followLlmsLinks || !llms || !query) {
    return { requestUrl, targetUrl: requestUrl, routed: false };
  }

  const relevantLinks = findRelevantLlmsLinks(llms, query, { maxLinks: 6, includeOptional: true })
    .map((link) => {
      const targetUrl = deriveRouteTargetUrl(link.url);
      let score = link.score;
      if (isSameSiteUrl(requestUrl, targetUrl)) score += 8;
      if (/\.(html|md)$/i.test(link.url)) score += 2;
      if (/\b(api|reference|docs|guide|tutorial|oauth|auth|get started|quickstart|example)\b/i.test(`${link.title} ${link.note || ""} ${link.sectionTitle}`)) score += 3;
      if (link.optional) score -= 2;
      return { ...link, targetUrl, score };
    })
    .filter((link) => isSameSiteUrl(requestUrl, link.targetUrl))
    .filter((link) => isUrlSafe(link.targetUrl).safe)
    .filter((link) => checkDownloadRequest(link.targetUrl).allowed)
    .sort((a, b) => b.score - a.score);

  const best = relevantLinks[0];
  if (!best) return { requestUrl, targetUrl: requestUrl, routed: false };
  if (best.score < 10) return { requestUrl, targetUrl: requestUrl, routed: false };
  if (normalizeComparableUrl(best.targetUrl) === requestUrl) return { requestUrl, targetUrl: requestUrl, routed: false };

  const sectionLabel = best.optional ? `${best.sectionTitle} section` : best.sectionTitle;
  return {
    requestUrl,
    targetUrl: best.targetUrl,
    routed: true,
    reason: `${best.title} (${sectionLabel})`,
  };
}

function isInternalSearchEngineUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();

    if (hostname === "search.yahoo.com" && pathname === "/search") return true;
    if ((hostname === "www.ask.com" || hostname === "ask.com") && pathname.startsWith("/web")) return true;
    if ((hostname === "search.marginalia.nu" || hostname === "marginalia-search.com") && pathname.startsWith("/search")) return true;
    return false;
  } catch {
    return true;
  }
}

function cleanSearchText(text: string): string {
  return text
    .replace(/[\u00ad\u200b-\u200f\u2060\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*·\s*/g, " · ")
    .trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanSearchSnippet(snippet: string, title: string): string {
  let cleaned = cleanSearchText(snippet)
    .replace(/^\d+\s+more\s*/i, "")
    .replace(/^\s*[-–—:]\s*/, "")
    .trim();

  if (title) {
    const titleRegex = new RegExp(`^${escapeRegExp(cleanSearchText(title))}\\s*[·:-]?\\s*`, "i");
    cleaned = cleaned.replace(titleRegex, "");
  }

  return cleaned;
}

function buildQueryTokens(query: string): string[] {
  return Array.from(new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9.#+-]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length > 1 && !QUERY_STOP_WORDS.has(token))
  ));
}

function countQueryHits(text: string, tokens: string[]): number {
  const haystack = text.toLowerCase();
  return tokens.reduce((count, token) => count + (haystack.includes(token) ? 1 : 0), 0);
}

function extractDateHint(text: string): string | undefined {
  const cleaned = cleanSearchText(text);
  if (!cleaned) return undefined;

  const absolutePatterns = [
    /(\d{4}-\d{2}-\d{2})/,
    /(\d{1,2}\/\d{1,2}\/\d{4})/,
    /((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4})/i,
  ];

  for (const pattern of absolutePatterns) {
    const match = cleaned.match(pattern);
    if (match) return match[1];
  }

  const relativeMatch = cleaned.match(/(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/i);
  if (relativeMatch) {
    const amount = Number(relativeMatch[1]);
    const unit = relativeMatch[2].toLowerCase();
    const date = new Date();

    if (unit.startsWith("minute")) date.setMinutes(date.getMinutes() - amount);
    else if (unit.startsWith("hour")) date.setHours(date.getHours() - amount);
    else if (unit.startsWith("day")) date.setDate(date.getDate() - amount);
    else if (unit.startsWith("week")) date.setDate(date.getDate() - (amount * 7));
    else if (unit.startsWith("month")) date.setMonth(date.getMonth() - amount);
    else if (unit.startsWith("year")) date.setFullYear(date.getFullYear() - amount);

    return date.toISOString();
  }

  if (/\byesterday\b/i.test(cleaned)) {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return date.toISOString();
  }

  return undefined;
}

function formatDateForDisplay(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("en-US");
}

function getDomainScore(host: string): number {
  if (LOW_QUALITY_DOMAINS.some((domain) => domainMatches(host, domain))) return -14;

  let score = 0;
  if (TRUSTED_DOMAINS.some((domain) => domainMatches(host, domain))) score += 12;
  if (host.endsWith(".gov") || host.endsWith(".edu")) score += 6;
  if (host.endsWith(".org")) score += 3;
  if (host.includes("docs") || host.startsWith("developer.")) score += 5;
  if (host.includes("blog")) score += 1;
  return score;
}

function scoreSearchResult(query: string, result: { title: string; url: string; snippet: string; host: string; engine: WebSearchEngine }, domain?: string, maxAgeMonths = 18): { score: number; publishedDate?: string; freshnessWarning?: string } {
  const tokens = buildQueryTokens(query);
  const titleHits = countQueryHits(result.title, tokens);
  const snippetHits = countQueryHits(result.snippet, tokens);
  const urlHits = countQueryHits(result.url, tokens);

  let score = result.engine === "yahoo" ? 28 : result.engine === "marginalia" ? 20 : 8;
  score += titleHits * 8;
  score += snippetHits * 3;
  score += urlHits * 2;
  score += getDomainScore(result.host);

  if (domainMatches(result.host, normalizeDomainFilter(domain))) score += 25;
  if (result.snippet.length >= 140) score += 3;
  else if (result.snippet.length >= 60) score += 1;

  if (/\b(docs?|documentation|guide|tutorial|reference|official)\b/i.test(`${result.title} ${result.snippet}`)) score += 3;

  const publishedDate = extractDateHint(result.snippet);
  let freshnessWarning: string | undefined;
  if (publishedDate) {
    const freshness = checkDateFreshness(publishedDate, maxAgeMonths);
    if (freshness.isFresh) score += 5;
    else {
      score -= 6;
      freshnessWarning = freshness.warning;
    }
  }

  return { score, publishedDate, freshnessWarning };
}

function mergeSearchResults(existing: WebSearchResult | undefined, incoming: WebSearchResult): WebSearchResult {
  if (!existing) return incoming;
  const winner = existing.score >= incoming.score ? existing : incoming;
  const loser = winner === existing ? incoming : existing;

  return {
    ...winner,
    snippet: winner.snippet || loser.snippet,
    publishedDate: winner.publishedDate || loser.publishedDate,
    freshnessWarning: winner.freshnessWarning || loser.freshnessWarning,
  };
}

function normalizeEngineResults(query: string, rawResults: { title: string; url: string; snippet: string }[], engine: WebSearchEngine, domain?: string, maxAgeMonths = 18): WebSearchResult[] {
  const normalizedDomain = normalizeDomainFilter(domain);
  const seen = new Set<string>();

  return rawResults
    .map((result) => {
      const title = cleanSearchText(result.title);
      const url = normalizeSearchResultUrl(result.url);
      const snippet = cleanSearchSnippet(result.snippet, title);
      const host = (() => {
        try {
          return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
        } catch {
          return "";
        }
      })();

      const scoring = scoreSearchResult(query, { title, url, snippet, host, engine }, normalizedDomain, maxAgeMonths);
      return {
        title,
        url,
        snippet,
        host,
        engine,
        score: scoring.score,
        publishedDate: scoring.publishedDate,
        freshnessWarning: scoring.freshnessWarning,
      } satisfies WebSearchResult;
    })
    .filter((result) => result.title.length > 2 && result.url && result.host)
    .filter((result) => !isInternalSearchEngineUrl(result.url))
    .filter((result) => isUrlSafe(result.url).safe)
    .filter((result) => {
      if (seen.has(result.url)) return false;
      seen.add(result.url);
      return true;
    })
    .sort((a, b) => b.score - a.score);
}

function formatAttemptSummary(attempts: SearchAttempt[]): string {
  return attempts.map((attempt) => {
    if (attempt.status === "ok") return `${attempt.engine}:${attempt.count}`;
    if (attempt.status === "blocked") return `${attempt.engine}:blocked`;
    return `${attempt.engine}:0`;
  }).join(", ");
}

async function detectSearchBlock(page: Awaited<ReturnType<typeof browserManager.openPage>>): Promise<string | undefined> {
  const pageText = await page.evaluate(() => {
    return `${document.title}\n${document.body?.innerText?.slice(0, 2000) || ""}`.toLowerCase();
  }).catch(() => "");

  if (/captcha|not a robot|security verification|unusual traffic|please solve|challenge|performing security verification/.test(pageText)) {
    return "Blocked by anti-bot challenge";
  }

  if (/service unavailable|not yet available in your country/.test(pageText)) {
    return "Search engine unavailable in current region";
  }

  return undefined;
}

async function collectWebSearchResults(
  query: string,
  engine: WebSearchMode,
  domain?: string,
  maxResults = 5,
  maxAgeMonths = 18,
): Promise<SearchCollection> {
  const ctxId = genContextId();
  const attempts: SearchAttempt[] = [];
  const merged = new Map<string, WebSearchResult>();

  try {
    for (const currentEngine of getWebSearchOrder(engine)) {
      const page = await browserManager.openPage(ctxId);
      const searchUrl = buildWebSearchUrl(query, currentEngine, domain);

      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(currentEngine === "marginalia" ? 5000 : 3500);

      const blockedReason = await detectSearchBlock(page);
      if (blockedReason) {
        attempts.push({ engine: currentEngine, status: "blocked", reason: blockedReason });
        await page.close().catch(() => {});
        continue;
      }

      const rawResults = await parseSearchResults(page);
      await page.close().catch(() => {});

      const normalized = normalizeEngineResults(query, rawResults, currentEngine, domain, maxAgeMonths);
      if (normalized.length === 0) {
        attempts.push({ engine: currentEngine, status: "empty" });
        continue;
      }

      attempts.push({ engine: currentEngine, status: "ok", count: normalized.length });
      for (const result of normalized) {
        merged.set(result.url, mergeSearchResults(merged.get(result.url), result));
      }

      const ranked = [...merged.values()].sort((a, b) => b.score - a.score);
      if (engine !== "auto") {
        return { results: ranked, attempts };
      }

      if (currentEngine === "yahoo" && ranked.length >= maxResults + 2) break;
      if (currentEngine === "marginalia" && ranked.length >= maxResults) break;
    }

    return { results: [...merged.values()].sort((a, b) => b.score - a.score), attempts };
  } finally {
    await browserManager.closeContext(ctxId);
  }
}

function formatWebSearchResults(query: string, results: WebSearchResult[], attempts: SearchAttempt[], maxResults: number, domain?: string): string {
  const limited = results.slice(0, maxResults);
  const formatted = limited.map((result, index) => {
    let line = `[${index + 1}] ${result.title}`;
    line += `\n    URL: ${result.url}`;
    line += `\n    Source: ${result.engine}${result.llms ? " 🤖 LLMS.txt" : ""}`;
    if (result.publishedDate) {
      line += `\n    📅 ${formatDateForDisplay(result.publishedDate)}`;
      if (result.freshnessWarning) line += ` ${result.freshnessWarning}`;
    }
    if (result.snippet) line += `\n    ${result.snippet.slice(0, 260)}`;
    return line;
  }).join("\n\n");

  let header = `# Web Search: "${query}"`;
  if (domain) header += `\nDomain: ${normalizeDomainFilter(domain)}`;
  header += `\nResults: ${limited.length} of ${results.length}`;
  if (attempts.length > 0) header += `\nEngines: ${formatAttemptSummary(attempts)}`;

  return `${header}\n\n${formatted}`;
}

async function enrichResultsWithLlms(results: WebSearchResult[], probeCount: number): Promise<WebSearchResult[]> {
  const probeTargets = results.slice(0, Math.max(0, probeCount));
  if (probeTargets.length === 0) return results;

  const docs = await Promise.all(probeTargets.map(async (result) => ({
    url: result.url,
    doc: await findLlmsTxt(result.url),
  })));
  const docMap = new Map(docs.map((item) => [item.url, item.doc]));

  return results
    .map((result) => {
      const llms = docMap.get(result.url);
      if (!llms) return result;
      return {
        ...result,
        llms,
        score: result.score + 6,
      } satisfies WebSearchResult;
    })
    .sort((a, b) => b.score - a.score);
}

async function browseSearchResults(
  results: WebSearchResult[],
  browseTop: number,
  excerptChars: number,
  maxAgeMonths: number,
  query?: string,
  followLlmsLinks = true,
): Promise<BrowsedSearchResult[]> {
  const ctxId = genContextId();
  const safeResults = results
    .filter((result) => isUrlSafe(result.url).safe)
    .filter((result) => checkDownloadRequest(result.url).allowed)
    .slice(0, browseTop);

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
          return window.location.hash.length > 0 || !!document.querySelector("[data-reactroot], [data-v-app], #__next, #app");
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
        const freshnessWarning = pageDate ? checkDateFreshness(pageDate, maxAgeMonths).warning : result.freshnessWarning;
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
          contentSource: markdown ? "markdown" : "html",
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
          contentSource: markdown ? "markdown" : "html",
          routedByLlms: route.routed,
          routedFromUrl: route.routed ? route.requestUrl : undefined,
          routedReason: route.reason,
        } satisfies BrowsedSearchResult;
      } finally {
        await page.close().catch(() => {});
      }
    }));

    return browsed.filter((result) => result.excerpt || !result.browseError);
  } finally {
    await browserManager.closeContext(ctxId);
  }
}

// ── TOOL: github_search ───────────────────────────────────────────
server.tool(
  "github_search",
  "Search GitHub repositories.",
  {
    query: z.string().describe("Search term"),
    type: z.enum(["repos", "code", "issues"]).optional().default("repos"),
    maxResults: z.number().min(1).max(10).optional().default(5),
    sortByUpdated: z.boolean().optional().default(true),
  },
  async ({ query, type, maxResults, sortByUpdated }) => {
    const ctxId = genContextId();
    let results: { title: string; url: string; snippet: string; updatedAt: string; stars: string; language: string }[] = [];
    try {
    const page = await browserManager.openPage(ctxId);

    const sortParam = sortByUpdated ? "&s=updated&o=desc" : "";
    const typeParam = type === "repos" ? "repositories" : type;
    const url = `https://github.com/search?q=${encodeURIComponent(query)}&type=${typeParam}${sortParam}`;

    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(4000);

    results = await page.evaluate(() => {
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
  "Inspect llms.txt for a site or page and show the parsed guidance structure.",
  {
    url: z.string().url().describe("Any page or site URL"),
    query: z.string().optional().describe("Optional query to rank the most relevant llms.txt links"),
  },
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
  `Search the public web without API keys. ${RESEARCH_POLICY}`,
  {
    query: z.string().describe("Search term"),
    maxResults: z.number().min(1).max(10).optional().default(5),
    engine: z.enum(["auto", "yahoo", "ask", "marginalia"]).optional().default("auto"),
    domain: z.string().optional().describe("Optional domain filter, e.g. react.dev or github.com"),
    maxAgeMonths: z.number().optional().default(18),
    checkLlmsTxt: z.boolean().optional().default(false),
  },
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
  `Search the web, open the best results, and extract readable content. ${RESEARCH_POLICY}`,
  {
    query: z.string().describe("Search term"),
    maxResults: z.number().min(1).max(10).optional().default(5),
    browseTop: z.number().min(1).max(5).optional().default(3),
    engine: z.enum(["auto", "yahoo", "ask", "marginalia"]).optional().default("auto"),
    domain: z.string().optional().describe("Optional domain filter, e.g. react.dev or github.com"),
    maxAgeMonths: z.number().optional().default(18),
    excerptChars: z.number().min(500).max(5000).optional().default(2200),
    followLlmsLinks: z.boolean().optional().default(true),
  },
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
      content: [{ type: "text" as const, text: `${searchSummary}\n\n---\n\n# Search & Browse\nBrowsed ${browsed.length} result(s).\n\n${detailSections}` }],
    };
  }
);

// ── TOOL: browse_page ─────────────────────────────────────────────
server.tool(
  "browse_page",
  `Visit a URL and extract content. ${RESEARCH_POLICY}`,
  {
    url: z.string().url().describe("URL"),
    query: z.string().optional().describe("Optional intent so llms.txt can route to a more relevant page"),
    followLlmsLinks: z.boolean().optional().default(true),
    waitFor: z.enum(["domcontentloaded", "load", "networkidle"]).optional().default("networkidle"),
    warnIfOlderThanMonths: z.number().optional().default(24),
  },
  async ({ url, query, followLlmsLinks, waitFor, warnIfOlderThanMonths }) => {
    const safety = isUrlSafe(url);
    if (!safety.safe) {
      return { content: [{ type: "text" as const, text: `🔒 SECURITY: ${safety.reason}` }] };
    }

    const download = checkDownloadRequest(url);
    if (!download.allowed) {
      return { content: [{ type: "text" as const, text: download.warning || "" }] };
    }

    const llms = await findLlmsTxt(url);
    const route = resolveLlmsRoute(url, llms, query, followLlmsLinks);
    const activeUrl = route.targetUrl;
    const markdown = llms ? await findMarkdownVersion(activeUrl) : null;
    const ctxId = genContextId();
    let content: Awaited<ReturnType<typeof extractContent>>;
    let pageDate: string | undefined;
    let finalUrl: string;
    try {
      const page = await browserManager.openPage(ctxId);

      await page.goto(activeUrl, { waitUntil: waitFor, timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(3000);

      content = await extractContent(page);
      pageDate = await extractDate(page);
      finalUrl = page.url();
    } finally {
      await browserManager.closeContext(ctxId);
    }

    let dateWarning = "";
    if (pageDate) {
      const dateCheck = checkDateFreshness(pageDate, warnIfOlderThanMonths);
      if (dateCheck.warning) dateWarning = `\n\n${dateCheck.warning}`;
    }

    const preferredTitle = markdown?.title || content.title;
    const preferredText = markdown?.content || content.text;
    const truncated = preferredText.length > 15000 ? preferredText.slice(0, 15000) + "\n\n[... truncated]" : preferredText;
    const dateInfo = pageDate ? `\n📅 ${new Date(pageDate).toLocaleDateString("en-US")}` : "";
    const routeInfo = route.routed ? `\nLLMS route: ${route.requestUrl} → ${finalUrl}${route.reason ? `\nRoute reason: ${route.reason}` : ""}` : "";
    const contentSourceInfo = markdown?.sourceUrl ? `\nContent source: Markdown fallback (${markdown.sourceUrl})` : "";
    const llmsSection = llms
      ? `${formatLlmsGuidance(llms, { headingLevel: 2, maxSections: 3, maxNotesPerSection: 2, maxLinksPerSection: 3, query, maxRelevantLinks: 3 })}\n\n---\n\n`
      : "";

    return { content: [{ type: "text" as const, text: `# ${preferredTitle}\n\nURL: ${finalUrl}${routeInfo}${dateInfo}${contentSourceInfo}${dateWarning}\n\n${llmsSection}${truncated}` }] };
  }
);

// ── TOOL: smart_browse ────────────────────────────────────────────
server.tool(
  "smart_browse",
  `Smart page visit: SPA detection, date check. ${RESEARCH_POLICY}`,
  {
    url: z.string().url().describe("URL"),
    query: z.string().optional().describe("Optional intent so llms.txt can route to a more relevant page"),
    followLlmsLinks: z.boolean().optional().default(true),
    requireFreshContent: z.boolean().optional().default(true),
    maxAgeMonths: z.number().optional().default(12),
  },
  async ({ url, query, followLlmsLinks, requireFreshContent, maxAgeMonths }) => {
    const safety = isUrlSafe(url);
    if (!safety.safe) {
      return { content: [{ type: "text" as const, text: `🔒 SECURITY: ${safety.reason}` }] };
    }

    const download = checkDownloadRequest(url);
    if (!download.allowed) {
      return { content: [{ type: "text" as const, text: download.warning || "" }] };
    }

    const llms = await findLlmsTxt(url);
    const route = resolveLlmsRoute(url, llms, query, followLlmsLinks);
    const activeUrl = route.targetUrl;
    const markdown = llms ? await findMarkdownVersion(activeUrl) : null;
    const ctxId = genContextId();
    let content: Awaited<ReturnType<typeof extractContent>>;
    let pageDate: string | undefined;
    let links: Awaited<ReturnType<typeof extractLinks>>;
    let finalUrl: string;
    let isSPA: boolean;
    try {
      const page = await browserManager.openPage(ctxId);

      await page.goto(activeUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});

      isSPA = await page.evaluate(() => {
        return window.location.hash.length > 0 || !!document.querySelector("[data-reactroot], [data-v-app], #__next, #app");
      });

      if (isSPA) {
        await page.waitForTimeout(4000);
        await page.waitForSelector("main, article, .content, [role='main']", { timeout: 10000 }).catch(() => {});
      } else {
        await page.waitForTimeout(2000);
      }

      content = await extractContent(page);
      pageDate = await extractDate(page);
      links = await extractLinks(page);

      finalUrl = page.url();
    } finally {
      await browserManager.closeContext(ctxId);
    }

    let dateWarning = "";
    let isFresh = true;
    if (pageDate) {
      const dateCheck = checkDateFreshness(pageDate, maxAgeMonths);
      isFresh = dateCheck.isFresh;
      if (dateCheck.warning) {
        dateWarning = `\n\n${dateCheck.warning}`;
        if (requireFreshContent && !isFresh) dateWarning += "\n\n⚠️ FRESH CONTENT REQUIRED!";
      }
    }

    const preferredTitle = markdown?.title || content.title;
    const preferredText = markdown?.content || content.text;

    let output = `# ${preferredTitle}\n\nURL: ${finalUrl}`;
    if (isSPA) output += ` (SPA)`;
    if (route.routed) {
      output += `\nLLMS route: ${route.requestUrl} → ${finalUrl}`;
      if (route.reason) output += `\nRoute reason: ${route.reason}`;
    }
    if (pageDate) output += `\n📅 ${new Date(pageDate).toLocaleDateString("en-US")}`;
    if (markdown?.sourceUrl) output += `\nContent source: Markdown fallback (${markdown.sourceUrl})`;
    output += `${dateWarning}`;
    if (llms) {
      output += `\n\n---\n\n${formatLlmsGuidance(llms, { headingLevel: 2, maxSections: 3, maxNotesPerSection: 2, maxLinksPerSection: 3, query, maxRelevantLinks: 3 })}`;
    }
    output += `\n\n---\n\n${preferredText.slice(0, 12000)}`;

    if (links.length > 0) {
      output += `\n\n---\n\n## Links (${links.length})\n`;
      output += links.slice(0, 15).map((l) => `- [${l.text}](${l.href})`).join("\n");
    }

    return { content: [{ type: "text" as const, text: output }] };
  }
);

// ── TOOL: deep_search ─────────────────────────────────────────────
server.tool(
  "deep_search",
  `Search directly from sources. ${RESEARCH_POLICY}`,
  {
    query: z.string().describe("Search term"),
    sources: z.array(z.enum(["github", "npm", "mdn", "devdocs"])).optional().default(["github", "npm", "mdn"]),
    maxAgeMonths: z.number().optional().default(12),
  },
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

        const page = await browserManager.openPage(ctxId);
        await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(3000);

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

        await page.close();
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

    return { content: [{ type: "text" as const, text: `# Deep Search: "${query}"\n${freshResults.length}/${results.length} sources fresh\n\n${formatted}` }] };
  }
);

// ── TOOL: github_repo_files ───────────────────────────────────────
server.tool(
  "github_repo_files",
  "List GitHub repository files.",
  {
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
    path: z.string().optional().default(""),
    branch: z.string().optional().default("main"),
  },
  async ({ owner, repo, path, branch }) => {
    const ctxId = genContextId();
    let files: { name: string; type: string }[] = [];
    let url: string;
    try {
      const page = await browserManager.openPage(ctxId);

      url = `https://github.com/${owner}/${repo}/tree/${branch}/${path}`;
      await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(3000);

      files = await page.evaluate(() => {
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
    } finally {
      await browserManager.closeContext(ctxId);
    }

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
  "Visit multiple URLs in parallel.",
  {
    urls: z.array(z.string().url()).min(1).max(5).describe("URLs (max 5)"),
  },
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
      const page = await browserManager.openPage(ctxId);
      await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(2500);

      const content = await extractContent(page);
      const pageDate = await extractDate(page);
      const dateCheck = checkDateFreshness(pageDate, 12);

      await page.close();

      let output = `## ${content.title}\nURL: ${url}`;
      if (pageDate) {
        output += `\n📅 ${new Date(pageDate).toLocaleDateString("en-US")}`;
        if (!dateCheck.isFresh) output += " ⚠️ OLD";
      }
      output += `\n\n${content.text.slice(0, 4000)}`;
      return output;
    });

    allResults = await Promise.all(tasks);
    } finally {
    await browserManager.closeContext(ctxId);
    }

    let output = allResults.join("\n\n---\n\n");
    if (blockedUrls.length > 0) {
      output += `\n\n---\n\n🔒 Blocked: ${blockedUrls.join(", ")}`;
    }

    return { content: [{ type: "text" as const, text: output }] };
  }
);

// ── TOOL: get_page_links ──────────────────────────────────────────
server.tool(
  "get_page_links",
  "Extract links from a page.",
  {
    url: z.string().url().describe("URL"),
  },
  async ({ url }) => {
    const safety = isUrlSafe(url);
    if (!safety.safe) {
      return { content: [{ type: "text" as const, text: `🔒 SECURITY: ${safety.reason}` }] };
    }

    const ctxId = genContextId();
    let links: Awaited<ReturnType<typeof extractLinks>>;
    try {
      const page = await browserManager.openPage(ctxId);

      await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(2000);

      links = await extractLinks(page);
    } finally {
      await browserManager.closeContext(ctxId);
    }

    const safeLinks = links.filter(l => isUrlSafe(l.href).safe);
    const formatted = safeLinks.slice(0, 100).map((l, i) => `[${i + 1}] ${l.text}\n    ${l.href}`).join("\n");

    return { content: [{ type: "text" as const, text: formatted || "No links found." }] };
  }
);

// ── TOOL: screenshot ──────────────────────────────────────────────
server.tool(
  "screenshot",
  "Take a screenshot.",
  {
    url: z.string().url().describe("URL"),
    fullPage: z.boolean().optional().default(false),
  },
  async ({ url, fullPage }) => {
    const safety = isUrlSafe(url);
    if (!safety.safe) {
      return { content: [{ type: "text" as const, text: `🔒 SECURITY: ${safety.reason}` }] };
    }

    const ctxId = genContextId();
    let buffer: Buffer;
    try {
      const page = await browserManager.openPage(ctxId);

      await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(2500);

      buffer = await page.screenshot({ fullPage, type: "png" });
    } finally {
      await browserManager.closeContext(ctxId);
    }

    return { content: [{ type: "image" as const, data: buffer.toString("base64"), mimeType: "image/png" }] };
  }
);

// ── SERVER START ──────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);

process.on("SIGINT", async () => {
  await browserManager.close();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await browserManager.close();
  process.exit(0);
});
