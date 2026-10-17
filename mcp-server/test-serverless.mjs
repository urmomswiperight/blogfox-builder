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
// Read from the source of truth so the assertions below cannot drift from it.
const SUPPORT_EMAIL = mod.SUPPORT_EMAIL;

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

// 8. Legal pages + manifest/spec URLs. OpenAI's form wants distinct URLs for
//    privacy, terms, and support, and a manifest that does not advertise
//    localhost. Both were broken before this deploy: the routes 404'd and the
//    manifest hardcoded http://localhost:3002. VERCEL=1 makes requestOrigin()
//    emit https, and we send a spoofed Host to prove it follows the request.
{
  // Node's fetch treats `Host` as a forbidden header and drops it, so we
  // cannot spoof the origin here. Instead assert the property that actually
  // matters: the manifest and spec derive their URLs from the incoming
  // request's origin (under VERCEL=1 that is https) rather than the
  // hardcoded localhost:3002 they used to ship.
  const host = base.replace("http://", "");
  const expectedOrigin = "https://" + host;

  for (const path of ["/privacy", "/terms", "/support", "/legal"]) {
    const r = await fetch(base + path);
    const t = await r.text();
    check(path + " returns 200 html", r.status === 200 && (r.headers.get("content-type") || "").includes("html"), r.status + ", " + t.length + " bytes");
    check(path + " carries the support contact", t.includes(SUPPORT_EMAIL));
    check(path + " cross-links the other legal pages", ["/privacy", "/terms", "/support"].every((p) => t.includes(`href="${p}"`)));
    check(path + " is not a placeholder notice", !/replace with your own terms/i.test(t));
  }

  const manifest = await (await fetch(base + "/.well-known/ai-plugin.json")).json();
  check("manifest api.url derives from the request origin", manifest.api.url === expectedOrigin + "/openapi.json", manifest.api.url);
  check("manifest logo_url derives from the request origin", manifest.logo_url === expectedOrigin + "/logo.png", manifest.logo_url);
  check("manifest legal_info_url points at /privacy", manifest.legal_info_url === expectedOrigin + "/privacy", manifest.legal_info_url);
  check("manifest contact_email is the SUPPORT_EMAIL constant", manifest.contact_email === SUPPORT_EMAIL, manifest.contact_email);
  check("manifest describes all 6 tools", manifest.description_for_model.includes("6 SEO"), "mentions 6");

  const spec = await (await fetch(base + "/openapi.json")).json();
  check("openapi servers[0].url derives from the request origin", spec.servers[0].url === expectedOrigin, spec.servers[0].url);
  check("no localhost left in manifest or servers", !JSON.stringify(manifest).includes("localhost") && !JSON.stringify(spec.servers).includes("localhost"));
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
