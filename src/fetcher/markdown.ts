import type { Fetcher, FetcherResult, FetcherOptions, FetcherSource } from "./types.js";
import { DEFAULT_FETCHER_OPTIONS, truncateContent } from "./types.js";
import { findLlmsTxt } from "../llms.js";
import { findMarkdownVersion } from "../markdown.js";

export const markdownFetcher: Fetcher = {
  name: "markdown",
  priority: 5,

  canHandle(_url: string): boolean {
    return true;
  },

  async fetch(url: string, opts?: FetcherOptions): Promise<FetcherResult | null> {
    const maxContentLength = opts?.maxContentLength ?? DEFAULT_FETCHER_OPTIONS.maxContentLength;
    const start = Date.now();

    const llms = await findLlmsTxt(url);
    if (!llms) return null;

    const md = await findMarkdownVersion(url);
    if (!md) return null;

    const ms = Date.now() - start;
    if (!md.content || md.content.length < 50) return null;

    return {
      url,
      finalUrl: md.sourceUrl,
      title: md.title || "",
      content: truncateContent(md.content, maxContentLength),
      isSpa: false,
      contentSource: "markdown" as FetcherSource,
      fetcherName: "markdown",
      ms,
    };
  },
};
