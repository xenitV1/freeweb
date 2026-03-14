import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { browserManager } from "./browser.js";
import { extractContent, extractLinks, parseSearchResults, genContextId } from "./utils.js";
import { Logger, logSession } from "./logger.js";

const server = new McpServer({
  name: "freeweb",
  version: "1.0.0",
});

// ── TOOL: web_search ──────────────────────────────────────────────
server.tool(
  "web_search",
  "Web'de arama yap. DuckDuckGo varsayılan (bot koruması az). Google/Bing de seçilebilir.",
  {
    query: z.string().describe("Aranacak terim"),
    engine: z.enum(["duckduckgo", "google", "bing"]).optional().default("duckduckgo").describe("Arama motoru (önerilen: duckduckgo)"),
    maxResults: z.number().min(1).max(20).optional().default(10).describe("Maksimum sonuç sayısı"),
  },
  async ({ query, engine, maxResults }) => {
    const log = new Logger("web_search");
    log.info("Starting search", { query, engine, maxResults });

    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);
    log.debug("Browser context created", { ctxId });

    const engines: Record<string, string> = {
      duckduckgo: `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      google: `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${maxResults}&hl=en`,
      bing: `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${maxResults}&setlang=en`,
    };

    const url = engines[engine];
    log.logUrlVisit(url, "navigating");

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => {
      log.error("Navigation failed", e);
    });
    log.logUrlVisit(url, "loaded");

    await page.waitForTimeout(2500);
    log.debug("Wait completed", { waitMs: 2500 });

    // Sayfa HTML'ini al (debug için)
    const html = await page.content();
    log.dumpData("Page HTML", { url, htmlLength: html.length, htmlPreview: html.slice(0, 3000) });

    const results = await parseSearchResults(page);
    log.logSearchResults(engine, query, results);

    if (results.length === 0) {
      const content = await extractContent(page);
      log.logPageContent(url, {
        title: content.title,
        textLength: content.text.length,
        preview: content.text,
      });

      await browserManager.closeContext(ctxId);

      // Bot koruması tespit
      if (content.text.includes("robot") || content.text.includes("unusual traffic") || content.text.includes("CAPTCHA") || content.text.includes("error")) {
        log.warn("Bot protection detected", { detectedText: content.text.slice(0, 500) });
        const result = {
          content: [{ type: "text" as const, text: `⚠️ ${engine} bot koruması aktif. DuckDuckGo veya site_search kullanmayı deneyin.\n\nDetay: ${content.text.slice(0, 500)}` }],
        };
        log.finish(result);
        return result;
      }

      log.warn("No results parsed, returning raw content");
      const result = {
        content: [{ type: "text" as const, text: `Sonuç bulunamadı. Sayfa içeriği:\n\n${content.text.slice(0, 3000)}` }],
      };
      log.finish(result);
      return result;
    }

    await browserManager.closeContext(ctxId);
    const formatted = results
      .slice(0, maxResults)
      .map((r, i) => `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet}`)
      .join("\n\n");

    const result = { content: [{ type: "text" as const, text: formatted }] };
    log.finish(result);
    return result;
  }
);

// ── TOOL: site_search ─────────────────────────────────────────────
server.tool(
  "site_search",
  "Belirli bir site içinde arama yapar.",
  {
    site: z.string().describe("Aranacak site (örn: github.com)"),
    query: z.string().describe("Aranacak terim"),
    maxResults: z.number().min(1).max(10).optional().default(5).describe("Maksimum sonuç"),
  },
  async ({ site, query, maxResults }) => {
    const log = new Logger("site_search");
    log.info("Starting site search", { site, query, maxResults });

    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);

    const url = `https://duckduckgo.com/html/?q=site%3A${encodeURIComponent(site)}+${encodeURIComponent(query)}`;
    log.logUrlVisit(url, "navigating");

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => log.error("Navigation failed", e));
    await page.waitForTimeout(2000);

    const html = await page.content();
    log.dumpData("Page HTML", { url, htmlLength: html.length, htmlPreview: html.slice(0, 2000) });

    const results = await parseSearchResults(page);
    log.logSearchResults("duckduckgo", `site:${site} ${query}`, results);

    await browserManager.closeContext(ctxId);

    if (results.length === 0) {
      const result = { content: [{ type: "text" as const, text: `${site} içinde "${query}" için sonuç bulunamadı.` }] };
      log.finish(result);
      return result;
    }

    const formatted = results
      .slice(0, maxResults)
      .map((r, i) => `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet}`)
      .join("\n\n");

    const result = { content: [{ type: "text" as const, text: formatted }] };
    log.finish(result);
    return result;
  }
);

