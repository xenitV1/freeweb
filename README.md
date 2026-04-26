# FreeWeb MCP Server

**Give your LLM unlimited web access - no API keys, no rate limits, no restrictions.**

A multi-layer MCP (Model Context Protocol) server for web browsing, search, and content extraction. Uses a **fetcher chain** with 7 fallback layers — from ultra-fast native `fetch()` (~43ms) to full Playwright browser automation (~3-5s). No API keys required.

## Why FreeWeb?

- 🚀 **No API Keys Required** - Uses real browser automation and native HTTP, not paid APIs
- ⚡ **Multi-Layer Fetcher Chain** - Fast static pages in ~400ms, only uses heavy browser when needed
- ♾️ **No Rate Limits** - Browse as much as you need, no quotas or throttling
- 🌐 **True Web Access** - Your LLM can visit any website, extract content, follow links
- 🔓 **100% Free & Open Source** - No subscriptions, no hidden costs, no vendor lock-in

## Fetcher Chain Architecture

Every URL request goes through 7 fetcher layers, tried in order. First success wins:

| Priority | Fetcher | Speed | Best For |
|----------|---------|-------|----------|
| 5 | **llms.txt + Markdown** | ~300ms | Sites with `.md` variants |
| 10 | **GitHub Raw** | ~43ms | GitHub READMEs and files |
| 30 | **RSS/Atom Feed** | ~450ms | Blogs, news sites |
| 40 | **fetch() + jsdom** | ~400ms | Static HTML pages (~80% of web) |
| 80 | **Archive.org Cache** | ~1.2s | Dead/blocked pages |
| 100 | **Playwright** | ~3-5s | SPA apps, bot-protected sites |

This means most pages load **10x faster** than Playwright-only, while still falling back to full browser automation when needed.

## Features

- 🔎 **General Web Search**: Search the public web without API keys (Yahoo, DuckDuckGo, Marginalia, Ask)
- 📚 **Search + Browse**: Open the best search hits and extract readable page content
- 🔍 **LLMS.txt Inspection**: Inspect and debug `llms.txt` files directly
- 🤖 **LLMS.txt Aware Browsing**: If a site exposes `llms.txt`, FreeWeb reads it first and includes the guidance in browse output
- 🧭 **Best Next Page Routing**: With a query, FreeWeb can follow the most relevant same-site `llms.txt` link before browsing
- 📝 **Markdown Fallback**: For llms-aware sites, tries `.md` page variants before falling back to HTML extraction
- 🐙 **GitHub Raw Access**: READMEs and files fetched directly from `raw.githubusercontent.com` (~43ms)
- 📡 **RSS/Atom Feed Support**: Auto-discover and parse feeds from blogs and news sites
- 🧠 **Result Quality Ranking**: Domain-aware scoring, snippet cleanup, freshness hints, deduping, and optional `llms.txt` badges in search results
- 🔒 **Security**: URL validation, download protection, blocked domain filter
- 📅 **Freshness Control**: Page date detection, stale content warnings
- ⚡ **SPA Support**: Auto-detection and handling of React/Vue/Next.js apps
- 🔄 **Parallel Processing**: Browse multiple URLs concurrently
- 🛡️ **Anti-Bot Measures**: Stealth browser techniques for reliable access

## Installation

### Using with npx (Recommended)

Add to your MCP client config (Claude Desktop, Cursor, Kilo, Windsurf, etc.):

```json
{
  "mcpServers": {
    "freeweb": {
      "command": "npx",
      "args": ["-y", "freeweb-mcp@latest"]
    }
  }
}
```

### Using with npm

```bash
npm install -g freeweb-mcp@latest
```

Then add to your MCP config:

```json
{
  "mcpServers": {
    "freeweb": {
      "command": "freeweb-mcp"
    }
  }
}
```

### From Source

```bash
git clone https://github.com/xenitV1/freeweb.git
cd freeweb
npm install
npm run build
```

Then add to your MCP config:

```json
{
  "mcpServers": {
    "freeweb": {
      "command": "node",
      "args": ["/path/to/freeweb/dist/index.js"]
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `inspect_llms_txt` | Inspect and parse a site's `llms.txt` guidance |
| `web_search` | Search the public web without API keys |
| `search_and_browse` | Search the web, open the best hits, route via `llms.txt` when relevant, and extract content |
| `browse_page` | Visit URL, read `llms.txt` if present, optionally route to a better page, and extract content |
| `smart_browse` | SPA-aware browsing with date validation, `llms.txt` guidance, and optional llms routing |
| `deep_search` | Search across GitHub, npm, MDN |
| `github_search` | Search GitHub repos, code, or issues |
| `github_repo_files` | List files in a GitHub repo |
| `parallel_browse` | Visit multiple URLs in parallel (max 5) |
| `get_page_links` | Extract all links from a page |
| `screenshot` | Capture page screenshot (base64 PNG) |

## Configuration Options

### MCP Client Config

```json
{
  "mcpServers": {
    "freeweb": {
      "command": "npx",
      "args": ["-y", "freeweb-mcp@latest"],
      "env": {
        "PLAYWRIGHT_BROWSERS_PATH": "0"
      }
    }
  }
}
```

## Security Rules

- ✅ Only HTTPS/HTTP URLs are visited
- ✅ Suspicious domains are blocked
- ✅ Downloads require explicit user approval
- ✅ No forms filled, no logins, no payments
- ✅ IP addresses are blocked

## Content Freshness

Every page visit includes:
- Automatic page date detection
- Stale content warnings (>12 months old)
- `requireFreshContent` option to enforce fresh content only

## Requirements

- Node.js >= 18
- Playwright (auto-installed on first run)

## Development

```bash
npm install
npm run dev      # Watch mode
npm run build    # Build
npm start        # Run
npm test         # Run tests
```

## License

MIT
