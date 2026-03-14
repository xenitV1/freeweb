import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { browserManager } from "./browser.js";
import { extractContent, extractLinks, extractDate, genContextId } from "./utils.js";

const server = new McpServer({
  name: "freeweb",
  version: "1.0.0",
});

// ── GÜVENLİK ──────────────────────────────────────────────────────
const BLOCKED_DOMAINS = [
  "malware", "phishing", "spam", "scam", "hack", "crack", "warez", "pirate",
  "porn", "xxx", "adult", "sex", ".tk", ".ml", ".ga", ".cf", ".gq", ".xyz",
];

const ALLOWED_DOWNLOAD_EXTENSIONS = [".pdf", ".json", ".txt", ".csv", ".xml", ".md", ".html"];

function isUrlSafe(url: string): { safe: boolean; reason?: string } {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { safe: false, reason: `Güvenli olmayan protokol: ${parsed.protocol}` };
    }
    const hostname = parsed.hostname.toLowerCase();
    for (const blocked of BLOCKED_DOMAINS) {
      if (hostname.includes(blocked)) {
        return { safe: false, reason: `Engellenen domain` };
      }
    }
    if (parsed.port && !["80", "443", "8080", "3000", "5000"].includes(parsed.port)) {
      return { safe: false, reason: `Şüpheli port` };
    }
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      return { safe: false, reason: "IP adresi güvenli değil" };
    }
    return { safe: true };
  } catch {
    return { safe: false, reason: "Geçersiz URL" };
  }
}

function checkDownloadRequest(url: string): { allowed: boolean; warning?: string } {
  const parsed = new URL(url);
  const pathname = parsed.pathname.toLowerCase();
  const isDownload = pathname.includes("/download/") ||
                     pathname.includes("/releases/download/") ||
                     ALLOWED_DOWNLOAD_EXTENSIONS.some(ext => pathname.endsWith(ext));
  if (isDownload) {
    return { allowed: false, warning: `⚠️ İndirme linki - kullanıcı izni gerekli` };
  }
  return { allowed: true };
}

function checkDateFreshness(dateStr: string | undefined, maxAgeMonths = 24): { isFresh: boolean; warning: string } {
  if (!dateStr) return { isFresh: true, warning: "" };
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return { isFresh: true, warning: "" };
  const now = new Date();
  const ageMonths = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
  if (ageMonths > maxAgeMonths) {
    return { isFresh: false, warning: `⚠️ ESKİ: ${ageMonths} ay önce (${date.toLocaleDateString("tr-TR")})` };
  }
  return { isFresh: true, warning: "" };
}

// ── TOOL: github_search ───────────────────────────────────────────
server.tool(
  "github_search",
  "GitHub'da repo arar.",
  {
    query: z.string().describe("Aranacak terim"),
    type: z.enum(["repos", "code", "issues"]).optional().default("repos"),
    maxResults: z.number().min(1).max(10).optional().default(5),
    sortByUpdated: z.boolean().optional().default(true),
  },
  async ({ query, type, maxResults, sortByUpdated }) => {
    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);

    const sortParam = sortByUpdated ? "&s=updated&o=desc" : "";
    const typeParam = type === "repos" ? "repositories" : type;
    const url = `https://github.com/search?q=${encodeURIComponent(query)}&type=${typeParam}${sortParam}`;

    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(4000);

    const results = await page.evaluate(() => {
      const items: { title: string; url: string; snippet: string; updatedAt: string; stars: string; language: string }[] = [];

      document.querySelectorAll('[data-testid="results-list"] > div').forEach((item) => {
        const titleEl = item.querySelector("a");
        const descEl = item.querySelector("p");
        const dateEl = item.querySelector("relative-time, time, [datetime]");
        const starsEl = item.querySelector('[data-testid="stars-count"], .starring-container span');
        const langEl = item.querySelector('[data-testid="language"], [itemprop="programmingLanguage"]');
        if (titleEl) {
          items.push({
            title: titleEl.textContent?.trim() || "",
            url: `https://github.com${titleEl.getAttribute("href") || ""}`,
            snippet: descEl?.textContent?.trim() || "",
            updatedAt: dateEl?.getAttribute("datetime") || "",
            stars: starsEl?.textContent?.trim() || "",
            language: langEl?.textContent?.trim() || "",
          });
        }
      });

      if (items.length === 0) {
        document.querySelectorAll(".repo-list-item").forEach((item) => {
          const titleEl = item.querySelector("a.v-align-middle");
          const descEl = item.querySelector("p.col-9");
          const dateEl = item.querySelector("relative-time");
          const starsEl = item.querySelector(".pl-2 span");
          const langEl = item.querySelector("[itemprop='programmingLanguage']");
          if (titleEl) {
            items.push({
              title: titleEl.textContent?.trim() || "",
              url: `https://github.com${titleEl.getAttribute("href") || ""}`,
              snippet: descEl?.textContent?.trim() || "",
              updatedAt: dateEl?.getAttribute("datetime") || "",
              stars: starsEl?.textContent?.trim() || "",
              language: langEl?.textContent?.trim() || "",
            });
          }
        });
      }
      return items;
    });

    await browserManager.closeContext(ctxId);

    const uniqueResults = results.filter((r, i, arr) => arr.findIndex((x) => x.url === r.url) === i);
    if (uniqueResults.length === 0) {
      return { content: [{ type: "text" as const, text: `GitHub'da "${query}" için sonuç bulunamadı.` }] };
    }

    const formatted = uniqueResults.slice(0, maxResults).map((r, i) => {
      let line = `[${i + 1}] ${r.title}`;
      if (r.language) line += ` (${r.language})`;
      if (r.stars) line += ` ⭐ ${r.stars}`;
      if (r.updatedAt) {
        const dateCheck = checkDateFreshness(r.updatedAt, 12);
        line += `\n    📅 ${new Date(r.updatedAt).toLocaleDateString("tr-TR")}${dateCheck.warning ? " " + dateCheck.warning : ""}`;
      }
      line += `\n    URL: ${r.url}`;
      if (r.snippet) line += `\n    ${r.snippet.slice(0, 100)}`;
      return line;
    }).join("\n\n");

    return { content: [{ type: "text" as const, text: formatted }] };
  }
);