// ── TOOL: github_search ───────────────────────────────────────────
server.tool(
  "github_search",
  "GitHub'da repo, kod veya issue arar.",
  {
    query: z.string().describe("Aranacak terim"),
    type: z.enum(["repos", "code", "issues"]).optional().default("repos").describe("Arama türü"),
    maxResults: z.number().min(1).max(10).optional().default(5).describe("Maksimum sonuç"),
  },
  async ({ query, type, maxResults }) => {
    const log = new Logger("github_search");
    log.info("Starting GitHub search", { query, type, maxResults });

    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);

    const typeMap: Record<string, string> = {
      repos: "",
      code: "code&type=Code",
      issues: "issues&type=Issues",
    };

    const url = `https://github.com/search?q=${encodeURIComponent(query)}&${typeMap[type]}`;
    log.logUrlVisit(url, "navigating");

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => log.error("Navigation failed", e));
    await page.waitForTimeout(3000);

    const html = await page.content();
    log.dumpData("GitHub Page HTML", { url, htmlLength: html.length, htmlPreview: html.slice(0, 3000) });

    // GitHub search results parsing
    const results = await page.evaluate(() => {
      const items: { title: string; url: string; snippet: string }[] = [];

      // Repo results
      document.querySelectorAll(".repo-list-item").forEach((item) => {
        const titleEl = item.querySelector("a.v-align-middle");
        const descEl = item.querySelector("p.col-9");
        if (titleEl) {
          items.push({
            title: titleEl.textContent?.trim() || "",
            url: `https://github.com${titleEl.getAttribute("href") || ""}`,
            snippet: descEl?.textContent?.trim() || "",
          });
        }
      });

      // Code results
      document.querySelectorAll(".code-list-item").forEach((item) => {
        const titleEl = item.querySelector("a.text-bold");
        if (titleEl) {
          items.push({
            title: titleEl.textContent?.trim() || "",
            url: `https://github.com${titleEl.getAttribute("href") || ""}`,
            snippet: item.textContent?.slice(0, 200) || "",
          });
        }
      });

      // Issue results
      document.querySelectorAll(".issue-list-item").forEach((item) => {
        const titleEl = item.querySelector("a.h4");
        if (titleEl) {
          items.push({
            title: titleEl.textContent?.trim() || "",
            url: `https://github.com${titleEl.getAttribute("href") || ""}`,
            snippet: item.querySelector(".markdown-body")?.textContent?.slice(0, 150) || "",
          });
        }
      });

      return items;
    });

    log.dumpData("Parsed Results", { resultCount: results.length, results: results.slice(0, 5) });
    log.logSearchResults("github", query, results);

    await browserManager.closeContext(ctxId);

    if (results.length === 0) {
      // Debug: sayfa içeriğini de al
      const content = await extractContent(page);
      log.warn("No GitHub results found", { pageContent: content.text.slice(0, 500) });
      const result = { content: [{ type: "text" as const, text: `GitHub'da "${query}" için sonuç bulunamadı.\n\nSayfa içeriği:\n${content.text.slice(0, 1000)}` }] };
      log.finish(result);
      return result;
    }

    const formatted = results
      .slice(0, maxResults)
      .map((r, i) => `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet}`)
      .join("\n\n");

    const result = { content: [{ type: "text" as const, text: formatted }] };
    log.finish(result);
    return result;
  }
);

