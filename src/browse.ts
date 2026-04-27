import type { Page } from "playwright";
import type { LlmsDocument } from "./llms.js";
import type { WebSearchResult, BrowsedSearchResult, LlmsRouteDecision } from "./types.js";
import { browserManager } from "./browser.js";
import { genContextId, extractContent, extractDate, extractLinks } from "./utils.js";
import { isUrlSafe, checkDownloadRequest } from "./security.js";
import { resolveLlmsRoute } from "./routing.js";
import { checkDateFreshness } from "./dates.js";
import { findLlmsTxt } from "./llms.js";
import { findMarkdownVersion } from "./markdown.js";
import { fetchWithChainSoft, type FetcherResult } from "./fetcher/chain.js";

export async function withContext<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const ctxId = genContextId();
  try {
    const page = await browserManager.openPage(ctxId);
    return await fn(page);
  } finally {
    await browserManager.closeContext(ctxId);
  }
}

export async function detectSearchBlock(page: Page): Promise<string | undefined> {
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

export interface BrowseOptions {
  url: string;
  query?: string;
  followLlmsLinks?: boolean;
  waitFor?: "domcontentloaded" | "load" | "networkidle";
  staticTimeout?: number;
  detectSpa?: boolean;
  spaTimeout?: number;
  extractLinks?: boolean;
  maxContentLength?: number;
  maxAgeMonths?: number;
}

export interface BrowseResult {
  url: string;
  finalUrl: string;
  title: string;
  content: string;
  date?: string;
  dateWarning: string;
  isFresh: boolean;
  isSpa: boolean;
  llms: LlmsDocument | null;
  markdownUrl?: string;
  contentSource: "html" | "markdown" | "github-raw" | "http-jsdom" | "rss" | "archive-cache" | "playwright";
  fetcherUsed?: string;
  fetcherMs?: number;
  route: LlmsRouteDecision;
  links?: { text: string; href: string }[];
}

export async function browseUrl(options: BrowseOptions): Promise<BrowseResult> {
  const {
    url,
    query,
    followLlmsLinks = true,
    waitFor = "domcontentloaded",
    staticTimeout = 1500,
    detectSpa = false,
    spaTimeout = 3000,
    extractLinks: shouldExtractLinks = false,
    maxContentLength = 15000,
    maxAgeMonths = 24,
  } = options;

  const llms = await findLlmsTxt(url);
  const route = resolveLlmsRoute(url, llms, query, followLlmsLinks);
  const activeUrl = route.targetUrl;

  const chainResult = await fetchWithChainSoft(activeUrl, {
    query,
    maxContentLength,
    maxAgeMonths,
    extractLinks: shouldExtractLinks,
    followLlmsLinks,
    waitFor,
    detectSpa,
    staticTimeout,
    spaTimeout,
  });

  if (chainResult && !chainResult.isSpa && chainResult.content.length > 200) {
    let dateWarning = "";
    let isFresh = true;
    if (chainResult.date) {
      const dateCheck = checkDateFreshness(chainResult.date, maxAgeMonths);
      isFresh = dateCheck.isFresh;
      dateWarning = dateCheck.warning;
    }

    return {
      url,
      finalUrl: chainResult.finalUrl,
      title: chainResult.title,
      content: chainResult.content,
      date: chainResult.date,
      dateWarning,
      isFresh,
      isSpa: false,
      llms,
      markdownUrl: chainResult.contentSource === "markdown" ? chainResult.finalUrl : undefined,
      contentSource: chainResult.contentSource,
      fetcherUsed: chainResult.fetcherName,
      fetcherMs: chainResult.ms,
      route,
      links: chainResult.links,
    } satisfies BrowseResult;
  }

  const markdown = llms ? await findMarkdownVersion(activeUrl) : null;

  return withContext(async (page) => {
    await page.goto(activeUrl, { waitUntil: waitFor, timeout: 7000 }).catch(() => {});

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
    if (pageDate) {
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
      isSpa,
      llms,
      markdownUrl: markdown?.sourceUrl,
      contentSource: markdown ? "markdown" as const : "html" as const,
      route,
      links,
    } satisfies BrowseResult;
  });
}

export async function browseSearchResults(
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

      const chainResult = await fetchWithChainSoft(activeUrl, {
        query,
        maxContentLength: excerptChars,
        maxAgeMonths,
        followLlmsLinks,
      });

      if (chainResult && !chainResult.isSpa && chainResult.content.length > 100) {
        const pageDate = chainResult.date;
        const freshnessWarning = pageDate ? checkDateFreshness(pageDate, maxAgeMonths).warning : result.freshnessWarning;

        return {
          ...result,
          finalUrl: chainResult.finalUrl,
          pageTitle: chainResult.title || result.title,
          excerpt: chainResult.content.slice(0, excerptChars),
          pageDate,
          freshnessWarning,
          browseError: undefined,
          llms,
          markdownUrl: chainResult.contentSource === "markdown" ? chainResult.finalUrl : undefined,
          contentSource: chainResult.contentSource,
          fetcherUsed: chainResult.fetcherName,
          fetcherMs: chainResult.ms,
          routedByLlms: route.routed,
          routedFromUrl: route.routed ? route.requestUrl : undefined,
          routedReason: route.reason,
        } satisfies BrowsedSearchResult;
      }

      const markdown = llms ? await findMarkdownVersion(activeUrl) : null;
      const page = await browserManager.openPage(ctxId);

      try {
        await page.goto(activeUrl, { waitUntil: "domcontentloaded", timeout: 7000 }).catch(() => {});

        const isSPA = await page.evaluate(() => {
          return window.location.hash.length > 0 || !!document.querySelector("[data-reactroot], [data-v-app], #__next, #app");
        }).catch(() => false);

        if (isSPA) {
          await page.waitForTimeout(3000);
          await page.waitForSelector("main, article, .content, [role='main']", { timeout: 5000 }).catch(() => {});
        } else {
          await page.waitForTimeout(1500);
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
