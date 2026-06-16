export interface FetcherResult {
  url: string;
  finalUrl: string;
  title: string;
  content: string;
  date?: string;
  isSpa: boolean;
  contentSource: FetcherSource;
  links?: { text: string; href: string }[];
  fetcherName: string;
  ms: number;
}

export type FetcherSource = "markdown" | "github-raw" | "rss" | "http-jsdom" | "archive-cache" | "playwright";

export interface Fetcher {
  readonly name: string;
  readonly priority: number;
  canHandle(url: string, opts?: FetcherOptions): boolean;
  fetch(url: string, opts?: FetcherOptions): Promise<FetcherResult | null>;
}

export interface FetcherOptions {
  query?: string;
  maxContentLength?: number;
  maxAgeMonths?: number;
  extractLinks?: boolean;
  followLlmsLinks?: boolean;
  waitFor?: "domcontentloaded" | "load" | "networkidle";
  detectSpa?: boolean;
  staticTimeout?: number;
  spaTimeout?: number;
  timeout?: number;
}

export const DEFAULT_FETCHER_OPTIONS: Required<FetcherOptions> = {
  query: "",
  maxContentLength: 15000,
  maxAgeMonths: 24,
  extractLinks: false,
  followLlmsLinks: true,
  waitFor: "domcontentloaded",
  detectSpa: false,
  staticTimeout: 1500,
  spaTimeout: 3000,
  timeout: 7000,
};

export function truncateContent(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  let truncated = text.slice(0, maxLength);

  const lastPara = truncated.lastIndexOf("\n\n");
  if (lastPara > maxLength * 0.7) {
    truncated = truncated.slice(0, lastPara);
  } else {
    const lastSpace = truncated.lastIndexOf(" ");
    if (lastSpace > maxLength * 0.8) {
      truncated = truncated.slice(0, lastSpace);
    }
  }

  return truncated.trimEnd() + "\n\n[… truncated]";
}