// ── TOOL: github_repo_files ───────────────────────────────────────
server.tool(
  "github_repo_files",
  "Bir GitHub reposundaki dosya ve klasörleri listeler.",
  {
    owner: z.string().describe("Repo sahibi"),
    repo: z.string().describe("Repo adı"),
    path: z.string().optional().default("").describe("Klasör yolu"),
    branch: z.string().optional().default("main").describe("Branch adı"),
  },
  async ({ owner, repo, path, branch }) => {
    const log = new Logger("github_repo_files");
    log.info("Listing repo files", { owner, repo, path, branch });

    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);

    const url = `https://github.com/${owner}/${repo}/tree/${branch}/${path}`;
    log.logUrlVisit(url, "navigating");

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => log.error("Navigation failed", e));
    await page.waitForTimeout(2000);

    const html = await page.content();
    log.dumpData("Repo Page HTML", { url, htmlLength: html.length, htmlPreview: html.slice(0, 2000) });

    const files = await page.evaluate(() => {
      const items: { name: string; type: string; url: string }[] = [];

      document.querySelectorAll(".react-directory-row").forEach((row) => {
        const nameEl = row.querySelector(".react-directory-filename-column a");
        const typeIcon = row.querySelector(".octicon-file-directory, .octicon-file");
        if (nameEl) {
          items.push({
            name: nameEl.textContent?.trim() || "",
            type: typeIcon?.classList.contains("octicon-file-directory") ? "dir" : "file",
            url: `https://github.com${nameEl.getAttribute("href") || ""}`,
          });
        }
      });

      // Eski GitHub UI
      document.querySelectorAll(".js-navigation-item").forEach((item) => {
        const nameEl = item.querySelector(".js-navigation-open");
        const typeIcon = item.querySelector(".octicon-file-directory, .octicon-file");
        if (nameEl && !items.find((f) => f.name === nameEl.textContent?.trim())) {
          items.push({
            name: nameEl.textContent?.trim() || "",
            type: typeIcon?.classList.contains("octicon-file-directory") ? "dir" : "file",
            url: `https://github.com${nameEl.getAttribute("href") || ""}`,
          });
        }
      });

      return items;
    });

    log.dumpData("Parsed Files", { fileCount: files.length, files: files.slice(0, 20) });

    await browserManager.closeContext(ctxId);

    if (files.length === 0) {
      const result = { content: [{ type: "text" as const, text: `Dosya bulunamadı: ${url}` }] };
      log.finish(result);
      return result;
    }

    const dirs = files.filter((f) => f.type === "dir");
    const fileList = files.filter((f) => f.type === "file");

    let output = `# ${owner}/${repo}/${path || ""}\n\n`;
    if (dirs.length > 0) {
      output += `📁 Klasörler:\n${dirs.map((d) => `  ${d.name}/`).join("\n")}\n\n`;
    }
    if (fileList.length > 0) {
      output += `📄 Dosyalar:\n${fileList.map((f) => `  ${f.name}`).join("\n")}`;
    }

    const result = { content: [{ type: "text" as const, text: output }] };
    log.finish(result);
    return result;
  }
);

// ── TOOL: browse_page ─────────────────────────────────────────────
server.tool(
  "browse_page",
  "Belirli bir URL'ye git ve sayfanın içeriğini oku.",
  {
    url: z.string().url().describe("Ziyaret edilecek URL"),
    waitFor: z.enum(["domcontentloaded", "load", "networkidle"]).optional().default("domcontentloaded").describe("Bekleme stratejisi"),
  },
  async ({ url, waitFor }) => {
    const log = new Logger("browse_page");
    log.info("Browsing page", { url, waitFor });

    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);

    log.logUrlVisit(url, "navigating");
    await page.goto(url, { waitUntil: waitFor, timeout: 45000 }).catch((e) => log.error("Navigation failed", e));
    log.logUrlVisit(url, "loaded");

    await page.waitForTimeout(2000);

    const content = await extractContent(page);
    log.logPageContent(url, {
      title: content.title,
      textLength: content.text.length,
      preview: content.text,
    });

    // Final URL (redirect varsa)
    const finalUrl = page.url();
    if (finalUrl !== url) {
      log.info("Redirect detected", { originalUrl: url, finalUrl });
    }

    await browserManager.closeContext(ctxId);

    const truncated = content.text.length > 15000 ? content.text.slice(0, 15000) + "\n\n[... kesildi]" : content.text;

    const result = { content: [{ type: "text" as const, text: `# ${content.title}\n\n${truncated}` }] };
    log.finish(result);
    return result;
  }
);

// ── TOOL: get_page_links ──────────────────────────────────────────
server.tool(
  "get_page_links",
  "Bir sayfadaki tüm linkleri çıkarır.",
  {
    url: z.string().url().describe("Linklerin çıkarılacağı URL"),
  },
  async ({ url }) => {
    const log = new Logger("get_page_links");
    log.info("Extracting links", { url });

    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);

    log.logUrlVisit(url, "navigating");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => log.error("Navigation failed", e));
    await page.waitForTimeout(1500);

    const links = await extractLinks(page);
    log.dumpData("Extracted Links", { linkCount: links.length, links: links.slice(0, 20) });

    await browserManager.closeContext(ctxId);

    const formatted = links
      .slice(0, 100)
      .map((l, i) => `[${i + 1}] ${l.text}\n    ${l.href}`)
      .join("\n");

    const result = { content: [{ type: "text" as const, text: formatted || "Link bulunamadı." }] };
    log.finish(result);
    return result;
  }
);

