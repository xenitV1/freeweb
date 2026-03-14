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
  "Web'de arama yap. DuckDuckGo varsayılan (bot koruması az). Google/Bing de seçilebilir.",
  {
    query: z.string().describe("Aranacak terim"),
    engine: z.enum(["duckduckgo", "google", "bing"]).optional().default("duckduckgo").describe("Arama motoru (önerilen: duckduckgo)"),
    maxResults: z.number().min(1).max(20).optional().default(10).describe("Maksimum sonuç sayısı"),
  },
  async ({ query, engine, maxResults }) => {
    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);

    const engines: Record<string, string> = {
      duckduckgo: `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      google: `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${maxResults}&hl=en`,
      bing: `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${maxResults}&setlang=en`,
    };

    await page.goto(engines[engine], { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2500);

    const results = await parseSearchResults(page);

    if (results.length === 0) {
      const content = await extractContent(page);
      await browserManager.closeContext(ctxId);
      // Bot koruması tespit
      if (content.text.includes("robot") || content.text.includes("unusual traffic") || content.text.includes("CAPTCHA")) {
        return {
          content: [{ type: "text" as const, text: `⚠️ ${engine} bot koruması aktif. DuckDuckGo veya site_search kullanmayı deneyin.` }],
        };
      }
      return {
        content: [{ type: "text" as const, text: `Sonuç bulunamadı. Sayfa içeriği:\n\n${content.text.slice(0, 3000)}` }],
      };
    }

    await browserManager.closeContext(ctxId);
    const formatted = results
      .slice(0, maxResults)
      .map((r, i) => `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet}`)
      .join("\n\n");
    return { content: [{ type: "text" as const, text: formatted }] };
  }
);

// ── TOOL: site_search ─────────────────────────────────────────────
server.tool(
  "site_search",
  "Belirli bir site içinde arama yapar. Örn: GitHub repo, dokümantasyon siteleri.",
  {
    site: z.string().describe("Aranacak site (örn: github.com, docs.python.org)"),
    query: z.string().describe("Aranacak terim"),
    maxResults: z.number().min(1).max(10).optional().default(5).describe("Maksimum sonuç"),
  },
  async ({ site, query, maxResults }) => {
    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);

    // DuckDuckGo site search
    const url = `https://duckduckgo.com/html/?q=site%3A${encodeURIComponent(site)}+${encodeURIComponent(query)}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const results = await parseSearchResults(page);
    await browserManager.closeContext(ctxId);

    if (results.length === 0) {
      return { content: [{ type: "text" as const, text: `${site} içinde "${query}" için sonuç bulunamadı.` }] };
    }

    const formatted = results
      .slice(0, maxResults)
      .map((r, i) => `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet}`)
      .join("\n\n");
    return { content: [{ type: "text" as const, text: formatted }] };
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
    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);

    const typeMap: Record<string, string> = {
      repos: "",
      code: "code&type=Code",
      issues: "issues&type=Issues",
    };

    const url = `https://github.com/search?q=${encodeURIComponent(query)}&${typeMap[type]}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(3000);

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

    await browserManager.closeContext(ctxId);

    if (results.length === 0) {
      return { content: [{ type: "text" as const, text: `GitHub'da "${query}" için sonuç bulunamadı.` }] };
    }

    const formatted = results
      .slice(0, maxResults)
      .map((r, i) => `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet}`)
      .join("\n\n");
    return { content: [{ type: "text" as const, text: formatted }] };
  }
);

