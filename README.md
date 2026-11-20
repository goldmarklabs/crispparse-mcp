# CrispParse MCP Server

[![CrispParse MCP Server MCP server – quality and maintenance score on Glama](https://glama.ai/mcp/servers/goldmarklabs/crispparse-mcp/badges/card.svg)](https://glama.ai/mcp/servers/goldmarklabs/crispparse-mcp)

A self-contained Model Context Protocol (`stdio`) server implementation built with `@modelcontextprotocol/sdk` that exposes deterministic web extraction tools to MCP-compatible AI agents and desktop clients (Claude Desktop, Cursor, Windsurf, and Cline).

## How It Works

This repository implements a local MCP `stdio` server (`index.js`) using `StdioServerTransport`:
1. Registers MCP `tools/list` and `tools/call` handlers via `@modelcontextprotocol/sdk`.
2. Exposes the `crispparse_extract` tool with JSON Schema input validation.
3. Executes upstream extraction requests against the CrispParse extraction engine (`https://api.crispparse.com/v1/extract`) and returns clean Markdown or JSON over `stdio`.

## Available Tools

### `crispparse_extract`
Extracts clean, LLM-ready Markdown or structured JSON from any public webpage URL.

* **`url`** (`string`, required): The full `http://` or `https://` URL to extract.
* **`mode`** (`string`, optional, default `"markdown"`): Output format (`"markdown"` or `"json"`).

## Installation & Local Execution

### Run with Node.js (v18+)

    git clone https://github.com/goldmarklabs/crispparse-mcp.git
    cd crispparse-mcp
    npm install
    CRISPPARSE_API_KEY="your_api_key" node index.js

### Run with Docker

    docker build -t crispparse-mcp .
    docker run -i --rm -e CRISPPARSE_API_KEY="your_api_key" crispparse-mcp

## MCP Client Configuration

Add the server to your Claude Desktop (`claude_desktop_config.json`) or Cursor MCP configuration:

    {
      "mcpServers": {
        "crispparse": {
          "command": "node",
          "args": ["/absolute/path/to/crispparse-mcp/index.js"],
          "env": {
            "CRISPPARSE_API_KEY": "your_api_key"
          }
        }
      }
    }

## Environment Variables

* `CRISPPARSE_API_KEY`: Optional Bearer Macaroon API key from [crispparse.com](https://crispparse.com) (requests without a key receive an `x402` Base USDC payment challenge).
* `CRISPPARSE_API_URL`: Optional upstream endpoint override (defaults to `https://api.crispparse.com/v1/extract`).

## License

MIT — see [LICENSE](./LICENSE).