// ── TOOL: parallel_search ─────────────────────────────────────────
server.tool(
  "parallel_search",
  "Birden çok sorguyu aynı anda paralel olarak arar.",
  {
    queries: z.array(z.string()).min(1).max(5).describe("Paralel arama sorguları (max 5)"),
    engine: z.enum(["duckduckgo", "google", "bing"]).optional().default("duckduckgo").describe("Arama motoru"),
    maxResults: z.number().min(1).max(10).optional().default(5).describe("Sorgu başına maksimum sonuç"),
  },
  async ({ queries, engine, maxResults }) => {
    const log = new Logger("parallel_search");
    log.info("Starting parallel search", { queries, engine, maxResults });

    const ctxId = genContextId();
    const tasks = queries.map(async (query) => {
      const page = await browserManager.openPage(ctxId);
      const urls: Record<string, string> = {
        duckduckgo: `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        google: `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${maxResults}&hl=en`,
        bing: `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${maxResults}&setlang=en`,
      };

      const url = urls[engine];
      log.debug(`Searching: ${query}`, { url });

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(2500);

      const results = await parseSearchResults(page);
      log.logSearchResults(engine, query, results);
      await page.close();

      const formatted = results
        .slice(0, maxResults)
        .map((r, i) => `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet}`)
        .join("\n");
      return `## Sorgu: "${query}"\n${formatted || "Sonuç bulunamadı."}`;
    });

    const allResults = await Promise.all(tasks);
    await browserManager.closeContext(ctxId);

    const result = { content: [{ type: "text" as const, text: allResults.join("\n\n---\n\n") }] };
    log.finish(result);
    return result;
  }
);

// ── TOOL: parallel_browse ─────────────────────────────────────────
server.tool(
  "parallel_browse",
  "Birden çok URL'yi aynı anda paralel olarak ziyaret eder.",
  {
    urls: z.array(z.string().url()).min(1).max(5).describe("Ziyaret edilecek URL'ler (max 5)"),
  },
  async ({ urls }) => {
    const log = new Logger("parallel_browse");
    log.info("Starting parallel browse", { urls });

    const ctxId = genContextId();
    const tasks = urls.map(async (url) => {
      const page = await browserManager.openPage(ctxId);
      log.logUrlVisit(url, "navigating");

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(2000);

      const content = await extractContent(page);
      log.logPageContent(url, {
        title: content.title,
        textLength: content.text.length,
        preview: content.text.slice(0, 200),
      });
      await page.close();

      return `## ${content.title}\nKaynak: ${url}\n\n${content.text.slice(0, 5000)}`;
    });

    const allResults = await Promise.all(tasks);
    await browserManager.closeContext(ctxId);

    const result = { content: [{ type: "text" as const, text: allResults.join("\n\n---\n\n") }] };
    log.finish(result);
    return result;
  }
);

// ── TOOL: screenshot ──────────────────────────────────────────────
server.tool(
  "screenshot",
  "Bir sayfanın ekran görüntüsünü alır (base64 PNG).",
  {
    url: z.string().url().describe("Ekran görüntüsü alınacak URL"),
    fullPage: z.boolean().optional().default(false).describe("Tam sayfa mı yoksa viewport mu"),
  },
  async ({ url, fullPage }) => {
    const log = new Logger("screenshot");
    log.info("Taking screenshot", { url, fullPage });

    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);

    log.logUrlVisit(url, "navigating");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => log.error("Navigation failed", e));
    await page.waitForTimeout(2500);

    const buffer = await page.screenshot({ fullPage, type: "png" });
    log.info("Screenshot taken", { size: buffer.length });

    await browserManager.closeContext(ctxId);

    const result = { content: [{ type: "image" as const, data: buffer.toString("base64"), mimeType: "image/png" }] };
    log.finish(result);
    return result;
  }
);

