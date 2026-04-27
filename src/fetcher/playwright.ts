import type { Page } from "playwright";
import type { Fetcher, FetcherResult, FetcherOptions, FetcherSource } from "./types.js";
import { DEFAULT_FETCHER_OPTIONS, truncateContent } from "./types.js";
import { browserManager } from "../browser.js";
import { extractContent, extractDate, extractLinks, genContextId } from "../utils.js";

export const playwrightFetcher: Fetcher = {
  name: "playwright",
  priority: 100,

  canHandle(_url: string): boolean {
    return true;
  },

  async fetch(url: string, opts?: FetcherOptions): Promise<FetcherResult | null> {
    const maxContentLength = opts?.maxContentLength ?? DEFAULT_FETCHER_OPTIONS.maxContentLength;
    const waitFor = opts?.waitFor ?? DEFAULT_FETCHER_OPTIONS.waitFor;
    const detectSpa = opts?.detectSpa ?? DEFAULT_FETCHER_OPTIONS.detectSpa;
    const staticTimeout = opts?.staticTimeout ?? DEFAULT_FETCHER_OPTIONS.staticTimeout;
    const spaTimeout = opts?.spaTimeout ?? DEFAULT_FETCHER_OPTIONS.spaTimeout;
    const shouldExtractLinks = opts?.extractLinks ?? DEFAULT_FETCHER_OPTIONS.extractLinks;

    const ctxId = genContextId();
    const start = Date.now();

    try {
      const page = await browserManager.openPage(ctxId);

      await page.goto(url, { waitUntil: waitFor, timeout: 7000 }).catch(() => {});

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
      const links = shouldExtractLinks ? await extractLinks(page) : undefined;
      const finalUrl = page.url();
      const ms = Date.now() - start;

      return {
        url,
        finalUrl,
        title: content.title,
        content: truncateContent(content.text, maxContentLength),
        date: pageDate,
        isSpa,
        contentSource: "playwright" as FetcherSource,
        links,
        fetcherName: "playwright",
        ms,
      };
    } catch {
      return null;
    } finally {
      await browserManager.closeContext(ctxId);
    }
  },
};
