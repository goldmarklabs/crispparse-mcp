#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const API = "https://api.crispparse.com/v1/extract";
const KEY = process.env.CRISPPARSE_API_KEY || "";
const s = new Server({ name: "crispparse", version: "1.0.0" }, { capabilities: { tools: {} } });

s.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: "crispparse_extract", description: "Extract clean markdown/JSON from any URL via CrispParse", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } }]
}));
s.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  const h = { "Content-Type": "application/json", ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}) };
  const r = await fetch(API, { method: "POST", headers: h, body: JSON.stringify({ url: params.arguments.url, mode: "markdown" }) });
  return { content: [{ type: "text", text: await r.text() }] };
});
await s.connect(new StdioServerTransport());