// ── TOOL: browse_page ─────────────────────────────────────────────
server.tool(
  "browse_page",
  "URL ziyaret et.",
  {
    url: z.string().url().describe("URL"),
    waitFor: z.enum(["domcontentloaded", "load", "networkidle"]).optional().default("networkidle"),
    warnIfOlderThanMonths: z.number().optional().default(24),
  },
  async ({ url, waitFor, warnIfOlderThanMonths }) => {
    const safety = isUrlSafe(url);
    if (!safety.safe) {
      return { content: [{ type: "text" as const, text: `🔒 GÜVENLİK: ${safety.reason}` }] };
    }

    const download = checkDownloadRequest(url);
    if (!download.allowed) {
      return { content: [{ type: "text" as const, text: download.warning || "" }] };
    }

    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);

    await page.goto(url, { waitUntil: waitFor, timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);

    const content = await extractContent(page);
    const pageDate = await extractDate(page);
    const finalUrl = page.url();

    await browserManager.closeContext(ctxId);

    let dateWarning = "";
    if (pageDate) {
      const dateCheck = checkDateFreshness(pageDate, warnIfOlderThanMonths);
      if (dateCheck.warning) dateWarning = `\n\n${dateCheck.warning}`;
    }

    const truncated = content.text.length > 15000 ? content.text.slice(0, 15000) + "\n\n[... kesildi]" : content.text;
    const dateInfo = pageDate ? `\n📅 ${new Date(pageDate).toLocaleDateString("tr-TR")}` : "";

    return { content: [{ type: "text" as const, text: `# ${content.title}\n\nURL: ${finalUrl}${dateInfo}${dateWarning}\n\n${truncated}` }] };
  }
);

