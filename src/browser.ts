import { existsSync } from "node:fs";
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type Page,
  type BrowserType as PwBrowserType,
} from "playwright";

type EngineType = "chromium" | "firefox" | "webkit";

interface EngineInstance {
  browser: Browser | null;
  launchPromise: Promise<Browser> | null;
  lastUsed: number;
  unavailableUntil: number;
  unavailableReason: string | null;
}

const MISSING_BINARY_PATTERN = /Executable doesn't exist|playwright install/i;

/** Maps a raw Playwright launch error to an actionable message. */
export function friendlyLaunchError(engine: EngineType, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (MISSING_BINARY_PATTERN.test(message)) {
    return `${engine} browser binaries are not installed. Run: npx playwright install ${engine}`;
  }
  return `Failed to launch ${engine} browser: ${message}`;
}

/** True when the engine's executable is known to be absent (cheap pre-check). */
export function executableMissing(launcher: PwBrowserType): boolean {
  try {
    return !existsSync(launcher.executablePath());
  } catch {
    return false;
  }
}

/** Filters out engines still inside their unavailability cooldown. */
export function pickAvailableEngines(
  enabled: EngineType[],
  states: { unavailableUntil: number; unavailableReason: string | null }[],
  now: number,
): EngineType[] {
  const available = enabled.filter((_, i) => {
    const state = states[i];
    return !state.unavailableReason || now >= state.unavailableUntil;
  });
  return available.length > 0 ? available : enabled;
}

const PROFILES: Record<
  EngineType,
  {
    userAgents: string[];
    extraHTTPHeaders: Record<string, string>;
    viewportWidths: number[];
    viewportHeights: number[];
    launchArgs: string[];
  }
> = {
  chromium: {
    userAgents: [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    ],
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
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
    viewportWidths: [1366, 1440, 1536, 1920, 2560],
    viewportHeights: [768, 800, 900, 1080, 1440],
    launchArgs: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
      "--disable-blink-features=AutomationControlled",
    ],
  },
  firefox: {
    userAgents: [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:135.0) Gecko/20100101 Firefox/135.0",
    ],
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.5",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
    },
    viewportWidths: [1366, 1440, 1536, 1920],
    viewportHeights: [768, 800, 900, 1080],
    launchArgs: [] as string[],
  },
  webkit: {
    userAgents: [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15",
    ],
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en-us",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Upgrade-Insecure-Requests": "1",
    },
    viewportWidths: [1440, 1536, 1680, 1920],
    viewportHeights: [900, 1050, 1080],
    launchArgs: [] as string[],
  },
};

const LAUNCHERS: Record<EngineType, PwBrowserType> = {
  chromium,
  firefox,
  webkit,
};

class BrowserManager {
  private engines: Map<EngineType, EngineInstance> = new Map();
  private contexts: Map<string, BrowserContext> = new Map();
  private contextEngineMap: Map<string, EngineType> = new Map();
  private browser: Browser | null = null;
  private launchPromise: Promise<Browser> | null = null;

  private readonly ENGINE_WEIGHTS: Record<EngineType, number> = {
    chromium: 5,
    firefox: 3,
    webkit: 2,
  };

  private readonly IDLE_TIMEOUT_MS = 5 * 60 * 1000;

  /** How long an engine that failed to launch is skipped before retrying. */
  private readonly UNAVAILABLE_COOLDOWN_MS = 60 * 1000;

  constructor() {
    const timer = setInterval(() => this.cleanupIdleEngines(), 60_000);
    timer.unref();
  }

