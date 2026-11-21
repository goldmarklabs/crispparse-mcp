#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const API_URL = process.env.CRISPPARSE_API_URL || "https://api.crispparse.com/v1/extract";
const TRIAL_URL = process.env.CRISPPARSE_TRIAL_URL || API_URL.replace(/\/v1\/extract\/?$/, "/v1/trial/claim");
const VERIFY_URL = process.env.CRISPPARSE_VERIFY_URL || API_URL.replace(/\/v1\/extract\/?$/, "/v1/verify");
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
  { name: "crispparse-mcp-server", version: "1.0.3" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "crispparse_extract",
      description: "Extract clean, LLM-ready Markdown, structured JSON, or Hybrid output from any public URL using CrispParse's deterministic 3-tier waterfall (static HTTP, headless JS render, and self-healing CSS selectors) with C2PA provenance.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The full http:// or https:// URL to extract." },
          mode: {
            type: "string",
            enum: ["markdown", "json", "hybrid"],
            description: "Output format: 'markdown' (default), 'json' (structured fields/JSON-LD), or 'hybrid' (both Markdown and structured data)."
          },
          selectors: {
            type: "object",
            additionalProperties: { type: "string" },
            description: "Optional map of field_name -> CSS selector (up to 30 fields). Automatically triggers Tier 2 JS rendering and Tier 3 self-healing selector recovery if needed."
          },
          bypass_cache: {
            type: "boolean",
            description: "Set true to bypass edge cache and force a fresh live extraction (defaults to false)."
          },
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
    },
    {
      name: "crispparse_verify",
      description: "Cryptographically verify a detached C2PA v2.4 provenance manifest returned by crispparse_extract.",
      inputSchema: {
        type: "object",
        properties: {
          provenance: {
            type: "object",
            description: "The 'provenance' object from a CrispParse extraction response."
          }
        },
        required: ["provenance"]
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

  if (params.name === "crispparse_verify") {
    const provenance = params.arguments?.provenance;
    if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) {
      return { isError: true, content: [{ type: "text", text: "Missing or invalid parameter: provenance object" }] };
    }
    try {
      const response = await fetch(VERIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(provenance)
      });
      const bodyText = await response.text();
      return { isError: !response.ok, content: [{ type: "text", text: bodyText }] };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `CrispParse verify request failed: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }

  if (params.name !== "crispparse_extract") {
    return { isError: true, content: [{ type: "text", text: `Unknown tool: ${params.name}` }] };
  }

  const targetUrl = params.arguments?.url;
  const rawMode = params.arguments?.mode;
  const mode = (rawMode === "json" || rawMode === "hybrid") ? rawMode : "markdown";
  const rawSelectors = params.arguments?.selectors;
  const selectors = (rawSelectors && typeof rawSelectors === "object" && !Array.isArray(rawSelectors) && Object.keys(rawSelectors).length > 0)
    ? rawSelectors
    : undefined;
  const bypassCache = Boolean(params.arguments?.bypass_cache);

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

    const payload = {
      url: targetUrl,
      mode,
      ...(selectors ? { selectors } : {}),
      ...(bypassCache ? { bypass_cache: true } : {})
    };

    const response = await fetch(API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
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
