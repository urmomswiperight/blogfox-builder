# BlogFox Builder

A local MCP server (plus REST + ChatGPT plugin surface) for SEO content work. Six tools covering **content generation** and **content analysis** — outline a post, bulk-write metadata, plan a calendar, then score a draft, find missing topical terms, and rewrite meta tags.

Runs entirely on your machine. **No third-party API calls, no paid services, no data storage.**

---

## Tools

Every tool description is written using the **exact phrase people type into ChatGPT**, so the model routes to it on natural phrasing.

### Generation

| Tool | Ask ChatGPT | What it does |
| :--- | :--- | :--- |
| `generate_blog_outline` | **"write a blog outline"** | Structured outline from a keyword + audience: H2/H3 sections, key points, word counts, a 5-item FAQ, and on-page SEO guidance. Titles capped at 60 chars, meta descriptions at 155. |
| `bulk_generate_metadata` | **"generate meta descriptions for many posts"** | SEO titles + meta descriptions for up to **20 posts** in one call. Enforces the ≤20 boundary and guarantees unique URL slugs across the batch. |
| `plan_content_calendar` | **"plan my content calendar"** | 4-week posting schedule rotating your keywords across formats and real calendar dates. Defaults to 3 posts/week (Mon/Wed/Fri); `posts_per_week` accepts 1–7. |

### Analysis

| Tool | Ask ChatGPT | What it does |
| :--- | :--- | :--- |
| `score_content_against_keyword` | **"improve my content score"** | Returns a single **0–100** score from keyword prominence, heading structure, density, and depth, plus specific recommendations. |
| `suggest_semantic_terms` | **"what words am I missing to rank higher"** | Topical gap analysis: two lists — terms **present** and terms **missing** — with advice on where to add them. |
| `rewrite_meta_tags` | **"rewrite my meta tags with high CTR hooks"** | Three high-CTR variants, each validated to a title **< 60 chars** and description **< 155 chars**. |

> The three analysis tools cross-reference each other in their descriptions, so the model picks the right one: *score* when you want a number, *semantic terms* when you want a gap list, *meta tags* when you want text to paste.

---

## Safety properties

- **Read-only.** No tool mutates state, writes files, or has side effects.
- **Stateless.** Text is processed in memory and discarded. Nothing is logged or persisted.
- **No outbound calls.** No external APIs, no telemetry, no paid services.
- **Validated input.** Zod schemas on every tool. Article text is capped at **20,000 characters**; non-English content is rejected with a clear error rather than returning garbage.
- **Warnings, not failures.** If a draft never uses its target keyword, tools still return a best-effort result with `keywordFound: false` and a `warnings` array.

---

## Quick start

Requires **Node.js 18+**.

```bash
cd mcp-server
npm install
npm run build
npm start
```

Server listens on **`http://localhost:3002`**.

### Connect via MCP

Point any MCP client at the Streamable HTTP endpoint:

```json
{
  "mcpServers": {
    "content-seo-tools": {
      "url": "http://localhost:3002/mcp"
    }
  }
}
```

SSE transport is also available at `http://localhost:3002/sse`.

### REST endpoints

Each tool is also a plain POST, handy for testing and for ChatGPT Actions:

```bash
curl -X POST http://localhost:3002/generate_blog_outline \
  -H "Content-Type: application/json" \
  -d '{"keyword":"local SEO","audience":"freelance writers"}'
```

---

## Endpoints

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `GET` | `/` | Interactive 3-button web UI |
| `GET` | `/health` | Health check + tool list |
| `GET` | `/mcp` · `POST` | **MCP Streamable HTTP** |
| `GET` | `/sse` | MCP SSE transport |
| `GET` | `/.well-known/ai-plugin.json` | ChatGPT plugin manifest |
| `GET` | `/openapi.json` | OpenAPI spec |
| `GET` | `/logo.png` · `/favicon.ico` | Plugin icon |
| `GET` | `/legal` | Legal & privacy notice |
| `POST` | `/generate_blog_outline` | REST: outline |
| `POST` | `/bulk_generate_metadata` | REST: bulk metadata |
| `POST` | `/plan_content_calendar` | REST: calendar |

---

## Testing

```bash
# REST endpoints, manifests, boundary limits (incl. the 21-post rejection)
npm test

# MCP protocol: tools/list + tools/call over SSE
node dist/test-mcp.js

# Full user-acceptance suite — 104 checks covering /health, good/bad inputs
# for all six tools, length limits, unique slugs, real calendar dates,
# MCP end-to-end, and SSE stability
node user-acceptance-test.mjs
```

### Known boundary behaviour

Sending 21 posts returns `400`:

```json
{
  "error": "Validation error: Cannot generate metadata for more than 20 posts at once. Received 21 posts. Maximum allowed is 20."
}
```

Over MCP the same case surfaces as `{ "isError": true }`.

---

## Project layout

```
mcp-server/
  src/
    index.ts          # server, transports, REST routes, tool registration
    validation.ts     # non-English detection, keyword-absent warning
    engine/
      scorer.ts       # score_content_against_keyword
      semantic.ts     # suggest_semantic_terms
      meta.ts         # rewrite_meta_tags
      nlp.ts          # shared tokenizing / stopword logic
    test.ts           # REST + boundary suite
    test-mcp.ts       # MCP protocol suite
  scripts/gen-logo.mjs
  user-acceptance-test.mjs
  TEST-REPORT.md
```
