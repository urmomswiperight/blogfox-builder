# Content & SEO Tools — ChatGPT Plugin & MCP Server

A lightweight, zero-dependency, local Node + TypeScript server providing 3 SEO automation buttons/tools for ChatGPT. Runs on port `3002`.

Built strictly using **local logic**, **no paid services**, and **no company names**.

---

## 🔘 The 3 Buttons & Exact User Search Phrases

In accordance with the ChatGPT plugin distribution strategy, every tool and button is described using the **exact phrases people type into ChatGPT**:

| Button / Tool Name | Exact ChatGPT Search Phrase | Description |
| :--- | :--- | :--- |
| `generate_blog_outline` | **"write a blog outline"** | Builds a comprehensive blog outline from a keyword and target audience, including section headings, an FAQ block, estimated word counts, and on-page SEO guidance. Titles are capped at 60 characters and meta descriptions at 155. |
| `bulk_generate_metadata` | **"generate meta descriptions for many posts"** | Writes SEO-optimized titles and meta descriptions for up to 20 posts at once (minimum 1). Enforces a strict $\le 20$ posts boundary with validation error handling, and guarantees unique URL slugs across the batch. |
| `plan_content_calendar` | **"plan my content calendar"** | Makes a structured 4-week posting schedule rotating through a list of keywords with content formats and publication dates. Defaults to 3 posts/week (Mon/Wed/Fri, 12 total posts); optional `posts_per_week` accepts a whole number from 1 to 7 (0 and 8+ are rejected with a clear validation error). |

---

## 🚀 How to Install and Run

### Prerequisites
- Node.js (v18+ or v20+)
- npm (v9+)

### Installation
```bash
cd mcp-server
npm install
npm run build
```

### Running the Server
```bash
npm start
```

When running, the server listens on **`http://localhost:3002`** and outputs:
```
🚀 ChatGPT Plugin & MCP Server running on port 3002
   Interactive Web UI : http://localhost:3002/
   Health Check       : http://localhost:3002/health
   ChatGPT Manifest   : http://localhost:3002/.well-known/ai-plugin.json
   OpenAPI Spec       : http://localhost:3002/openapi.json
   MCP Streamable HTTP: http://localhost:3002/mcp
   MCP SSE Transport  : http://localhost:3002/sse
```

---

## 🌐 Connecting to ChatGPT

### Option 1: Connect via ChatGPT Custom GPT Actions (OpenAPI)
1. In ChatGPT, open the **Explore GPTs** page and click **Create a GPT**.
2. Go to the **Configure** tab and click **Create new action** under Actions.
3. If running locally, expose port 3002 using a local tunnel (e.g., `cloudflared tunnel --url http://localhost:3002` or `ngrok http 3002`).
4. In the **Schema** box in ChatGPT, click **Import from URL** and paste your tunnel URL with `/openapi.json` (e.g. `https://your-tunnel.ngrok-free.app/openapi.json`).
5. All 3 buttons (`generate_blog_outline`, `bulk_generate_metadata`, `plan_content_calendar`) will appear as available actions. Set Authentication to **None**.

### Option 2: Connect via MCP (Model Context Protocol)
For ChatGPT / MCP clients supporting Model Context Protocol:
Add the server to your MCP configuration (such as `opencode.json` or MCP settings):
```json
{
  "mcpServers": {
    "content-seo-tools": {
      "url": "http://localhost:3002/sse"
    }
  }
}
```

### Option 3: Built-in Interactive Web UI
Open your browser to:
```
http://localhost:3002/
```
You will find 3 live interactive buttons corresponding to the tools, with sample payloads, real-time JSON previews, and dedicated test buttons for boundary conditions (such as sending 21 posts at once).

---

## 💬 3 Test Questions to Ask ChatGPT

Once connected, ask ChatGPT these exact questions to test each tool:

### 1. Test Question for Button 1:
> *"Can you **write a blog outline** for the keyword 'organic gardening' targeting 'urban apartment dwellers'?"*

### 2. Test Question for Button 2:
> *"Please **generate meta descriptions for many posts** for these 3 articles: 1. 'How to Brew Pour Over Coffee', 2. 'Best Espresso Grinders Under $200', 3. 'Cold Brew vs Iced Coffee'."*

### 3. Test Question for Button 3:
> *"Can you **plan my content calendar** for the next 4 weeks using these keywords: 'freelance pricing', 'client onboarding', 'proposal templates', 'retainer contracts'?"*

---

## 🧪 Testing the Server

Run the automated test suites:

```bash
# Test REST endpoints, plugin manifests, and boundary limits (including 21 posts)
npm test

# Test MCP protocol tools list and calls over SSE
node dist/test-mcp.js

# Full user-acceptance suite: /health, favicon, good inputs for all 3 buttons,
# result sanity (<= 60 char titles, <= 155 char descriptions, unique slugs,
# FAQ coverage, real calendar dates, unique calendar titles), bad inputs,
# MCP end-to-end, SSE stability (104 checks)
node user-acceptance-test.mjs
```

### Boundary & Error Handling Test (21 Posts)
If more than 20 posts are sent to `bulk_generate_metadata`:
```json
{
  "error": "Validation error: Cannot generate metadata for more than 20 posts at once. Received 21 posts. Maximum allowed is 20."
}
```
HTTP status code: `400 Bad Request`.
MCP status: `{ "isError": true }`.
