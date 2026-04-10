import type { LlmsDocument } from "./llms.js";
import { findRelevantLlmsLinks } from "./llms.js";

export const BLOCKED_DOMAINS = [
  "malware", "phishing", "spam", "scam", "hack", "crack", "warez", "pirate",
  "porn", "xxx", "adult", "sex",
];

export const BLOCKED_DOWNLOAD_EXTENSIONS = [".zip", ".exe", ".dmg", ".pkg", ".msi", ".apk", ".ipa", ".tar", ".gz", ".tgz", ".rar", ".7z", ".bin", ".iso"];

export const TRUSTED_DOMAINS = [
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

export const LOW_QUALITY_DOMAINS = [
  "consumersearch.com",
  "questionsanswered.net",
  "reference.com",
  "ask.com",
];

export const QUERY_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "best", "by", "for", "from", "guide", "how",
  "in", "into", "is", "it", "of", "on", "or", "the", "to", "what", "with",
]);

export const WEB_SEARCH_ENGINES = ["yahoo", "marginalia", "ask"] as const;
export type WebSearchEngine = typeof WEB_SEARCH_ENGINES[number];
export type WebSearchMode = "auto" | WebSearchEngine;
export type SearchAttemptStatus = "ok" | "blocked" | "empty";

export interface SearchAttempt {
  engine: WebSearchEngine;
  status: SearchAttemptStatus;
  reason?: string;
  count?: number;
}

export interface WebSearchResult {
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

export interface BrowsedSearchResult extends WebSearchResult {
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

export interface LlmsRouteDecision {
  requestUrl: string;
  targetUrl: string;
  routed: boolean;
  reason?: string;
}

export function isUrlSafe(url: string): { safe: boolean; reason?: string } {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { safe: false, reason: `Unsafe protocol: ${parsed.protocol}` };
    }
    const hostname = parsed.hostname.toLowerCase();
    const hostSegments = new Set(hostname.split("."));
    for (const blocked of BLOCKED_DOMAINS) {
      if (hostSegments.has(blocked)) {
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

export function checkDownloadRequest(url: string): { allowed: boolean; warning?: string } {
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

export function checkDateFreshness(dateStr: string | undefined, maxAgeMonths = 24): { isFresh: boolean; warning: string } {
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

export function normalizeDomainFilter(domain?: string): string | undefined {
  if (!domain) return undefined;
  return domain
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase() || undefined;
}

export function domainMatches(host: string, domain?: string): boolean {
  if (!domain) return false;
  return host === domain || host.endsWith(`.${domain}`);
}

export function buildWebSearchUrl(query: string, engine: WebSearchEngine, domain?: string): string {
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

export function getWebSearchOrder(engine: WebSearchMode): WebSearchEngine[] {
  if (engine === "auto") return [...WEB_SEARCH_ENGINES];
  return [engine, ...WEB_SEARCH_ENGINES.filter((candidate) => candidate !== engine)];
}

export function normalizeSearchResultUrl(rawUrl: string): string {
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

export function normalizeComparableUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

export function isSameSiteUrl(baseUrl: string, candidateUrl: string): boolean {
  try {
    const baseHost = new URL(baseUrl).hostname.toLowerCase().replace(/^www\./, "");
    const candidateHost = new URL(candidateUrl).hostname.toLowerCase().replace(/^www\./, "");
    return domainMatches(candidateHost, baseHost) || domainMatches(baseHost, candidateHost);
  } catch {
    return false;
  }
}

export function deriveRouteTargetUrl(rawUrl: string): string {
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

export function resolveLlmsRoute(url: string, llms: LlmsDocument | null | undefined, query?: string, followLlmsLinks = true): LlmsRouteDecision {
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

export function isInternalSearchEngineUrl(url: string): boolean {
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

export function cleanSearchText(text: string): string {
  return text
    .replace(/[\u00ad\u200b-\u200f\u2060\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*·\s*/g, " · ")
    .trim();
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function cleanSearchSnippet(snippet: string, title: string): string {
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

export function buildQueryTokens(query: string): string[] {
  return Array.from(new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9.#+-]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length > 1 && !QUERY_STOP_WORDS.has(token))
  ));
}

export function countQueryHits(text: string, tokens: string[]): number {
  const haystack = text.toLowerCase();
  return tokens.reduce((count, token) => count + (haystack.includes(token) ? 1 : 0), 0);
}

export function extractDateHint(text: string): string | undefined {
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

export function formatDateForDisplay(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("en-US");
}

export function getDomainScore(host: string): number {
  if (LOW_QUALITY_DOMAINS.some((domain) => domainMatches(host, domain))) return -14;

  let score = 0;
  if (TRUSTED_DOMAINS.some((domain) => domainMatches(host, domain))) score += 12;
  if (host.endsWith(".gov") || host.endsWith(".edu")) score += 6;
  if (host.endsWith(".org")) score += 3;
  if (host.includes("docs") || host.startsWith("developer.")) score += 5;
  if (host.includes("blog")) score += 1;
  return score;
}

export function scoreSearchResult(query: string, result: { title: string; url: string; snippet: string; host: string; engine: WebSearchEngine }, domain?: string, maxAgeMonths = 18): { score: number; publishedDate?: string; freshnessWarning?: string } {
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

export function mergeSearchResults(existing: WebSearchResult | undefined, incoming: WebSearchResult): WebSearchResult {
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

export function formatAttemptSummary(attempts: SearchAttempt[]): string {
  return attempts.map((attempt) => {
    if (attempt.status === "ok") return `${attempt.engine}:${attempt.count}`;
    if (attempt.status === "blocked") return `${attempt.engine}:blocked`;
    return `${attempt.engine}:0`;
  }).join(", ");
}