// ── TOOL: github_repo_files ───────────────────────────────────────
server.tool(
  "github_repo_files",
  "Bir GitHub reposundaki dosya ve klasörleri listeler.",
  {
    owner: z.string().describe("Repo sahibi (örn: mrdoob)"),
    repo: z.string().describe("Repo adı (örn: three.js)"),
    path: z.string().optional().default("").describe("Klasör yolu (örn: src/examples)"),
    branch: z.string().optional().default("main").describe("Branch adı"),
  },
  async ({ owner, repo, path, branch }) => {
    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);

    const url = `https://github.com/${owner}/${repo}/tree/${branch}/${path}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2000);

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

    await browserManager.closeContext(ctxId);

    if (files.length === 0) {
      return { content: [{ type: "text" as const, text: `Dosya bulunamadı: ${url}` }] };
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

    return { content: [{ type: "text" as const, text: output }] };
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
    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);

    await page.goto(url, { waitUntil: waitFor, timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const content = await extractContent(page);
    await browserManager.closeContext(ctxId);

    const truncated = content.text.length > 15000 ? content.text.slice(0, 15000) + "\n\n[... kesildi]" : content.text;

    return { content: [{ type: "text" as const, text: `# ${content.title}\n\n${truncated}` }] };
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
    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const links = await extractLinks(page);
    await browserManager.closeContext(ctxId);

    const formatted = links
      .slice(0, 100)
      .map((l, i) => `[${i + 1}] ${l.text}\n    ${l.href}`)
      .join("\n");
    return { content: [{ type: "text" as const, text: formatted || "Link bulunamadı." }] };
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
    const ctxId = genContextId();
    const tasks = queries.map(async (query) => {
      const page = await browserManager.openPage(ctxId);
      const urls: Record<string, string> = {
        duckduckgo: `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        google: `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${maxResults}&hl=en`,
        bing: `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${maxResults}&setlang=en`,
      };

      await page.goto(urls[engine], { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(2500);

      const results = await parseSearchResults(page);
      await page.close();

      const formatted = results
        .slice(0, maxResults)
        .map((r, i) => `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet}`)
        .join("\n");
      return `## Sorgu: "${query}"\n${formatted || "Sonuç bulunamadı."}`;
    });

    const allResults = await Promise.all(tasks);
    await browserManager.closeContext(ctxId);

    return { content: [{ type: "text" as const, text: allResults.join("\n\n---\n\n") }] };
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
    const ctxId = genContextId();
    const tasks = urls.map(async (url) => {
      const page = await browserManager.openPage(ctxId);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(2000);

      const content = await extractContent(page);
      await page.close();

      return `## ${content.title}\nKaynak: ${url}\n\n${content.text.slice(0, 5000)}`;
    });

    const allResults = await Promise.all(tasks);
    await browserManager.closeContext(ctxId);

    return { content: [{ type: "text" as const, text: allResults.join("\n\n---\n\n") }] };
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
    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2500);

    const buffer = await page.screenshot({ fullPage, type: "png" });
    await browserManager.closeContext(ctxId);

    return { content: [{ type: "image" as const, data: buffer.toString("base64"), mimeType: "image/png" }] };
  }
);

// ── TOOL: deep_search ─────────────────────────────────────────────
server.tool(
  "deep_search",
  "Kapsamlı arama: DuckDuckGo + GitHub + dokümantasyon sitelerinden en az 10 kaynak toplar.",
  {
    query: z.string().describe("Aranacak terim"),
    maxSources: z.number().min(10).max(20).optional().default(10).describe("Minimum kaynak sayısı"),
    includeGitHub: z.boolean().optional().default(true).describe("GitHub sonuçları dahil"),
  },
  async ({ query, maxSources, includeGitHub }) => {
    const ctxId = genContextId();
    const results: { source: string; title: string; url: string; content: string }[] = [];

    // 1. DuckDuckGo arama
    const searchTask = async () => {
      const page = await browserManager.openPage(ctxId);
      await page.goto(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(3000);
      const searchResults = await parseSearchResults(page);
      await page.close();
      return searchResults.slice(0, 8);
    };

    // 2. GitHub arama
    const githubTask = includeGitHub
      ? async () => {
          const page = await browserManager.openPage(ctxId);
          await page.goto(`https://github.com/search?q=${encodeURIComponent(query)}&type=repositories`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
          await page.waitForTimeout(3000);
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
          await page.close();
          return repos;
        }
      : async () => [];

    const [searchResults, githubResults] = await Promise.all([searchTask(), githubTask()]);

    // 3. En iyi sonuçların içeriklerini paralel çek
    const topUrls = searchResults.slice(0, 5).map((r) => r.url);
    const githubUrls = githubResults.slice(0, 3).map((r) => r.url);

    const contentTasks = [...topUrls, ...githubUrls].map(async (url) => {
      const page = await browserManager.openPage(ctxId);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(2000);
      const content = await extractContent(page);
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

    const formatted = results
      .slice(0, maxSources)
      .map((r, i) => `[${i + 1}] **${r.title}** (${r.source})\n    URL: ${r.url}\n    ${r.content.slice(0, 400)}...`)
      .join("\n\n");

    return {
      content: [{ type: "text" as const, text: `# Deep Search: "${query}"\nToplam ${results.length} kaynak.\n\n${formatted}` }],
    };
  }
);

// ── SERVER START ──────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);

process.on("SIGINT", async () => {
  await browserManager.close();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await browserManager.close();
  process.exit(0);
});
