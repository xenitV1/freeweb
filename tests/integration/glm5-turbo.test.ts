import { describe, it, expect, afterEach } from "vitest";

const API_KEY = process.env.Z_API_KEY || "";
const API_URL = "https://api.z.ai/api/coding/paas/v4/chat/completions";
const MODEL = "glm-5-turbo";
const DELAY_MS = 20000;
const RETRY_DELAYS = [20000, 40000, 60000, 90000, 120000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503;
}

async function callGLM(
  messages: { role: string; content: string }[],
  options?: { max_tokens?: number; temperature?: number }
): Promise<{ content: string; raw: string }> {
  expect(API_KEY, "Z_API_KEY must be set").toBeTruthy();

  const payload = {
    model: MODEL,
    messages,
    max_tokens: options?.max_tokens ?? 4096,
    temperature: options?.temperature ?? 1.0,
    thinking: { type: "disabled" },
  };

  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
    console.log(`  [attempt ${attempt + 1}] Sending request to ${MODEL}...`);
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const bodyText = await response.text();
    console.log(`  [attempt ${attempt + 1}] Status: ${response.status}`);

    if (response.ok) {
      const data = JSON.parse(bodyText);
      expect(data.choices).toBeDefined();
      expect(data.choices.length).toBeGreaterThan(0);
      return {
        content: data.choices[0].message.content,
        raw: bodyText,
      };
    }

    if (isRetryable(response.status)) {
      const wait = RETRY_DELAYS[attempt];
      console.log(
        `  ${response.status} error, retry ${attempt + 1}/${RETRY_DELAYS.length}, waiting ${wait / 1000}s...`
      );
      await sleep(wait);
      continue;
    }

    throw new Error(`API returned ${response.status}: ${bodyText}`);
  }

  throw new Error(`API failed after ${RETRY_DELAYS.length} retries`);
}

afterEach(async () => {
  console.log(`  [afterEach] waiting ${DELAY_MS / 1000}s before next test...`);
  await sleep(DELAY_MS);
});

describe("GLM-4.7-Flash Critical Tests", () => {
  it("completes a basic chat request", async () => {
    const { content, raw } = await callGLM([
      { role: "user", content: "Say exactly: TEST_OK" },
    ]);
    console.log(`  API response: ${raw.substring(0, 300)}`);
    expect(content).toContain("TEST_OK");
  });

  it("can summarize a browsed page", async () => {
    const mockPageContent = `# FreeWeb MCP Server

URL: https://github.com/xenitV1/freeweb

Give your LLM unlimited web access - no API keys, no rate limits, no restrictions.

A secure, Playwright-based MCP server for web browsing, search, and content extraction.

## Features
- General Web Search without API keys
- LLM.txt aware browsing
- SPA support with auto-detection
- GitHub integration
- Anti-bot stealth measures`;

    const { content, raw } = await callGLM([
      {
        role: "user",
        content: `Summarize this page in exactly 2 sentences:\n\n${mockPageContent}`,
      },
    ]);
    console.log(`  API response: ${raw.substring(0, 300)}`);
    expect(content.length).toBeGreaterThan(30);
    expect(content.toLowerCase()).toMatch(/freeweb|mcp|web|search|playwright/);
  });

  it("can reason about llms.txt structure", async () => {
    const mockLlmsTxt = `# Example Site

> A developer documentation site

- [Getting Started](https://example.com/docs/quickstart): Quick start guide
- [API Reference](https://example.com/docs/api): REST endpoints

## Authentication

- [OAuth Setup](https://example.com/docs/auth/oauth): OAuth2 configuration
- [API Keys](https://example.com/docs/auth/keys): Managing API keys

## Optional

- [Changelog](https://example.com/changelog): Release history`;

    const { content, raw } = await callGLM([
      {
        role: "user",
        content: `Given this llms.txt file, which URL should I visit to learn about OAuth2 setup? Reply with ONLY the URL, nothing else.\n\n${mockLlmsTxt}`,
      },
    ]);
    console.log(`  API response: ${raw.substring(0, 300)}`);
    expect(content.trim()).toContain("https://example.com/docs/auth/oauth");
  });

  it("decides which FreeWeb tool to use for a search query", async () => {
    const toolDescriptions = `Available tools:
 1. web_search - Search the web without API keys. Params: query, maxResults, engine
 2. browse_page - Visit a URL and extract content. Params: url, query
 3. github_search - Search GitHub repos. Params: query, type
 4. get_page_links - Extract links from a page. Params: url
 5. screenshot - Take a screenshot. Params: url`;

    const { content, raw } = await callGLM([
      {
        role: "user",
        content: `${toolDescriptions}\n\nI want to find React hooks tutorials on the web. Which tool should I use and what parameters? Reply in JSON format: {"tool": "...", "params": {...}}`,
      },
    ]);
    console.log(`  API response: ${raw.substring(0, 300)}`);
    expect(content.toLowerCase()).toContain("web_search");
    expect(content.toLowerCase()).toMatch(/react|hooks/);
  });

  it("handles Turkish content translation correctly", async () => {
    const { content, raw } = await callGLM([
      {
        role: "user",
        content:
          "Aşağıdaki İngilizce metni Türkçeye çevir: 'FreeWeb is an MCP server that gives LLMs unlimited web access without API keys.'",
      },
    ]);
    console.log(`  API response: ${raw.substring(0, 300)}`);
    expect(content.toLowerCase()).toMatch(/web|mcp|api|anahtar|erişim/);
  });

  it("responds in Turkish", async () => {
    const { content, raw } = await callGLM([
      {
        role: "user",
        content:
          'Respond with exactly one word in Turkish that means "hello". Nothing else.',
      },
    ]);
    console.log(`  API response: ${raw.substring(0, 300)}`);
    expect(content.toLowerCase().trim()).toMatch(/merhaba|selam/);
  });
});
