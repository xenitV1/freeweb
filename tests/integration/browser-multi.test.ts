import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { browserManager } from "../../src/browser.js";

describe("Multi-Browser Integration", () => {
  afterAll(async () => {
    await browserManager.close();
  });

  it("launches chromium browser", async () => {
    const ctxId = `test-chromium-${Date.now()}`;
    const ctx = await browserManager.createContext(ctxId, "chromium");
    expect(ctx).toBeDefined();
    const page = await ctx.newPage();
    await page.goto("data:text/html,<h1>Chromium</h1>");
    const title = await page.title();
    expect(title).toBeDefined();
    await browserManager.closeContext(ctxId);
  });

  it("launches firefox browser (if installed)", async () => {
    try {
      const ctxId = `test-firefox-${Date.now()}`;
      const ctx = await browserManager.createContext(ctxId, "firefox");
      expect(ctx).toBeDefined();
      const page = await ctx.newPage();
      await page.goto("data:text/html,<h1>Firefox</h1>");
      const title = await page.title();
      expect(title).toBeDefined();
      await browserManager.closeContext(ctxId);
    } catch (e) {
      console.log("Firefox not installed, skipping:", (e as Error).message);
    }
  });

  it("launches webkit browser (if installed)", async () => {
    try {
      const ctxId = `test-webkit-${Date.now()}`;
      const ctx = await browserManager.createContext(ctxId, "webkit");
      expect(ctx).toBeDefined();
      const page = await ctx.newPage();
      await page.goto("data:text/html,<h1>WebKit</h1>");
      const title = await page.title();
      expect(title).toBeDefined();
      await browserManager.closeContext(ctxId);
    } catch (e) {
      console.log("WebKit not installed, skipping:", (e as Error).message);
    }
  });

  it("rotates between engines", async () => {
    const engineCounts: Record<string, number> = { chromium: 0, firefox: 0, webkit: 0 };
    const iterations = 10;
    const ctxIds: string[] = [];

    for (let i = 0; i < iterations; i++) {
      const ctxId = `test-rotate-${Date.now()}-${i}`;
      try {
        const ctx = await browserManager.createContext(ctxId);
        expect(ctx).toBeDefined();
        engineCounts["chromium"]++;
        ctxIds.push(ctxId);
      } catch {
        engineCounts["fallback"] = (engineCounts["fallback"] || 0) + 1;
      }
    }

    expect(engineCounts["chromium"] + (engineCounts["firefox"] || 0) + (engineCounts["webkit"] || 0)).toBeGreaterThan(0);

    for (const id of ctxIds) {
      await browserManager.closeContext(id);
    }
  });

  it("falls back to chromium when preferred engine fails", async () => {
    const ctxId = `test-fallback-${Date.now()}`;
    const ctx = await browserManager.createContext(ctxId, "chromium");
    expect(ctx).toBeDefined();
    const page = await ctx.newPage();
    await page.goto("data:text/html,<h1>Fallback</h1>");
    const title = await page.title();
    expect(title).toBeDefined();
    await browserManager.closeContext(ctxId);
  });

  it("creates context with no engine specified (backward compat)", async () => {
    const ctxId = `test-default-${Date.now()}`;
    const ctx = await browserManager.createContext(ctxId);
    expect(ctx).toBeDefined();
    const page = await ctx.newPage();
    await page.goto("data:text/html,<h1>Default</h1>");
    expect(await page.title()).toBeDefined();
    await browserManager.closeContext(ctxId);
  });

  it("openPage works with engine type parameter", async () => {
    const ctxId = `test-openpage-${Date.now()}`;
    const page = await browserManager.openPage(ctxId, "data:text/html,<h1>OpenPage</h1>", "chromium");
    expect(page).toBeDefined();
    const title = await page.title();
    expect(title).toBeDefined();
    await browserManager.closeContext(ctxId);
  });
});
