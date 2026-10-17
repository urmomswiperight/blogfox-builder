// Replicate what Vercel does: wrap the exported handler in an HTTP server and
// drive real requests through it with VERCEL=1 set. Verifies the serverless
// path actually works before we deploy.
process.env.VERCEL = "1";

const http = await import("node:http");
// NOTE: tsconfig has rootDir=./src and excludes api/, so api/index.ts is not
// compiled by tsc (@vercel/node compiles it at deploy time and follows the same
// import). api/index.ts does `export default handleRequest`, so testing the
// named export here is testing the exact function Vercel will serve.
const mod = await import("./dist/index.js");
const handler = mod.handleRequest;

if (typeof handler !== "function") {
  console.log("FAIL: default export is not a function, got " + typeof handler);
  process.exit(1);
}
console.log("PASS: default export is a function");

const server = http.createServer((req, res) => {
  Promise.resolve(handler(req, res)).catch((e) => {
    if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
  });
});

await new Promise((r) => server.listen(0, r));
const base = "http://127.0.0.1:" + server.address().port;

// The MCP Streamable-HTTP response is an SSE envelope:
//   event: message
//   data: {"result":{"content":[{"type":"text","text":"<json string>"}]}}
// So the real payload is double-encoded: parse the data line, then parse the
// text field. Regexing the raw envelope breaks on \u0026-style escapes.
async function callTool(base, name, args) {
  const r = await fetch(base + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const raw = await r.text();
  const dataLine = raw.split("\n").find((l) => l.startsWith("data:"));
  const envelope = JSON.parse(dataLine.slice(5).trim());
  return { status: r.status, raw, payload: JSON.parse(envelope.result.content[0].text) };
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log((ok ? "PASS" : "FAIL") + ": " + name + (detail ? " — " + detail : ""));
};

// 1. /health
{
  const r = await fetch(base + "/health");
  const j = await r.json();
  check("/health returns 200", r.status === 200, "status " + r.status);
  check("/health lists tools", Array.isArray(j.tools) && j.tools.length === 6, "tools=" + (j.tools ? j.tools.length : 0));
}

// 2. /mcp initialize over Streamable HTTP (this is what ChatGPT does)
{
  const r = await fetch(base + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }),
  });
  const t = await r.text();
  check("/mcp initialize 200", r.status === 200, "status " + r.status);
  check("/mcp returns serverInfo", t.includes("content-seo-tools"), t.slice(0, 80).replace(/\n/g, " "));
}

// 3. /mcp tools/list — stateless (no session id) must work
{
  const r = await fetch(base + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  });
  const t = await r.text();
  const six = ["generate_blog_outline", "bulk_generate_metadata", "plan_content_calendar", "score_content_against_keyword", "suggest_semantic_terms", "rewrite_meta_tags"];
  const missing = six.filter((n) => !t.includes(n));
  check("/mcp tools/list returns all 6 tools", missing.length === 0, missing.length ? "missing " + missing.join(",") : "all 6 present");
}

// 4. /mcp tools/call — real work end to end
{
  const { status, payload } = await callTool(base, "score_content_against_keyword", {
    content: "Growing tomatoes at home is rewarding. Tomatoes need six hours of sun, well drained soil, and consistent watering. Feed tomatoes with a balanced fertilizer. Prune tomatoes weekly.",
    keyword: "how to grow tomatoes at home",
  });
  check("/mcp tools/call score returns 200", status === 200, "status " + status);
  check("/mcp tools/call returns a numeric score", Number.isFinite(payload.score) && payload.score >= 0 && payload.score <= 100, "score=" + payload.score);
}

// 5. rewrite_meta_tags — the listing-critical length limits
{
  const { payload } = await callTool(base, "rewrite_meta_tags", {
    content: "A practical guide to brewing pour over coffee at home with the right grind, ratio, and water temperature for a clean cup every morning.",
    keyword: "pour over coffee",
    site_name: "Brew Log",
  });
  const tags = payload.metaTags || [];
  check("rewrite returns 3 variants", tags.length === 3, tags.length + " variants");
  check("all meta titles <= 60 chars", tags.length > 0 && tags.every((t) => t.titleLength <= 60 && [...t.title].length <= 60), tags.map((t) => t.titleLength).join(","));
  check("all meta descriptions <= 155 chars", tags.length > 0 && tags.every((t) => t.descriptionLength <= 155 && [...t.description].length <= 155), tags.map((t) => t.descriptionLength).join(","));
}

// 6. REST path still routed through the same handler
{
  const r = await fetch(base + "/plan_content_calendar", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ keywords: ["a", "b"], posts_per_week: 2 }),
  });
  const j = await r.json();
  check("REST /plan_content_calendar 200", r.status === 200, "status " + r.status);
  check("REST returns 8 posts for 2/wk", j.total_posts === 8, "total_posts=" + j.total_posts);
}

// 7. the UI route must not break serverless
{
  const r = await fetch(base + "/");
  check("/ returns 200 html", r.status === 200 && (r.headers.get("content-type") || "").includes("html"), r.status + " " + (r.headers.get("content-type") || ""));
}

const pass = results.filter((x) => x.ok).length;
const allOk = pass === results.length;
console.log("\n===== " + pass + "/" + results.length + " serverless checks passed =====");

// Persist the verdict to disk instead of trusting the exit code. Every /mcp
// call must send `accept: text/event-stream` (the spec rejects 406 otherwise),
// so the server always holds open SSE transports when this process ends — and
// tearing those down trips a libuv assertion on Windows that aborts with a
// nonzero code no matter what the checks said. The file is authoritative.
const { writeFileSync } = await import("node:fs");
writeFileSync(
  new URL("./serverless-results.json", import.meta.url),
  JSON.stringify({ pass, total: results.length, allOk, failed: results.filter((x) => !x.ok).map((x) => x.name) }, null, 2),
);
process.exit(allOk ? 0 : 1);