  private getEnabledEngines(): EngineType[] {
    const envVal = process.env.FREEWEB_ENGINES;
    if (!envVal) return ["chromium", "firefox", "webkit"];
    return envVal
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s): s is EngineType =>
        ["chromium", "firefox", "webkit"].includes(s),
      );
  }

  private getEngineInstance(type: EngineType): EngineInstance {
    let instance = this.engines.get(type);
    if (!instance) {
      instance = {
        browser: null,
        launchPromise: null,
        lastUsed: 0,
        unavailableUntil: 0,
        unavailableReason: null,
      };
      this.engines.set(type, instance);
    }
    return instance;
  }

  async launchEngine(type: EngineType): Promise<Browser> {
    const instance = this.getEngineInstance(type);
    if (instance.browser) return instance.browser;
    if (instance.launchPromise) return instance.launchPromise;

    // Fast-fail while a recent launch failure is still cooling down, so a
    // missing binary doesn't cost a launch attempt (and a raw error) per call.
    if (
      instance.unavailableReason &&
      Date.now() < instance.unavailableUntil
    ) {
      throw new Error(instance.unavailableReason);
    }
    instance.unavailableReason = null;

    instance.launchPromise = (async () => {
      const launcher = LAUNCHERS[type];
      const profile = PROFILES[type];
      let launched: Browser;
      try {
        if (executableMissing(launcher)) {
          throw new Error(
            `${type} browser executable not found at ${launcher.executablePath()}. Run: npx playwright install ${type}`,
          );
        }
        launched = await launcher.launch({
          headless: true,
          args: profile.launchArgs,
        });
      } catch (e) {
        // Clear the rejected promise so later calls retry after the cooldown
        // instead of reusing the rejection forever.
        instance.launchPromise = null;
        instance.unavailableUntil =
          Date.now() + this.UNAVAILABLE_COOLDOWN_MS;
        instance.unavailableReason = friendlyLaunchError(type, e);
        throw new Error(instance.unavailableReason);
      }

      launched.on("disconnected", () => {
        instance.browser = null;
        instance.launchPromise = null;
        for (const [ctxId, engine] of this.contextEngineMap.entries()) {
          if (engine === type) {
            this.contexts.get(ctxId)?.close().catch(() => {});
            this.contexts.delete(ctxId);
            this.contextEngineMap.delete(ctxId);
          }
        }
      });

      instance.browser = launched;
      instance.lastUsed = Date.now();
      return launched;
    })();

    return instance.launchPromise;
  }

  selectEngine(preferred?: EngineType): EngineType {
    if (preferred) return preferred;
    const enabled = this.getEnabledEngines();
    if (enabled.length === 0) return "chromium";
    if (enabled.length === 1) return enabled[0];
    const pool = pickAvailableEngines(
      enabled,
      enabled.map((e) => this.getEngineInstance(e)),
      Date.now(),
    );
    const totalWeight = pool.reduce(
      (sum, e) => sum + this.ENGINE_WEIGHTS[e],
      0,
    );
    let random = Math.random() * totalWeight;
    for (const engine of pool) {
      random -= this.ENGINE_WEIGHTS[engine];
      if (random <= 0) return engine;
    }
    return pool[pool.length - 1];
  }

  private getStealthScript(type: EngineType): string {
    switch (type) {
      case "chromium":
        return `(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
          Object.defineProperty(navigator, 'plugins', {
            get: () => [
              { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
              { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
              { name: 'Native Client', filename: 'internal-nacl-plugin' },
            ],
          });
          Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
          Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
          Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
          Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
          window.chrome = { runtime: {} };
          const originalQuery = window.navigator.permissions.query;
          window.navigator.permissions.query = (parameters) => {
            if (parameters.name === 'notifications') {
              return Promise.resolve({ state: 'granted' });
            }
            return originalQuery.call(window.navigator.permissions, parameters);
          };
          const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
          HTMLCanvasElement.prototype.toDataURL = function (type) {
            if (type === 'image/png' && this.width === 220 && this.height === 30) {
              const ctx = this.getContext('2d');
              if (ctx) {
                const imageData = ctx.getImageData(0, 0, this.width, this.height);
                for (let i = 0; i < imageData.data.length; i += 4) {
                  imageData.data[i] ^= Math.random() * 2;
                }
                ctx.putImageData(imageData, 0, 0);
              }
            }
            return originalToDataURL.apply(this, [type]);
          };
        })()`;
      case "firefox":
        return `(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
          Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
          Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
          Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
          const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
          HTMLCanvasElement.prototype.toDataURL = function (type) {
            if (type === 'image/png' && this.width === 220 && this.height === 30) {
              const ctx = this.getContext('2d');
              if (ctx) {
                const imageData = ctx.getImageData(0, 0, this.width, this.height);
                for (let i = 0; i < imageData.data.length; i += 4) {
                  imageData.data[i] ^= Math.random() * 2;
                }
                ctx.putImageData(imageData, 0, 0);
              }
            }
            return originalToDataURL.apply(this, [type]);
          };
        })()`;
      case "webkit":
        return `(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
          Object.defineProperty(navigator, 'languages', { get: () => ['en-US'] });
          Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
          Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
          const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
          HTMLCanvasElement.prototype.toDataURL = function (type) {
            if (type === 'image/png' && this.width === 220 && this.height === 30) {
              const ctx = this.getContext('2d');
              if (ctx) {
                const imageData = ctx.getImageData(0, 0, this.width, this.height);
                for (let i = 0; i < imageData.data.length; i += 4) {
                  imageData.data[i] ^= Math.random() * 2;
                }
                ctx.putImageData(imageData, 0, 0);
              }
            }
            return originalToDataURL.apply(this, [type]);
          };
        })()`;
    }
  }

  async createContext(
    id: string,
    engineType?: EngineType,
  ): Promise<BrowserContext> {
    if (this.contexts.has(id)) return this.contexts.get(id)!;

    const selectedEngine = this.selectEngine(engineType);
    let browser: Browser;
    try {
      browser = await this.launchEngine(selectedEngine);
    } catch (e) {
      if (selectedEngine !== "chromium") {
        browser = await this.launchEngine("chromium");
        return this.createContextWithEngine(id, "chromium", browser);
      }
      throw e instanceof Error
        ? e
        : new Error(`Failed to launch ${selectedEngine} browser`);
    }

    return this.createContextWithEngine(id, selectedEngine, browser);
  }

  private async createContextWithEngine(
    id: string,
    engine: EngineType,
    browser: Browser,
  ): Promise<BrowserContext> {
    if (this.contexts.has(id)) return this.contexts.get(id)!;

    const profile = PROFILES[engine];
    const randomUA =
      profile.userAgents[
        Math.floor(Math.random() * profile.userAgents.length)
      ];
    const randomWidth =
      profile.viewportWidths[
        Math.floor(Math.random() * profile.viewportWidths.length)
      ];
    const randomHeight =
      profile.viewportHeights[
        Math.floor(Math.random() * profile.viewportHeights.length)
      ];

    const ctx = await browser.newContext({
      userAgent: randomUA,
      viewport: { width: randomWidth, height: randomHeight },
      locale: "en-US",
      timezoneId: "America/New_York",
      permissions: ["geolocation"],
      colorScheme: Math.random() > 0.5 ? "light" : "dark",
      extraHTTPHeaders: profile.extraHTTPHeaders,
    });

    await ctx.addInitScript(this.getStealthScript(engine));

    this.contexts.set(id, ctx);
    this.contextEngineMap.set(id, engine);
    this.getEngineInstance(engine).lastUsed = Date.now();
    return ctx;
  }

  async openPage(
    contextId: string,
    url?: string,
    engineType?: EngineType,
  ): Promise<Page> {
    const ctx = await this.createContext(contextId, engineType);
    const page = await ctx.newPage();

    await page.addInitScript(() => {
      Object.defineProperty(screen, "width", { get: () => 1920 });
      Object.defineProperty(screen, "height", { get: () => 1080 });
      Object.defineProperty(screen, "availWidth", { get: () => 1920 });
      Object.defineProperty(screen, "availHeight", { get: () => 1040 });
    });

    if (url) {
      await this.randomDelay(500, 1500);
      await page
        .goto(url, { waitUntil: "domcontentloaded", timeout: 7000 })
        .catch(() => null);
    }
    return page;
  }

  private randomDelay(min: number, max: number): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  async closeContext(id: string): Promise<void> {
    const ctx = this.contexts.get(id);
    if (ctx) {
      await ctx.close().catch(() => {});
      this.contexts.delete(id);
      this.contextEngineMap.delete(id);
    }
  }

  async close(): Promise<void> {
    for (const id of [...this.contexts.keys()]) {
      await this.closeContext(id);
    }
    for (const instance of this.engines.values()) {
      if (instance.browser) {
        await instance.browser.close().catch(() => {});
        instance.browser = null;
        instance.launchPromise = null;
      }
    }
    this.engines.clear();
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
    this.launchPromise = null;
  }

  cleanupIdleEngines(): void {
    const now = Date.now();
    for (const [type, instance] of this.engines) {
      if (
        instance.browser &&
        instance.lastUsed > 0 &&
        now - instance.lastUsed > this.IDLE_TIMEOUT_MS
      ) {
        let hasActiveContexts = false;
        for (const engine of this.contextEngineMap.values()) {
          if (engine === type) {
            hasActiveContexts = true;
            break;
          }
        }
        if (!hasActiveContexts) {
          instance.browser.close().catch(() => {});
          instance.browser = null;
          instance.launchPromise = null;
        }
      }
    }
  }

  async launch(): Promise<Browser> {
    if (this.browser) return this.browser;
    if (this.launchPromise) return this.launchPromise;

    this.launchPromise = (async () => {
      let launched: Browser;
      try {
        launched = await chromium.launch({
          headless: true,
          args: PROFILES.chromium.launchArgs,
        });
      } catch (e) {
        this.launchPromise = null;
        throw new Error(friendlyLaunchError("chromium", e));
      }

      launched.on("disconnected", () => {
        this.browser = null;
        this.launchPromise = null;
        for (const ctx of this.contexts.values()) {
          ctx.close().catch(() => {});
        }
        this.contexts.clear();
        this.contextEngineMap.clear();
      });

      this.browser = launched;
      return launched;
    })();

    return this.launchPromise;
  }
}

export const browserManager = new BrowserManager();
