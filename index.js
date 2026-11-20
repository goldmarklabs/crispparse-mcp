#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const API_URL = process.env.CRISPPARSE_API_URL || "https://api.crispparse.com/v1/extract";
const TRIAL_URL = process.env.CRISPPARSE_TRIAL_URL || API_URL.replace(/\/v1\/extract\/?$/, "/v1/trial/claim");
const DEFAULT_API_KEY = process.env.CRISPPARSE_API_KEY || "";
const DEFAULT_PAYMENT_SIGNATURE = process.env.CRISPPARSE_PAYMENT_SIGNATURE || "";
const AUTO_CLAIM_TRIAL = process.env.CRISPPARSE_AUTO_CLAIM_TRIAL !== "false";
const CACHE_FILE = path.join(os.homedir(), ".crispparse", "trial_token.json");

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function readCachedTrialToken() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.token === "string" && parsed.token.length > 0) {
      return parsed.token;
    }
  } catch {}
  return "";
}

function writeCachedTrialToken(token) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true, mode: 0o700 });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ token, claimed_at: new Date().toISOString() }, null, 2), { mode: 0o600 });
  } catch {}
}

function clearCachedTrialToken() {
  try {
    fs.unlinkSync(CACHE_FILE);
  } catch {}
}

async function claimTrialToken(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = readCachedTrialToken();
    if (cached) return { token: cached, source: "cache" };
  }
  const res = await fetch(TRIAL_URL, { method: "POST" });
  const text = await res.text();
  const data = safeJson(text);
  if (!res.ok || !data || typeof data.macaroon_token !== "string") {
    throw new Error(typeof data === "object" && data?.detail ? data.detail : `Trial claim failed (${res.status}): ${text}`);
  }
  writeCachedTrialToken(data.macaroon_token);
  return { token: data.macaroon_token, source: "claimed", details: data };
}

const server = new Server(
  { name: "crispparse-mcp-server", version: "1.0.2" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "crispparse_extract",
      description: "Extract clean, LLM-ready Markdown or structured JSON from any public URL using CrispParse (auto-provisions a free 50-credit trial Macaroon if no API key or x402 PAYMENT-SIGNATURE is configured).",
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
    },
    {
      name: "crispparse_claim_trial",
      description: "Claim or retrieve a cached zero-config CrispParse trial Macaroon token (50 credits, 14-day TTL) for immediate extraction without manual signup.",
      inputSchema: {
        type: "object",
        properties: {
          force_refresh: { type: "boolean", description: "Request a fresh trial token instead of returning the cached token." }
        }
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  if (params.name === "crispparse_claim_trial") {
    try {
      const result = await claimTrialToken(Boolean(params.arguments?.force_refresh));
      return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify({ status: "ok", source: result.source, macaroon_token: result.token, cache_path: CACHE_FILE }) }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }]
      };
    }
  }

  if (params.name !== "crispparse_extract") {
    return { isError: true, content: [{ type: "text", text: `Unknown tool: ${params.name}` }] };
  }

  const targetUrl = params.arguments?.url;
  const mode = params.arguments?.mode === "json" ? "json" : "markdown";
  let apiKey = (typeof params.arguments?.api_key === "string" && params.arguments.api_key) || DEFAULT_API_KEY;
  const paymentSignature = (typeof params.arguments?.payment_signature === "string" && params.arguments.payment_signature) || DEFAULT_PAYMENT_SIGNATURE;

  if (!targetUrl || typeof targetUrl !== "string") {
    return { isError: true, content: [{ type: "text", text: "Missing required parameter: url" }] };
  }

  let usedTrialCache = false;
  if (!apiKey && !paymentSignature && AUTO_CLAIM_TRIAL) {
    try {
      const trial = await claimTrialToken(false);
      apiKey = trial.token;
      usedTrialCache = true;
    } catch {
      // Fall through to unauthenticated request so the agent still receives the x402 402 payment challenge
    }
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

    if ((response.status === 401 || response.status === 402) && usedTrialCache) {
      clearCachedTrialToken();
    }

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
