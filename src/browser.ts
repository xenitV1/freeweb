import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

class BrowserManager {
  private browser: Browser | null = null;
  private contexts: Map<string, BrowserContext> = new Map();
  private launchPromise: Promise<Browser> | null = null;

  async launch(): Promise<Browser> {
    if (this.browser) return this.browser;
    if (this.launchPromise) return this.launchPromise;

    this.launchPromise = (async () => {
      const launched = await chromium.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--disable-gpu",
          "--disable-blink-features=AutomationControlled",
        ],
      });

      launched.on("disconnected", () => {
        this.browser = null;
        this.launchPromise = null;
        for (const ctx of this.contexts.values()) {
          ctx.close().catch(() => {});
        }
        this.contexts.clear();
      });

      this.browser = launched;
      return launched;
    })();

    return this.launchPromise;
  }

  /** Create stealth context - make bot detection harder */
  async createContext(id: string): Promise<BrowserContext> {
    if (this.contexts.has(id)) return this.contexts.get(id)!;
    const browser = await this.launch();

    // Random viewport dimensions (realistic range)
    const widths = [1366, 1440, 1536, 1920, 2560];
    const heights = [768, 800, 900, 1080, 1440];
    const randomWidth = widths[Math.floor(Math.random() * widths.length)];
    const randomHeight = heights[Math.floor(Math.random() * heights.length)];

    // Realistic user-agents
    const userAgents = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
    ];
    const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];

    const ctx = await browser.newContext({
      userAgent: randomUA,
      viewport: { width: randomWidth, height: randomHeight },
      locale: "en-US",
      timezoneId: "America/New_York",
      // Prevent WebRTC leak
      permissions: ["geolocation"],
      // Randomize canvas fingerprint
      colorScheme: Math.random() > 0.5 ? "light" : "dark",
      // HTTP headers
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "max-age=0",
        "Sec-Ch-Ua": '"Chromium";v="131", "Not_A Brand";v="24"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      },
    });

    // Inject stealth scripts
    await ctx.addInitScript(() => {
      // Prevent WebDriver detection
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });

      // Spoof plugins
      Object.defineProperty(navigator, "plugins", {
        get: () => [
          { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer" },
          { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai" },
          { name: "Native Client", filename: "internal-nacl-plugin" },
        ],
      });

      // Spoof languages
      Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });

      // Spoof platform
      Object.defineProperty(navigator, "platform", { get: () => "Win32" });

      // Spoof hardware concurrency
      Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });

      // Spoof device memory
      Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });

      // Spoof Chrome object
      (window as unknown as Record<string, unknown>).chrome = { runtime: {} };

      // Spoof permission query
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters: PermissionDescriptor) => {
        if (parameters.name === "notifications") {
          return Promise.resolve({ state: "granted" } as PermissionStatus);
        }
        return originalQuery.call(window.navigator.permissions, parameters);
      };

      // Canvas fingerprint noise
      const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function (type?: string) {
        if (type === "image/png" && this.width === 220 && this.height === 30) {
          // Fingerprint canvas detection - add noise
          const ctx = this.getContext("2d");
          if (ctx) {
            const imageData = ctx.getImageData(0, 0, this.width, this.height);
            for (let i = 0; i < imageData.data.length; i += 4) {
              imageData.data[i] ^= Math.random() * 2;
            }
            ctx.putImageData(imageData, 0, 0);
          }
        }
        return originalToDataURL.apply(this, [type] as [string?]);
      };
    });

    this.contexts.set(id, ctx);
    return ctx;
  }

  /** Open new tab in context - with random delay */
  async openPage(contextId: string, url?: string): Promise<Page> {
    const ctx = await this.createContext(contextId);
    const page = await ctx.newPage();

    // Additional stealth before page load
    await page.addInitScript(() => {
      // Spoof screen resolution
      Object.defineProperty(screen, "width", { get: () => 1920 });
      Object.defineProperty(screen, "height", { get: () => 1080 });
      Object.defineProperty(screen, "availWidth", { get: () => 1920 });
      Object.defineProperty(screen, "availHeight", { get: () => 1040 });
    });

    if (url) {
      // Random delay (human-like)
      await this.randomDelay(500, 1500);
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null);
      if (!response) {
        // Page load failed but we continue — page may still be usable
      }
    }
    return page;
  }

  /** Random delay */
  private randomDelay(min: number, max: number): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  /** Close all tabs in context */
  async closeContext(id: string): Promise<void> {
    const ctx = this.contexts.get(id);
    if (ctx) {
      await ctx.close().catch(() => {});
      this.contexts.delete(id);
    }
  }

  /** Close entire browser */
  async close(): Promise<void> {
    for (const id of this.contexts.keys()) {
      await this.closeContext(id);
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
    this.launchPromise = null;
  }
}

export const browserManager = new BrowserManager();
