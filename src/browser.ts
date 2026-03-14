import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

class BrowserManager {
  private browser: Browser | null = null;
  private contexts: Map<string, BrowserContext> = new Map();

  async launch(): Promise<Browser> {
    if (this.browser) return this.browser;
    this.browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    return this.browser;
  }

  /** Yeni bir sekme context'i aç (tek browser, izole çerez/önbellek) */
  async createContext(id: string): Promise<BrowserContext> {
    if (this.contexts.has(id)) return this.contexts.get(id)!;
    const browser = await this.launch();
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1920, height: 1080 },
      locale: "tr-TR",
      timezoneId: "Europe/Istanbul",
    });
    this.contexts.set(id, ctx);
    return ctx;
  }

  /** Context'te yeni sekme aç */
  async openPage(contextId: string, url?: string): Promise<Page> {
    const ctx = await this.createContext(contextId);
    const page = await ctx.newPage();
    if (url) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    }
    return page;
  }

  /** Context'teki tüm sekmeleri kapat */
  async closeContext(id: string): Promise<void> {
    const ctx = this.contexts.get(id);
    if (ctx) {
      await ctx.close().catch(() => {});
      this.contexts.delete(id);
    }
  }

  /** Tüm browser'ı kapat */
  async close(): Promise<void> {
    for (const id of this.contexts.keys()) {
      await this.closeContext(id);
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }
}

export const browserManager = new BrowserManager();
