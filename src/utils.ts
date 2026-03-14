import type { Page } from "playwright";

/** Sayfadaki ana metin içeriğini çıkar - Gelişmiş temizleme ile */
export async function extractContent(page: Page): Promise<{ title: string; text: string; html: string }> {
  const result = await page.evaluate(() => {
    const title = document.title;

    // GitHub README special handling
    const readmeEl = document.querySelector("article.markdown-body, .readme, [data-testid='readme']");
    if (readmeEl) {
      const clone = readmeEl.cloneNode(true) as HTMLElement;
      // README içinden de gereksiz elementleri temizle
      clone.querySelectorAll("svg, .octicon, .anchor, button, .copy-button").forEach((el) => el.remove());
      const text = cleanText(clone.innerText || "");
      return { title: title.replace("· GitHub", "").trim(), text, html: clone.innerHTML.slice(0, 50_000) };
    }

    // Documentation sites - main content areas
    const mainContent = document.querySelector(
      "main, article, .content, .documentation, .md-content, .theme-default-content, [role='main'], .post-content, .entry-content"
    );

    const clone = (mainContent || document.body).cloneNode(true) as HTMLElement;

    // Kapsamlı gürültü temizleme
    const removeSelectors = [
      // Script ve stil
      "script", "style", "noscript", "svg", "canvas", "iframe", "embed", "object",
      // Navigasyon
      "nav", "header", "footer", "aside",
      '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '[role="complementary"]',
      ".nav", ".navigation", ".menu", ".sidebar", ".toc", ".breadcrumb",
      ".header", ".footer", ".menu-bar", ".navbar",
      // GitHub UI
      ".file-navigation", ".Box-header", ".js-permalink-shortcut",
      ".branch-dropdown", ".file-actions", ".BtnGroup", ".js-full-screen",
      ".react-code-view-header", ".Layout-sidebar", ".Layout-header",
      ".gh-header", ".gh-header-meta", ".TableObject",
      "[data-testid='file-directory-header']", "[data-testid='latest-commit']",
      ".alert", ".flash", ".notification", ".toast",
      ".signed-out-tab", ".signed-in-tab", ".js-stale-session-flash",
      // Docs site UI
      ".search-box", ".searchbar", "#search", "[data-search]",
      ".edit-page", ".last-updated", ".page-footer",
      ".feedback", ".rating", ".helpful", ".was-this-helpful",
      ".contribution", ".edit-this-page", ".create-issue",
      ".pagination", ".prev-next", ".pager",
      // Ads ve popups
      ".ad", ".advertisement", ".ads", ".adsbygoogle",
      ".cookie-banner", "#cookie-banner", ".gdpr", ".privacy-notice",
      ".popup", ".modal", ".overlay", ".dialog",
      ".newsletter", ".subscribe", ".social-share", ".share-buttons",
      // Kod satır numaraları
      ".lineno", ".line-numbers", ".highlight .lineno",
      // Gereksiz butonlar
      "button:not(article button)", ".btn", ".button",
      // Görünmez elementler
      "[hidden]", "[aria-hidden='true']", ".sr-only", ".visually-hidden",
    ];

    for (const sel of removeSelectors) {
      clone.querySelectorAll(sel).forEach((el) => el.remove());
    }

    // Display:none olan elementleri temizle
    clone.querySelectorAll("*").forEach((el) => {
      const style = (el as HTMLElement).style;
      if (style.display === "none" || style.visibility === "hidden") {
        el.remove();
      }
    });

    const text = cleanText(clone.innerText || clone.textContent || "");
    const html = clone.innerHTML.slice(0, 100_000);

    return { title: cleanTitle(title), text, html };
  });

  return result;
}

