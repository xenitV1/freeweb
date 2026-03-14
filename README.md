# FreeWeb MCP Server

A secure, Playwright-based MCP (Model Context Protocol) server for web browsing and GitHub search. Provides tools for AI assistants to browse pages, search GitHub, and extract web content.

## Features

- 🔒 **Security**: URL validation, download protection, blocked domain filter
- 📅 **Freshness Control**: Page date detection, stale content warnings
- ⚡ **SPA Support**: Auto-detection and handling of React/Vue/Next.js apps
- 🔄 **Parallel Processing**: Browse multiple URLs concurrently
- 🐙 **GitHub Integration**: Search repos, list files, view READMEs

## Quick Start

### Using with npx (Recommended)

Add to your MCP client config (Claude Desktop, Cursor, etc.):

```json
{
  "mcpServers": {
    "freeweb": {
      "command": "npx",
      "args": ["-y", "github:xenitV1/freeweb"]
    }
  }
}
```

Or run directly:

```bash
npx -y github:xenitV1/freeweb
```

### Local Installation

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
| `github_search` | Search GitHub repos, code, or issues |
| `browse_page` | Visit URL and extract content |
| `smart_browse` | SPA-aware browsing with date validation |
| `deep_search` | Search across GitHub, npm, MDN |
| `github_repo_files` | List files in a GitHub repo |
| `parallel_browse` | Visit multiple URLs in parallel (max 5) |
| `get_page_links` | Extract all links from a page |
| `screenshot` | Capture page screenshot (base64 PNG) |

## Security Rules

- ✅ Only HTTPS URLs are visited
- ✅ Suspicious domains are blocked
- ✅ Downloads require explicit user approval
- ✅ No forms filled, no logins, no payments
- ✅ IP addresses are blocked

## Content Freshness

Every page visit includes:
- Automatic page date detection
- Stale content warnings (>12 months old)
- `requireFreshContent` option to enforce fresh content only

## Examples

```javascript
// Search GitHub
github_search({
  query: "three.js",
  type: "repos",
  sortByUpdated: true
})

// Smart browse with freshness check
smart_browse({
  url: "https://docs.example.com/guide",
  requireFreshContent: true,
  maxAgeMonths: 6
})

// Parallel browsing
parallel_browse({
  urls: [
    "https://github.com/owner/repo1",
    "https://github.com/owner/repo2"
  ]
})

// Deep search across sources
deep_search({
  query: "react hooks tutorial",
  sources: ["github", "npm", "mdn"],
  maxAgeMonths: 6
})
```

## Configuration Options

### MCP Client Config

```json
{
  "mcpServers": {
    "freeweb": {
      "command": "npx",
      "args": ["-y", "github:xenitV1/freeweb"],
      "env": {
        "PLAYWRIGHT_BROWSERS_PATH": "0"
      }
    }
  }
}
```

## Requirements

- Node.js >= 18
- Playwright (auto-installed on first run)

## Development

```bash
npm install
npm run dev      # Watch mode
npm run build    # Build
npm start        # Run
```

## License

MIT
