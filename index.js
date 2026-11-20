#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const API_URL = process.env.CRISPPARSE_API_URL || "https://api.crispparse.com/v1/extract";
const API_KEY = process.env.CRISPPARSE_API_KEY || "";

const server = new Server(
  { name: "crispparse-mcp-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "crispparse_extract",
      description: "Extract clean, LLM-ready Markdown or structured JSON from any public URL using CrispParse.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The full http:// or https:// URL to extract." },
          mode: { type: "string", enum: ["markdown", "json"], description: "Output format (defaults to markdown)." }
        },
        required: ["url"]
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  if (params.name !== "crispparse_extract") {
    return { isError: true, content: [{ type: "text", text: `Unknown tool: ${params.name}` }] };
  }
  const targetUrl = params.arguments?.url;
  const mode = params.arguments?.mode === "json" ? "json" : "markdown";
  if (!targetUrl || typeof targetUrl !== "string") {
    return { isError: true, content: [{ type: "text", text: "Missing required parameter: url" }] };
  }
  try {
    const headers = {
      "Content-Type": "application/json",
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {})
    };
    const response = await fetch(API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: targetUrl, mode })
    });
    return { isError: !response.ok, content: [{ type: "text", text: await response.text() }] };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: `CrispParse request failed: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
});

await server.connect(new StdioServerTransport());