/** Metin temizleme helper */
function cleanText(raw: string): string {
  return raw
    // Fazla boşlukları temizle
    .replace(/[ \t]+/g, " ")
    // Fazla satır sonlarını temizle
    .replace(/\n{3,}/g, "\n\n")
    // Satır başındaki boşlukları temizle
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    // UI artifactlerini temizle
    .replace(/Skip to (main )?content/gi, "")
    .replace(/Search\.\.\./g, "")
    .replace(/Ctrl\+K|⌘K/g, "")
    .replace(/Sign in|Sign up|Log in/g, "")
    .replace(/You signed in with another tab.*Reload to refresh your session\./gi, "")
    .replace(/You signed out in another tab.*Reload to refresh your session\./gi, "")
    .replace(/You switched accounts.*\./gi, "")
    .replace(/Dismiss alert/gi, "")
    .replace(/Fork\s*\d+/g, "")
    .replace(/Star\s*\d+/g, "")
    .replace(/\d+ Branches|\d+ Tags/g, "")
    .replace(/Go to file|Code|Open more actions menu/gi, "")
    .replace(/Copy path|Copy permalink/gi, "")
    .replace(/Latest commit|History|Commits/gi, "")
    .replace(/View all files|View file history/gi, "")
    .replace(/\[\s*\]/g, "") // Boş köşeli parantezler
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .trim();
}

/** Title temizleme */
function cleanTitle(title: string): string {
  return title
    .replace(/\s*·\s*GitHub\s*$/i, "")
    .replace(/\s*-\s*GitHub\s*$/i, "")
    .replace(/\s*\|\s*GitHub\s*$/i, "")
    .replace(/\s*-\s*Model Context Protocol\s*$/i, "")
    .trim();
}

/** GitHub README özel çıkarma */
export async function extractGitHubReadme(page: Page): Promise<{ title: string; text: string } | null> {
  return page.evaluate(() => {
    const readme = document.querySelector("article.markdown-body, .readme");
    if (!readme) return null;

    const clone = readme.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("svg, .octicon, .anchor, button").forEach((el) => el.remove());

    // Repo adını al
    const repoName = document.querySelector('[data-testid="breadcrumbs"] a:last-child, .author a')?.textContent || "";

    return {
      title: repoName || "GitHub README",
      text: clone.innerText.replace(/\n{3,}/g, "\n\n").trim(),
    };
  });
}

/** Sayfadaki tüm linkleri çıkar - temizlenmiş */
export async function extractLinks(page: Page): Promise<{ text: string; href: string }[]> {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll("a[href]"))
      .filter((a) => {
        // Görünür ve anlamlı linkler
        const rect = a.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((a) => ({
        text: (a.textContent || "").trim().replace(/\s+/g, " ").slice(0, 100),
        href: (a as HTMLAnchorElement).href,
      }))
      .filter((l) => l.href.startsWith("http") && l.text.length > 2 && !l.text.match(/^(Sign|Log|Menu|Search|Skip)/i));
  });
}

/** Arama sonucu sayfasından sonuçları parse et (Google/Bing/DDG uyumlu) */
export async function parseSearchResults(page: Page): Promise<{ title: string; url: string; snippet: string }[]> {
  return page.evaluate(() => {
    // Google
    const googleResults = Array.from(document.querySelectorAll(".g")).map((g) => {
      const titleEl = g.querySelector("h3");
      const linkEl = g.querySelector("a[href]");
      const snippetEl = g.querySelector("[data-sncf], .VwiC3b, [style*='-webkit-line-clamp']");
      return {
        title: titleEl?.textContent?.trim() || "",
        url: linkEl ? (linkEl as HTMLAnchorElement).href : "",
        snippet: snippetEl?.textContent?.trim() || "",
      };
    });

    if (googleResults.some((r) => r.url)) return googleResults.filter((r) => r.url);

    // Bing
    const bingResults = Array.from(document.querySelectorAll(".b_algo")).map((b) => {
      const titleEl = b.querySelector("h2 a");
      const snippetEl = b.querySelector(".b_caption p");
      return {
        title: titleEl?.textContent?.trim() || "",
        url: titleEl ? (titleEl as HTMLAnchorElement).href : "",
        snippet: snippetEl?.textContent?.trim() || "",
      };
    });

    if (bingResults.some((r) => r.url)) return bingResults.filter((r) => r.url);

    // DuckDuckGo
    const ddgResults = Array.from(document.querySelectorAll(".result")).map((r) => {
      const titleEl = r.querySelector(".result__title a");
      const snippetEl = r.querySelector(".result__snippet");
      return {
        title: titleEl?.textContent?.trim() || "",
        url: titleEl ? (titleEl as HTMLAnchorElement).href : "",
        snippet: snippetEl?.textContent?.trim() || "",
      };
    });

    return ddgResults.filter((r) => r.url);
  });
}

/** Context ID üret */
let counter = 0;
export function genContextId(): string {
  return `ctx_${Date.now()}_${++counter}`;
}