// ── TOOL: smart_browse ────────────────────────────────────────────
server.tool(
  "smart_browse",
  "Akıllı sayfa ziyareti: SPA tespiti, tarih kontrolü.",
  {
    url: z.string().url().describe("URL"),
    requireFreshContent: z.boolean().optional().default(true),
    maxAgeMonths: z.number().optional().default(12),
  },
  async ({ url, requireFreshContent, maxAgeMonths }) => {
    const safety = isUrlSafe(url);
    if (!safety.safe) {
      return { content: [{ type: "text" as const, text: `🔒 GÜVENLİK: ${safety.reason}` }] };
    }

    const download = checkDownloadRequest(url);
    if (!download.allowed) {
      return { content: [{ type: "text" as const, text: download.warning || "" }] };
    }

    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});

    const isSPA = await page.evaluate(() => {
      return window.location.hash.length > 0 || !!document.querySelector("[data-reactroot], [data-v-app], #__next, #app");
    });

    if (isSPA) {
      await page.waitForTimeout(4000);
      await page.waitForSelector("main, article, .content, [role='main']", { timeout: 10000 }).catch(() => {});
    } else {
      await page.waitForTimeout(2000);
    }

    const content = await extractContent(page);
    const pageDate = await extractDate(page);
    const links = await extractLinks(page);

    const finalUrl = page.url();
    await browserManager.closeContext(ctxId);

    let dateWarning = "";
    let isFresh = true;
    if (pageDate) {
      const dateCheck = checkDateFreshness(pageDate, maxAgeMonths);
      isFresh = dateCheck.isFresh;
      if (dateCheck.warning) {
        dateWarning = `\n\n${dateCheck.warning}`;
        if (requireFreshContent && !isFresh) dateWarning += "\n\n⚠️ GÜNCEL İÇERİK GEREKLİ!";
      }
    }

    let output = `# ${content.title}\n\nURL: ${finalUrl}`;
    if (isSPA) output += ` (SPA)`;
    if (pageDate) output += `\n📅 ${new Date(pageDate).toLocaleDateString("tr-TR")}`;
    output += `${dateWarning}\n\n---\n\n${content.text.slice(0, 12000)}`;

    if (links.length > 0) {
      output += `\n\n---\n\n## Bağlantılar (${links.length})\n`;
      output += links.slice(0, 15).map((l) => `- [${l.text}](${l.href})`).join("\n");
    }

    return { content: [{ type: "text" as const, text: output }] };
  }
);

// ── TOOL: deep_search ─────────────────────────────────────────────
server.tool(
  "deep_search",
  "Doğrudan kaynaklardan arama.",
  {
    query: z.string().describe("Aranacak terim"),
    sources: z.array(z.enum(["github", "npm", "mdn", "devdocs"])).optional().default(["github", "npm", "mdn"]),
    maxAgeMonths: z.number().optional().default(12),
  },
  async ({ query, sources, maxAgeMonths }) => {
    const ctxId = genContextId();
    const results: { source: string; title: string; url: string; content: string; date?: string; isFresh: boolean }[] = [];

    const sourceUrls: Record<string, string[]> = {
      github: [`https://github.com/search?q=${encodeURIComponent(query)}&type=repositories&s=updated&o=desc`],
      npm: [`https://www.npmjs.com/search?q=${encodeURIComponent(query)}`],
      mdn: [`https://developer.mozilla.org/en-US/search?q=${encodeURIComponent(query)}`],
      devdocs: [`https://devdocs.io/#q=${encodeURIComponent(query)}`],
    };

    for (const source of sources) {
      const urls = sourceUrls[source];
      if (!urls) continue;

      for (const url of urls) {
        const safety = isUrlSafe(url);
        if (!safety.safe) continue;

        const page = await browserManager.openPage(ctxId);
        await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(3000);

        const content = await extractContent(page);
        const pageDate = await extractDate(page);
        const dateCheck = checkDateFreshness(pageDate, maxAgeMonths);

        results.push({
          source,
          title: content.title || source,
          url,
          content: content.text.slice(0, 1500),
          date: pageDate,
          isFresh: dateCheck.isFresh,
        });

        await page.close();
      }
    }

    await browserManager.closeContext(ctxId);

    const freshResults = results.filter((r) => r.isFresh);
    const oldResults = results.filter((r) => !r.isFresh);
    const sortedResults = [...freshResults, ...oldResults];

    const formatted = sortedResults.map((r, i) => {
      let line = `[${i + 1}] **${r.title}** (${r.source})`;
      if (r.date) {
        line += ` - 📅 ${new Date(r.date).toLocaleDateString("tr-TR")}`;
        if (!r.isFresh) line += " ⚠️ ESKİ";
      }
      line += `\n    URL: ${r.url}\n    ${r.content.slice(0, 300)}...`;
      return line;
    }).join("\n\n");

    return { content: [{ type: "text" as const, text: `# Deep Search: "${query}"\n${freshResults.length}/${results.length} kaynak güncel\n\n${formatted}` }] };
  }
);

