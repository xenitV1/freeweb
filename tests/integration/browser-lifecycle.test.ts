import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { browserManager } from "../../src/browser.js";

describe("Browser Lifecycle Integration", () => {
  beforeAll(async () => {
    await browserManager.launch();
  });

  afterAll(async () => {
    await browserManager.close();
  });

  describe("Context management", () => {
    it("creates and closes a context", async () => {
      const ctxId = `test_${Date.now()}_1`;
      const ctx = await browserManager.createContext(ctxId);
      expect(ctx).toBeDefined();

      const page = await ctx.newPage();
      expect(page).toBeDefined();
      await page.close();

      await browserManager.closeContext(ctxId);
    });

    it("returns same context for same ID", async () => {
      const ctxId = `test_${Date.now()}_2`;
      const ctx1 = await browserManager.createContext(ctxId);
      const ctx2 = await browserManager.createContext(ctxId);
      expect(ctx1).toBe(ctx2);
      await browserManager.closeContext(ctxId);
    });

    it("handles closeContext for non-existent ID gracefully", async () => {
      await expect(browserManager.closeContext("nonexistent")).resolves.toBeUndefined();
    });
  });

  describe("openPage", () => {
    it("opens a page within a context", async () => {
      const ctxId = `test_${Date.now()}_3`;
      const page = await browserManager.openPage(ctxId);

      await page.goto("data:text/html,<h1>Test</h1>", { waitUntil: "domcontentloaded" }).catch(() => {});
      const title = await page.title();
      expect(title).toBeDefined();

      await browserManager.closeContext(ctxId);
    });
  });

  describe("ISSUE: No browser crash recovery", () => {
    it("browser remains marked as non-null after close — demonstrates the bug", async () => {
      const browser = await browserManager.launch();
      expect(browser).toBeDefined();
      expect(browser.isConnected()).toBe(true);

      await browserManager.close();

      const browserField = (browserManager as unknown as { browser: unknown }).browser;
      expect(browserField).toBeNull();
    });

    it("re-launches browser after close", async () => {
      const browser = await browserManager.launch();
      expect(browser.isConnected()).toBe(true);
    });
  });

  describe("ISSUE: Context leak when page operations throw", () => {
    it("demonstrates that context is not cleaned up on error without try/finally", async () => {
      const ctxId = `test_leak_${Date.now()}`;
      const contextsBefore = (browserManager as unknown as { contexts: Map<string, unknown> }).contexts.size;

      const page = await browserManager.openPage(ctxId);
      await page.goto("data:text/html,<h1>Test</h1>", { waitUntil: "domcontentloaded" }).catch(() => {});

      try {
        await page.evaluate(() => {
          throw new Error("Simulated extraction error");
        });
      } catch {
        // This error is expected — simulates what happens in real tools
      }

      const contextsAfterError = (browserManager as unknown as { contexts: Map<string, unknown> }).contexts.size;
      expect(contextsAfterError).toBe(contextsBefore + 1);

      await browserManager.closeContext(ctxId);

      const contextsAfterCleanup = (browserManager as unknown as { contexts: Map<string, unknown> }).contexts.size;
      expect(contextsAfterCleanup).toBe(contextsBefore);
    });
  });
});
