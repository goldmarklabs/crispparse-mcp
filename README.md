[![Listed on mcpservers.org](https://mcpservers.org/badge.svg)](https://mcpservers.org/servers/goldmarklabs/crispparse-mcp) [![CrispParse MCP on mcprush](https://mcprush.com/badge/crispparse-mcp/score.svg)](https://mcprush.com/to/crispparse-mcp?ref=badge)

# CrispParse MCP Server

[![CrispParse MCP Server MCP server – quality and maintenance score on Glama](https://glama.ai/mcp/servers/goldmarklabs/crispparse-mcp/badges/card.svg)](https://glama.ai/mcp/servers/goldmarklabs/crispparse-mcp)

A self-contained Model Context Protocol (`stdio`) server built with `@modelcontextprotocol/sdk` that exposes deterministic web extraction (Markdown, JSON, Hybrid, CSS selectors, Tier 2/3 stealth rendering) and C2PA v2.4 provenance verification to MCP-compatible AI agents and desktop clients (Claude Desktop, Cursor, Windsurf, and Cline).

## How It Works

This repository implements a local MCP `stdio` server (`index.js`) using `StdioServerTransport`:
1. Registers MCP `tools/list` and `tools/call` handlers via `@modelcontextprotocol/sdk`.
2. Auto-provisions a free 50-credit trial Macaroon (`~/.crispparse/trial_token.json`) if no API key or `x402` Base USDC payment header is supplied.
3. Executes upstream extraction requests against the CrispParse 3-tier waterfall engine (`https://api.crispparse.com/v1/extract`) with Zero Payload Retention (ZDR) and returns clean Markdown, structured JSON, and a signed C2PA provenance manifest.

## Available Tools

### `crispparse_extract`
Extracts clean, LLM-ready Markdown, structured JSON, or Hybrid output from any public webpage URL across CrispParse's 3-tier waterfall (static HTTP, headless JS rendering, and self-healing CSS selectors).

* **`url`** (`string`, required): The full `http://` or `https://` URL to extract.
* **`mode`** (`string`, optional, default `"markdown"`): Output format (`"markdown"`, `"json"`, or `"hybrid"`).
* **`selectors`** (`object`, optional): Map of `field_name -> CSS selector` (up to 30 fields). Automatically triggers Tier 2 JS rendering and Tier 3 self-healing selector recovery if needed.
* **`bypass_cache`** (`boolean`, optional, default `false`): Set `true` to bypass edge cache and force a fresh live extraction.
* **`api_key`** (`string`, optional): CrispParse Macaroon bearer token (overrides `CRISPPARSE_API_KEY`).
* **`payment_signature`** (`string`, optional): `x402` v2 `PAYMENT-SIGNATURE` Base USDC proof header (overrides `CRISPPARSE_PAYMENT_SIGNATURE`).

### `crispparse_claim_trial`
Claims or retrieves a cached zero-config CrispParse trial Macaroon token (50 credits, 14-day TTL) for immediate extraction without manual signup.

* **`force_refresh`** (`boolean`, optional, default `false`): Request a fresh trial token instead of returning the cached token.

### `crispparse_verify`
Cryptographically verifies a detached C2PA v2.4 provenance manifest returned by `crispparse_extract` against `https://api.crispparse.com/v1/verify`.

* **`provenance`** (`object`, required): The `provenance` object from a CrispParse extraction response.

## MCP Client Configuration

### Zero-Install via `npx` (Recommended)
Add the server to your Claude Desktop (`claude_desktop_config.json`) or Cursor MCP configuration:

```json
{
  "mcpServers": {
    "crispparse": {
      "command": "npx",
      "args": ["-y", "crispparse-mcp@1.0.7"]
    }
  }
}
```

### Run from Local Clone (Node.js v18+)

```bash
git clone https://github.com/goldmarklabs/crispparse-mcp.git
cd crispparse-mcp
npm install
CRISPPARSE_API_KEY="your_api_key" node index.js
```

### Run with Docker

```bash
docker build -t crispparse-mcp .
docker run -i --rm -e CRISPPARSE_API_KEY="your_api_key" crispparse-mcp
```

## Environment Variables

* `CRISPPARSE_API_KEY`: Optional Bearer Macaroon API key from [crispparse.com](https://crispparse.com).
* `CRISPPARSE_AUTO_CLAIM_TRIAL`: Set `"false"` to disable automatic trial token provisioning (defaults to `"true"`, falling back to an `x402` Base USDC payment challenge when unauthenticated).
* `CRISPPARSE_PAYMENT_SIGNATURE`: Optional default `x402` v2 `PAYMENT-SIGNATURE` Base USDC proof header.
* `CRISPPARSE_API_URL`: Optional upstream endpoint override (defaults to `https://api.crispparse.com/v1/extract`).

## License

MIT — see [LICENSE](./LICENSE).

## Instant URL Prefix & Indirect Prompt-Injection Shield

* **Zero-Setup URL Prefix (`GET /r/<url>`):** Prepend `https://api.crispparse.com/r/` to any URL (e.g., `https://api.crispparse.com/r/https://example.com`) for instant LLM-ready Markdown (`text/markdown`), real token-savings headers (`X-CrispParse-Tokens-Saved`), 10/hr keyless preview, or autonomous `x402` Base Mainnet USDC micro-settlement.
* **Indirect Prompt-Injection Shield (`security_audit`):** Automatically strips hidden CSS injection vectors (`display:none`, `visibility:hidden`, `opacity:0`, `font-size:0`, `[hidden]`) before Markdown conversion and returns a structured `security_audit` report (`prompt_injection_detected`, `threat_level`, `hidden_vectors_stripped`, `matched_rules`) on every response.