// ── TOOL: github_repo_files ───────────────────────────────────────
server.tool(
  "github_repo_files",
  "GitHub repo dosyalarını listeler.",
  {
    owner: z.string().describe("Repo sahibi"),
    repo: z.string().describe("Repo adı"),
    path: z.string().optional().default(""),
    branch: z.string().optional().default("main"),
  },
  async ({ owner, repo, path, branch }) => {
    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);

    const url = `https://github.com/${owner}/${repo}/tree/${branch}/${path}`;
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);

    const files = await page.evaluate(() => {
      const items: { name: string; type: string }[] = [];
      document.querySelectorAll('[data-testid="directory-row"], .react-directory-row, .js-navigation-item').forEach((row) => {
        const nameEl = row.querySelector("a");
        const isDir = row.querySelector('.octicon-file-directory, [aria-label="Directory"]');
        if (nameEl) {
          items.push({ name: nameEl.textContent?.trim() || "", type: isDir ? "dir" : "file" });
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
    if (dirs.length > 0) output += `📁 Klasörler:\n${dirs.map((d) => `  ${d.name}/`).join("\n")}\n\n`;
    if (fileList.length > 0) output += `📄 Dosyalar:\n${fileList.map((f) => `  ${f.name}`).join("\n")}`;

    return { content: [{ type: "text" as const, text: output }] };
  }
);

// ── TOOL: parallel_browse ─────────────────────────────────────────
server.tool(
  "parallel_browse",
  "Birden çok URL'yi paralel ziyaret eder.",
  {
    urls: z.array(z.string().url()).min(1).max(5).describe("URL'ler (max 5)"),
  },
  async ({ urls }) => {
    const safeUrls: string[] = [];
    const blockedUrls: string[] = [];

    for (const url of urls) {
      const safety = isUrlSafe(url);
      const download = checkDownloadRequest(url);
      if (!safety.safe || !download.allowed) {
        blockedUrls.push(url);
      } else {
        safeUrls.push(url);
      }
    }

    if (safeUrls.length === 0) {
      return { content: [{ type: "text" as const, text: `🔒 Tüm URL'ler engellendi.\n${blockedUrls.join("\n")}` }] };
    }

    const ctxId = genContextId();

    const tasks = safeUrls.map(async (url) => {
      const page = await browserManager.openPage(ctxId);
      await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(2500);

      const content = await extractContent(page);
      const pageDate = await extractDate(page);
      const dateCheck = checkDateFreshness(pageDate, 12);

      await page.close();

      let output = `## ${content.title}\nURL: ${url}`;
      if (pageDate) {
        output += `\n📅 ${new Date(pageDate).toLocaleDateString("tr-TR")}`;
        if (!dateCheck.isFresh) output += " ⚠️ ESKİ";
      }
      output += `\n\n${content.text.slice(0, 4000)}`;
      return output;
    });

    const allResults = await Promise.all(tasks);
    await browserManager.closeContext(ctxId);

    let output = allResults.join("\n\n---\n\n");
    if (blockedUrls.length > 0) {
      output += `\n\n---\n\n🔒 Engellenen: ${blockedUrls.join(", ")}`;
    }

    return { content: [{ type: "text" as const, text: output }] };
  }
);

// ── TOOL: get_page_links ──────────────────────────────────────────
server.tool(
  "get_page_links",
  "Sayfadaki linkleri çıkarır.",
  {
    url: z.string().url().describe("URL"),
  },
  async ({ url }) => {
    const safety = isUrlSafe(url);
    if (!safety.safe) {
      return { content: [{ type: "text" as const, text: `🔒 GÜVENLİK: ${safety.reason}` }] };
    }

    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);

    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const links = await extractLinks(page);
    await browserManager.closeContext(ctxId);

    const safeLinks = links.filter(l => isUrlSafe(l.href).safe);
    const formatted = safeLinks.slice(0, 100).map((l, i) => `[${i + 1}] ${l.text}\n    ${l.href}`).join("\n");

    return { content: [{ type: "text" as const, text: formatted || "Link bulunamadı." }] };
  }
);

// ── TOOL: screenshot ──────────────────────────────────────────────
server.tool(
  "screenshot",
  "Ekran görüntüsü alır.",
  {
    url: z.string().url().describe("URL"),
    fullPage: z.boolean().optional().default(false),
  },
  async ({ url, fullPage }) => {
    const safety = isUrlSafe(url);
    if (!safety.safe) {
      return { content: [{ type: "text" as const, text: `🔒 GÜVENLİK: ${safety.reason}` }] };
    }

    const ctxId = genContextId();
    const page = await browserManager.openPage(ctxId);

    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2500);

    const buffer = await page.screenshot({ fullPage, type: "png" });
    await browserManager.closeContext(ctxId);

    return { content: [{ type: "image" as const, data: buffer.toString("base64"), mimeType: "image/png" }] };
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
