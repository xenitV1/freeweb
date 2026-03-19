# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.2.0] - 2026-03-19

### Added
- **General Web Search**: Search the public web without API keys using multiple search engines (Yahoo, Marginalia, Ask.com)
- **Search + Browse**: Combined tool to search and automatically browse top results with content extraction
- **LLMS.txt Inspection**: New \`inspect_llms_txt\` tool to inspect and parse site llms.txt guidance files
- **LLMS.txt Aware Browsing**: Automatically reads llms.txt when available and includes guidance in browse output
- **Best Next Page Routing**: Query-intent based routing to the most relevant same-site page using llms.txt links
- **Markdown Fallback**: Tries .md page variants before falling back to HTML extraction for llms-aware sites
- **Result Quality Ranking**: Domain-aware scoring, snippet cleanup, freshness hints, deduplication, and optional llms.txt badges

### Changed
- Improved search result parsing with multi-engine support (Yahoo, Ask.com, Marginalia, Google, Bing, DuckDuckGo)
- Refined download blocking heuristics (block-list approach instead of allow-list)
- Relaxed TLD blocking (removed blanket blocks on .tk, .ml, .ga, .cf, .gq, .xyz)

## [0.1.0] - 2026-03-18

### Added
- Initial release
- Playwright-based MCP server for web browsing
- GitHub repository search and file listing
- Page browsing with content extraction
- SPA detection and handling
- Freshness control with date detection
- URL validation and security features