// ── TOOL: deep_search ─────────────────────────────────────────────
server.tool(
  "deep_search",
  "Kapsamlı arama: DuckDuckGo + GitHub + dokümantasyon sitelerinden kaynak toplar.",
  {
    query: z.string().describe("Aranacak terim"),
    maxSources: z.number().min(5).max(20).optional().default(10).describe("Hedef kaynak sayısı"),
    includeGitHub: z.boolean().optional().default(true).describe("GitHub sonuçları dahil"),
  },
  async ({ query, maxSources, includeGitHub }) => {
    const log = new Logger("deep_search");
    log.info("Starting deep search", { query, maxSources, includeGitHub });

    const ctxId = genContextId();
    const results: { source: string; title: string; url: string; content: string }[] = [];

    // 1. DuckDuckGo arama
    log.debug("Step 1: DuckDuckGo search");
    const searchTask = async () => {
      const page = await browserManager.openPage(ctxId);
      const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      log.logUrlVisit(url, "navigating");

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => log.error("DDG navigation failed", e));
      await page.waitForTimeout(3000);

      const html = await page.content();
      log.dumpData("DDG HTML", { htmlLength: html.length, htmlPreview: html.slice(0, 2000) });

      const searchResults = await parseSearchResults(page);
      log.logSearchResults("duckduckgo", query, searchResults);
      await page.close();
      return searchResults.slice(0, 8);
    };

    // 2. GitHub arama
    log.debug("Step 2: GitHub search");
    const githubTask = includeGitHub
      ? async () => {
          const page = await browserManager.openPage(ctxId);
          const url = `https://github.com/search?q=${encodeURIComponent(query)}&type=repositories`;
          log.logUrlVisit(url, "navigating");

          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => log.error("GitHub navigation failed", e));
          await page.waitForTimeout(3000);

          const html = await page.content();
          log.dumpData("GitHub HTML", { htmlLength: html.length, htmlPreview: html.slice(0, 2000) });

          const repos = await page.evaluate(() => {
            const items: { title: string; url: string }[] = [];
            document.querySelectorAll(".repo-list-item a.v-align-middle").forEach((el) => {
              items.push({
                title: el.textContent?.trim() || "",
                url: `https://github.com${el.getAttribute("href") || ""}`,
              });
            });
            return items;
          });

          log.dumpData("GitHub repos", { repoCount: repos.length, repos: repos.slice(0, 5) });
          await page.close();
          return repos;
        }
      : async () => [];

    const [searchResults, githubResults] = await Promise.all([searchTask(), githubTask()]);
    log.info("Search phase completed", { searchResultCount: searchResults.length, githubResultCount: githubResults.length });

    // 3. En iyi sonuçların içeriklerini paralel çek
    log.debug("Step 3: Fetching content from top results");
    const topUrls = searchResults.slice(0, 5).map((r) => r.url);
    const githubUrls = githubResults.slice(0, 3).map((r) => r.url);
    const allUrls = [...topUrls, ...githubUrls];

    log.dumpData("URLs to fetch", { urls: allUrls });

    const contentTasks = allUrls.map(async (url) => {
      const page = await browserManager.openPage(ctxId);
      log.logUrlVisit(url, "navigating");

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(2000);

      const content = await extractContent(page);
      log.logPageContent(url, {
        title: content.title,
        textLength: content.text.length,
        preview: content.text.slice(0, 200),
      });
      await page.close();

      return {
        source: url.includes("github") ? "GitHub" : "Web",
        title: content.title,
        url,
        content: content.text.slice(0, 2000),
      };
    });

    const contentResults = await Promise.all(contentTasks);
    results.push(...contentResults);

    await browserManager.closeContext(ctxId);

    log.info("Deep search completed", { totalResults: results.length });

    const formatted = results
      .slice(0, maxSources)
      .map((r, i) => `[${i + 1}] **${r.title}** (${r.source})\n    URL: ${r.url}\n    ${r.content.slice(0, 400)}...`)
      .join("\n\n");

    const result = {
      content: [{ type: "text" as const, text: `# Deep Search: "${query}"\nToplam ${results.length} kaynak.\n\n${formatted}` }],
    };
    log.finish(result);
    return result;
  }
);

// ── SERVER START ──────────────────────────────────────────────────
logSession("Server starting");

const transport = new StdioServerTransport();
await server.connect(transport);

logSession("Server connected to transport");

process.on("SIGINT", async () => {
  logSession("SIGINT received, shutting down");
  await browserManager.close();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  logSession("SIGTERM received, shutting down");
  await browserManager.close();
  process.exit(0);
});
