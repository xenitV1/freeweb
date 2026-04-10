import { describe, it, expect } from "vitest";
import { extractContent } from "../../src/utils.js";
import { JSDOM } from "jsdom";

function createPage(html: string) {
  const dom = new JSDOM(html, { url: "https://example.com/page", runScripts: "dangerously" });
  const window = dom.window;

  return {
    content: () => Promise.resolve(html),
    url: () => "https://example.com/page",
    evaluate: (fn: Function) => {
      return Promise.resolve(window.eval(`(${fn.toString()})()`));
    },
  } as any;
}

describe("extractContent", () => {
  it("extracts from <main> element", async () => {
    const html = `
      <html><head><title>Test Page</title></head><body>
        <nav>Navigation links</nav>
        <main>
          <p>This is the main content of the page with useful information.</p>
          <p>It has multiple paragraphs with enough text to be meaningful.</p>
        </main>
        <footer>Footer content</footer>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractContent(page);

    expect(result.title).toBe("Test Page");
    expect(result.text).toContain("main content");
    expect(result.text).not.toContain("Navigation links");
    expect(result.text).not.toContain("Footer content");
  });

  it("extracts from <article> element", async () => {
    const html = `
      <html><head><title>Blog Post</title></head><body>
        <article>
          <h1>My Blog Post</h1>
          <p>This is a blog article about testing content extraction.</p>
          <p>Second paragraph with more details about the topic.</p>
        </article>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractContent(page);

    expect(result.text).toContain("Blog Post");
    expect(result.text).toContain("testing content extraction");
  });

  it("falls back to <body> when no main/article", async () => {
    const html = `
      <html><head><title>Simple Page</title></head><body>
        <p>Just a simple page with some body content.</p>
        <p>Another paragraph in the body element.</p>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractContent(page);

    expect(result.title).toBe("Simple Page");
    expect(result.text).toContain("simple page");
  });

  it("strips navigation elements", async () => {
    const html = `
      <html><head><title>Page</title></head><body>
        <main>
          <nav>
            <a href="/home">Home</a>
            <a href="/about">About</a>
          </nav>
          <p>Main content paragraph with useful information.</p>
          <div class="navigation">Sub nav item</div>
        </main>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractContent(page);

    expect(result.text).toContain("Main content");
    expect(result.text).not.toContain("Home");
    expect(result.text).not.toContain("About");
  });

  it("strips sidebar elements", async () => {
    const html = `
      <html><head><title>Page</title></head><body>
        <main>
          <aside class="sidebar">
            <p>Sidebar content with links</p>
          </aside>
          <p>Primary content that should be kept.</p>
        </main>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractContent(page);

    expect(result.text).toContain("Primary content");
    expect(result.text).not.toContain("Sidebar content");
  });

  it("strips footer elements", async () => {
    const html = `
      <html><head><title>Page</title></head><body>
        <main>
          <p>Article content here with enough text.</p>
          <footer>
            <p>Copyright 2024 Example Corp</p>
          </footer>
        </main>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractContent(page);

    expect(result.text).toContain("Article content");
  });

  it("strips ad elements", async () => {
    const html = `
      <html><head><title>Page</title></head><body>
        <main>
          <div class="ad">Buy our product now!</div>
          <div class="advertisement">Sponsored content</div>
          <p>Real article content about testing.</p>
        </main>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractContent(page);

    expect(result.text).toContain("Real article content");
    expect(result.text).not.toContain("Buy our product");
    expect(result.text).not.toContain("Sponsored content");
  });

  it("strips cookie banners", async () => {
    const html = `
      <html><head><title>Page</title></head><body>
        <main>
          <div class="cookie-banner">We use cookies on this site</div>
          <div id="cookie-banner">Accept all cookies</div>
          <p>Article content that matters for the reader.</p>
        </main>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractContent(page);

    expect(result.text).toContain("Article content");
    expect(result.text).not.toContain("cookies");
  });

  it("handles GitHub README extraction", async () => {
    const html = `
      <html><head><title>owner/repo · GitHub</title></head><body>
        <article class="markdown-body">
          <h1>Project Title</h1>
          <p>This is a README file for an awesome project.</p>
          <h2>Installation</h2>
          <p>npm install my-package</p>
          <svg class="octicon">icon</svg>
        </article>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractContent(page);

    expect(result.title).toBe("owner/repo");
    expect(result.html).not.toContain("octicon");
    expect(result.html).toContain("Project Title");
  });

  it("cleans GitHub suffix from title", async () => {
    const html = `
      <html><head><title>owner/repo - GitHub</title></head><body>
        <article class="markdown-body">
          <p>README content here.</p>
        </article>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractContent(page);

    expect(result.title).toBe("owner/repo");
    expect(result.title).not.toContain("GitHub");
  });

  it("cleans Model Context Protocol suffix from title", async () => {
    const html = `
      <html><head><title>Tool Docs - Model Context Protocol</title></head><body>
        <article class="markdown-body">
          <p>Documentation content here.</p>
        </article>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractContent(page);

    expect(result.title).toBe("Tool Docs");
    expect(result.title).not.toContain("Model Context Protocol");
  });

  it("handles empty page gracefully", async () => {
    const html = `
      <html><head><title></title></head><body></body></html>
    `;
    const page = createPage(html);
    const result = await extractContent(page);

    expect(result.title).toBe("");
    expect(result.text.trim()).toBe("");
  });

  it("strips 'Skip to content' text", async () => {
    const html = `
      <html><head><title>Page</title></head><body>
        <main>
          <a href="#content">Skip to main content</a>
          <p>Actual content paragraph that contains useful information.</p>
        </main>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractContent(page);

    expect(result.text).not.toContain("Skip to");
    expect(result.text).toContain("Actual content");
  });

  it("strips Sign in/Sign up text", async () => {
    const html = `
      <html><head><title>Page</title></head><body>
        <main>
          <p>Sign in to your account or Sign up for free</p>
          <p>Real content about technology topics here.</p>
        </main>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractContent(page);

    expect(result.text).toContain("Real content");
  });

  it("strips hidden elements (display:none)", async () => {
    const html = `
      <html><head><title>Page</title></head><body>
        <main>
          <div style="display: none">Hidden content</div>
          <p>Visible content paragraph.</p>
        </main>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractContent(page);

    expect(result.text).toContain("Visible content");
    expect(result.text).not.toContain("Hidden content");
  });

  it("strips hidden elements (visibility:hidden)", async () => {
    const html = `
      <html><head><title>Page</title></head><body>
        <main>
          <div style="visibility: hidden">Also hidden</div>
          <p>Visible paragraph text.</p>
        </main>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractContent(page);

    expect(result.text).toContain("Visible paragraph");
    expect(result.text).not.toContain("Also hidden");
  });

  it("truncates HTML at 100k characters", async () => {
    const longContent = "A".repeat(150_000);
    const html = `
      <html><head><title>Long Page</title></head><body>
        <main><p>${longContent}</p></main>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractContent(page);

    expect(result.html.length).toBeLessThanOrEqual(100_000);
  });

  it("extracts from .prose element", async () => {
    const html = `
      <html><head><title>Docs</title></head><body>
        <div class="prose">
          <h1>Documentation</h1>
          <p>Documentation content about the API endpoints.</p>
        </div>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractContent(page);

    expect(result.text).toContain("Documentation content");
  });

  it("extracts from [role=main] element", async () => {
    const html = `
      <html><head><title>Page</title></head><body>
        <div role="main">
          <p>Role main content area with useful text.</p>
        </div>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractContent(page);

    expect(result.text).toContain("Role main content");
  });

  it("extracts from .md-content element", async () => {
    const html = `
      <html><head><title>MkDocs Page</title></head><body>
        <div class="md-content">
          <p>MkDocs generated content about the project.</p>
        </div>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractContent(page);

    expect(result.text).toContain("MkDocs generated");
  });

  it("extracts from .post-content element", async () => {
    const html = `
      <html><head><title>Blog</title></head><body>
        <div class="post-content">
          <p>Blog post content about testing.</p>
        </div>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractContent(page);

    expect(result.text).toContain("Blog post content");
  });

  it("strips search boxes", async () => {
    const html = `
      <html><head><title>Page</title></head><body>
        <main>
          <div class="search-box">
            <input type="text" placeholder="Search..." />
          </div>
          <p>Content paragraph with meaningful text.</p>
        </main>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractContent(page);

    expect(result.text).toContain("Content paragraph");
    expect(result.text).not.toContain("Search");
  });

  it("strips pagination elements", async () => {
    const html = `
      <html><head><title>Page</title></head><body>
        <main>
          <div class="pagination">Page 1 2 3 Next</div>
          <p>Actual page content about the topic.</p>
        </main>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractContent(page);

    expect(result.text).toContain("Actual page content");
    expect(result.text).not.toContain("Page 1 2 3");
  });

  it("strips newsletter/subscribe elements", async () => {
    const html = `
      <html><head><title>Page</title></head><body>
        <main>
          <div class="newsletter">Subscribe to our newsletter</div>
          <div class="subscribe">Get updates via email</div>
          <p>Main article text about the subject matter.</p>
        </main>
      </body></html>
    `;
    const page = createPage(html);
    const result = await extractContent(page);

    expect(result.text).toContain("Main article text");
    expect(result.text).not.toContain("Subscribe");
    expect(result.text).not.toContain("Get updates");
  });
});
