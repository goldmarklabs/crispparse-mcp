#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const API_URL = process.env.CRISPPARSE_API_URL || "https://api.crispparse.com/v1/extract";
const DEFAULT_API_KEY = process.env.CRISPPARSE_API_KEY || "";
const DEFAULT_PAYMENT_SIGNATURE = process.env.CRISPPARSE_PAYMENT_SIGNATURE || "";

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const server = new Server(
  { name: "crispparse-mcp-server", version: "1.0.1" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "crispparse_extract",
      description: "Extract clean, LLM-ready Markdown or structured JSON from any public URL using CrispParse (supports Bearer Macaroon or x402 PAYMENT-SIGNATURE Base USDC proof).",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The full http:// or https:// URL to extract." },
          mode: { type: "string", enum: ["markdown", "json"], description: "Output format (defaults to markdown)." },
          api_key: { type: "string", description: "Optional CrispParse Macaroon bearer token (overrides CRISPPARSE_API_KEY)." },
          payment_signature: { type: "string", description: "Optional x402 v2 PAYMENT-SIGNATURE Base USDC proof header (overrides CRISPPARSE_PAYMENT_SIGNATURE)." }
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
  const apiKey = (typeof params.arguments?.api_key === "string" && params.arguments.api_key) || DEFAULT_API_KEY;
  const paymentSignature = (typeof params.arguments?.payment_signature === "string" && params.arguments.payment_signature) || DEFAULT_PAYMENT_SIGNATURE;

  if (!targetUrl || typeof targetUrl !== "string") {
    return { isError: true, content: [{ type: "text", text: "Missing required parameter: url" }] };
  }

  try {
    const headers = {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(paymentSignature ? { "PAYMENT-SIGNATURE": paymentSignature } : {})
    };

    const response = await fetch(API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: targetUrl, mode })
    });

    const bodyText = await response.text();

    if (response.status === 402) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: 402,
              paymentRequired: response.headers.get("payment-required"),
              body: safeJson(bodyText)
            })
          }
        ]
      };
    }

    const paymentResponse = response.headers.get("payment-response");
    if (response.ok && paymentResponse) {
      return {
        isError: false,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              paymentResponse,
              result: safeJson(bodyText)
            })
          }
        ]
      };
    }

    return { isError: !response.ok, content: [{ type: "text", text: bodyText }] };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: `CrispParse request failed: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
});

await server.connect(new StdioServerTransport());
