#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";
import { browserManager } from "./browser.js";

const server = new McpServer({
  name: "freeweb",
  version: "3.4.0",
});

registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);

async function gracefulShutdown(): Promise<void> {
  await browserManager.close().catch(() => {});
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown());
process.on("SIGINT", () => gracefulShutdown());
