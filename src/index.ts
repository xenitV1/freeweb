import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { browserManager } from "./browser.js";
import { extractContent, extractLinks, parseSearchResults, genContextId } from "./utils.js";

const server = new McpServer({
  name: "freeweb",
  version: "1.0.0",
});

// ── TOOL: web_search ──────────────────────────────────────────────
server.tool(
  "web_search",
  "Web'de arama yap, sonuçları listeler. Arama motoru (Google/Bing/DuckDuckGo) üzerinden arar.",
  {
    query: z.string().describe("Aranacak terim"),
    engine: z.enum(["google", "bing", "duckduckgo"]).optional().default("google").describe("Arama motoru"),
    maxResults: z.number().min(1).max(20).optional().default(10).describe("Maksimum sonuç sayısı"),
  },
  async ({ query, engine, maxResults }) => {
    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);

    const engines: Record<string, string> = {
      google: `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${maxResults}&hl=tr`,
      bing: `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${maxResults}&setlang=tr`,
      duckduckgo: `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    };

    await page.goto(engines[engine], { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    // Bot koruması atlatmak için kısa bekle
    await page.waitForTimeout(2000);

    const results = await parseSearchResults(page);
    await browserManager.closeContext(ctxId);

    if (results.length === 0) {
      // Arama sonuçları parse edilemezse sayfa içeriğini döndür
      const content = await extractContent(page);
      return {
        content: [{ type: "text" as const, text: `Arama sonuçları parse edilemedi. Sayfa içeriği:\n\n${content.text.slice(0, 5000)}` }],
      };
    }

    const formatted = results.slice(0, maxResults).map((r, i) => `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet}`).join("\n\n");
    return {
      content: [{ type: "text" as const, text: formatted }],
    };
  }
);

// ── TOOL: browse_page ─────────────────────────────────────────────
server.tool(
  "browse_page",
  "Belirli bir URL'ye git ve sayfanın içeriğini oku. Herhangi bir websitesine erişim sağlar.",
  {
    url: z.string().url().describe("Ziyaret edilecek URL"),
    waitFor: z.enum(["domcontentloaded", "load", "networkidle"]).optional().default("domcontentloaded").describe("Bekleme stratejisi"),
  },
  async ({ url, waitFor }) => {
    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);

    await page.goto(url, { waitUntil: waitFor, timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500); // JS render için

    const content = await extractContent(page);
    await browserManager.closeContext(ctxId);

    const truncated = content.text.length > 15000 ? content.text.slice(0, 15000) + "\n\n[... içerik kesildi, tam metin için tekrar isteyin]" : content.text;

    return {
      content: [{ type: "text" as const, text: `# ${content.title}\n\n${truncated}` }],
    };
  }
);

// ── TOOL: get_page_links ──────────────────────────────────────────
server.tool(
  "get_page_links",
  "Bir sayfadaki tüm linkleri çıkarır. İçerik keşfi ve site haritalama için kullanılır.",
  {
    url: z.string().url().describe("Linklerin çıkarılacağı URL"),
  },
  async ({ url }) => {
    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1000);

    const links = await extractLinks(page);
    await browserManager.closeContext(ctxId);

    const formatted = links.slice(0, 100).map((l, i) => `[${i + 1}] ${l.text}\n    ${l.href}`).join("\n");
    return {
      content: [{ type: "text" as const, text: formatted || "Link bulunamadı." }],
    };
  }
);

// ── TOOL: parallel_search ─────────────────────────────────────────
server.tool(
  "parallel_search",
  "Birden çok sorguyu aynı anda paralel olarak arar. Tek browser, çoklu sekme kullanır.",
  {
    queries: z.array(z.string()).min(1).max(5).describe("Paralel arama sorguları (max 5)"),
    engine: z.enum(["google", "bing", "duckduckgo"]).optional().default("google").describe("Arama motoru"),
    maxResults: z.number().min(1).max(10).optional().default(5).describe("Sorgu başına maksimum sonuç"),
  },
  async ({ queries, engine, maxResults }) => {
    // Her sorgu için aynı anda sekme aç — tek browser
    const ctxId = genContextId();
    const tasks = queries.map(async (query) => {
      const page = await browserManager.openPage(ctxId);
      let url: string;
      if (engine === "bing") {
        url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${maxResults}&setlang=tr`;
      } else if (engine === "duckduckgo") {
        url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      } else {
        url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${maxResults}&hl=tr`;
      }

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000);

      const results = await parseSearchResults(page);
      await page.close();

      const formatted = results.slice(0, maxResults).map((r, i) => `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet}`).join("\n");
      return `## Sorgu: "${query}"\n${formatted || "Sonuç bulunamadı."}`;
    });

    const allResults = await Promise.all(tasks);
    await browserManager.closeContext(ctxId);

    return {
      content: [{ type: "text" as const, text: allResults.join("\n\n---\n\n") }],
    };
  }
);

// ── TOOL: parallel_browse ─────────────────────────────────────────
server.tool(
  "parallel_browse",
  "Birden çok URL'yi aynı anda paralel olarak ziyaret eder ve içeriklerini çeker.",
  {
    urls: z.array(z.string().url()).min(1).max(5).describe("Ziyaret edilecek URL'ler (max 5)"),
  },
  async ({ urls }) => {
    const ctxId = genContextId();
    const tasks = urls.map(async (url) => {
      const page = await browserManager.openPage(ctxId);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1500);

      const content = await extractContent(page);
      await page.close();

      const truncated = content.text.slice(0, 5000);
      return `## ${content.title}\nKaynak: ${url}\n\n${truncated}`;
    });

    const allResults = await Promise.all(tasks);
    await browserManager.closeContext(ctxId);

    return {
      content: [{ type: "text" as const, text: allResults.join("\n\n---\n\n") }],
    };
  }
);

// ── TOOL: screenshot ──────────────────────────────────────────────
server.tool(
  "screenshot",
  "Bir sayfanın ekran görüntüsünü alır (base64 PNG). Görsel içerik incelemesi için.",
  {
    url: z.string().url().describe("Ekran görüntüsü alınacak URL"),
    fullPage: z.boolean().optional().default(false).describe("Tam sayfa mı yoksa viewport mu"),
  },
  async ({ url, fullPage }) => {
    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const buffer = await page.screenshot({ fullPage, type: "png" });
    await browserManager.closeContext(ctxId);

    return {
      content: [{ type: "image" as const, data: buffer.toString("base64"), mimeType: "image/png" }],
    };
  }
);

// ── SERVER START ──────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);

// Graceful shutdown
process.on("SIGINT", async () => {
  await browserManager.close();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await browserManager.close();
  process.exit(0);
});
