import type { Page } from "playwright";

/** Extract main text content from page */
export async function extractContent(page: Page): Promise<{ title: string; text: string; html: string }> {
  const result = await page.evaluate(() => {
    function cleanText(raw: string): string {
      return raw
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .split("\n")
        .map((line) => line.trim())
        .join("\n")
        .replace(/Skip to (main )?content/gi, "")
        .replace(/Search\.\.\./g, "")
        .replace(/Ctrl\+K|⌘K/g, "")
        .replace(/Sign in|Sign up|Log in/gi, "")
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
        .replace(/\[\s*\]/g, "")
        .replace(/\n\s*\n\s*\n/g, "\n\n")
        .trim();
    }

    function cleanTitle(title: string): string {
      return title
        .replace(/\s*·\s*GitHub\s*$/i, "")
        .replace(/\s*-\s*GitHub\s*$/i, "")
        .replace(/\s*\|\s*GitHub\s*$/i, "")
        .replace(/\s*-\s*Model Context Protocol\s*$/i, "")
        .trim();
    }

    const title = document.title;

    // GitHub README
    const readmeEl = document.querySelector("article.markdown-body, .readme, [data-testid='readme']");
    if (readmeEl) {
      const clone = readmeEl.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("svg, .octicon, .anchor, button, .copy-button").forEach((el) => el.remove());
      const text = cleanText(clone.innerText || "");
      return { title: cleanTitle(title), text, html: clone.innerHTML.slice(0, 50_000) };
    }

    // SPA - iframe
    const iframe = document.querySelector("iframe[src*='manual'], iframe[src*='docs'], iframe.content");
    if (iframe) {
      try {
        const iframeDoc = (iframe as HTMLIFrameElement).contentDocument;
        if (iframeDoc && iframeDoc.body) {
          const mainContent = iframeDoc.querySelector("main, article, .content, .markdown-body");
          if (mainContent) {
            const text = cleanText(mainContent.textContent || "");
            return { title: cleanTitle(title), text, html: mainContent.innerHTML.slice(0, 100_000) };
          }
        }
      } catch {}
    }

    // SPA - hash-based
    const hashContent = document.querySelector("#content, .content-wrapper, [data-content], .doc-content, .manual-content");
    if (hashContent && hashContent.textContent && hashContent.textContent.length > 500) {
      const clone = hashContent.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("nav, .sidebar, .menu, .toc").forEach((el) => el.remove());
      const text = cleanText(clone.textContent || "");
      if (text.length > 200) {
        return { title: cleanTitle(title), text, html: clone.innerHTML.slice(0, 100_000) };
      }
    }

    // Main content
    const mainContent = document.querySelector(
      "main, article, .content, .documentation, .md-content, .theme-default-content, [role='main'], .post-content, .entry-content, .markdown-body, .prose"
    );

    const clone = (mainContent || document.body).cloneNode(true) as HTMLElement;

    const removeSelectors = [
      "script", "style", "noscript", "svg", "canvas", "iframe", "embed", "object",
      "nav", "header", "footer", "aside",
      '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '[role="complementary"]',
      ".nav", ".navigation", ".menu", ".sidebar", ".toc", ".breadcrumb",
      ".header", ".footer", ".menu-bar", ".navbar",
      ".file-navigation", ".Box-header", ".js-permalink-shortcut",
      ".branch-dropdown", ".file-actions", ".BtnGroup", ".js-full-screen",
      ".react-code-view-header", ".Layout-sidebar", ".Layout-header",
      ".gh-header", ".gh-header-meta", ".TableObject",
      "[data-testid='file-directory-header']", "[data-testid='latest-commit']",
      ".alert", ".flash", ".notification", ".toast",
      ".signed-out-tab", ".signed-in-tab", ".js-stale-session-flash",
      ".search-box", ".searchbar", "#search", "[data-search]",
      ".edit-page", ".last-updated", ".page-footer",
      ".feedback", ".rating", ".helpful", ".was-this-helpful",
      ".contribution", ".edit-this-page", ".create-issue",
      ".pagination", ".prev-next", ".pager",
      ".ad", ".advertisement", ".ads", ".adsbygoogle",
      ".cookie-banner", "#cookie-banner", ".gdpr", ".privacy-notice",
      ".popup", ".modal", ".overlay", ".dialog",
      ".newsletter", ".subscribe", ".social-share", ".share-buttons",
      ".lineno", ".line-numbers", ".highlight .lineno",
      "button:not(article button)", ".btn", ".button",
      "[hidden]", "[aria-hidden='true']", ".sr-only", ".visually-hidden",
    ];

    for (const sel of removeSelectors) {
      clone.querySelectorAll(sel).forEach((el) => el.remove());
    }

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

/** Extract page date - multiple source check */
export async function extractDate(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    // 1. Schema.org JSON-LD
    const jsonLd = document.querySelector('script[type="application/ld+json"]');
    if (jsonLd) {
      try {
        const data = JSON.parse(jsonLd.textContent || "{}");
        if (data.datePublished) return data.datePublished;
        if (data.dateModified) return data.dateModified;
        if (data.dateCreated) return data.dateCreated;
        // Array ise
        if (Array.isArray(data)) {
          for (const item of data) {
            if (item.datePublished) return item.datePublished;
            if (item.dateModified) return item.dateModified;
          }
        }
      } catch {}
    }

    // 2. Meta tags
    const metaDate = document.querySelector('meta[property="article:published_time"], meta[property="article:modified_time"], meta[name="date"], meta[itemprop="datePublished"], meta[itemprop="dateModified"]');
    if (metaDate) {
      return metaDate.getAttribute("content") || undefined;
    }

    // 3. Open Graph
    const ogTime = document.querySelector('meta[property="og:updated_time"], meta[property="article:published_time"]');
    if (ogTime) {
      return ogTime.getAttribute("content") || undefined;
    }

    // 4. GitHub - relative-time
    const ghTime = document.querySelector("relative-time");
    if (ghTime) {
      return ghTime.getAttribute("datetime") || undefined;
    }

    // 5. ISO date in HTML
    const timeEl = document.querySelector("time[datetime], [datetime]");
    if (timeEl) {
      return timeEl.getAttribute("datetime") || undefined;
    }

    // 6. Text-based date patterns
    const datePatterns = [
      /(\d{4}-\d{2}-\d{2})/, // 2024-01-15
      /(\d{1,2}\/\d{1,2}\/\d{4})/, // 01/15/2024
      /((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})/i,
    ];

    // Published/Updated text patterns
    const dateTextSelectors = [
      ".published, .post-date, .article-date, .entry-date, .date",
      "[class*='publish'], [class*='updated'], [class*='modified']",
      ".last-updated, .update-date, .modified-date",
    ];

    for (const selector of dateTextSelectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent) {
        for (const pattern of datePatterns) {
          const match = el.textContent.match(pattern);
          if (match) return match[1];
        }
      }
    }

    // 7. Copyright date in footer
    const footer = document.querySelector("footer");
    if (footer && footer.textContent) {
      const yearMatch = footer.textContent.match(/(?:©|Copyright|Telif)\s*(\d{4})/i);
      if (yearMatch) return `${yearMatch[1]}-01-01`;
    }

    return undefined;
  });
}

/** Extract links from page */
export async function extractLinks(page: Page): Promise<{ text: string; href: string }[]> {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll("a[href]"))
      .filter((a) => {
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

/** Parse search results */
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

    if (ddgResults.some((r) => r.url)) return ddgResults.filter((r) => r.url);

    return [];
  });
}

/** Generate context ID */
let counter = 0;
export function genContextId(): string {
  return `ctx_${Date.now()}_${++counter}`;
}
