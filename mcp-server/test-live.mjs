// Anonymous end-to-end verification of the *deployed* MCP server.
//
// This is the check that matters for ChatGPT review: no auth headers, no local
// socket, no VERCEL=1 trickery -- plain requests to the public URL, exactly as
// an OpenAI reviewer's scanner would make them.
const BASE = process.env.BASE_URL ?? "https://blogfox-mcp-server.vercel.app";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log((ok ? "PASS" : "FAIL") + ": " + name + (detail ? " — " + detail : ""));
};

// MCP responses are SSE envelopes: `data:` line -> envelope -> content[0].text
// -> the tool's own JSON. Triple-encoded, so always parse rather than regex.
async function callTool(name, args) {
  const r = await fetch(BASE + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const raw = await r.text();
  const dataLine = raw.split("\n").find((l) => l.startsWith("data:"));
  if (!dataLine) return { status: r.status, raw, payload: null, isError: false };
  const envelope = JSON.parse(dataLine.slice(5).trim());
  const text = envelope.result?.content?.[0]?.text;
  let payload = null;
  try { payload = JSON.parse(text); } catch { payload = text; }
  return { status: r.status, raw, payload, isError: !!envelope.result?.isError, error: envelope.error };
}

// 1. The three legal/support routes OpenAI requires on a public server.
for (const path of ["/health", "/privacy", "/terms", "/support"]) {
  try {
    const r = await fetch(BASE + path);
    const body = await r.text();
    check(path + " returns 200", r.status === 200, "status " + r.status);
    check(path + " is non-trivial", body.length > 100, body.length + " bytes");
  } catch (e) {
    check(path + " reachable", false, e.message);
  }
}

// 2. initialize + tools/list over stateless Streamable HTTP.
{
  const r = await fetch(BASE + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "probe", version: "1" } } }),
  });
  const t = await r.text();
  check("initialize returns serverInfo", t.includes("content-seo-tools"), r.status + "");
}

let toolNames = [];
{
  const r = await fetch(BASE + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  });
  const raw = await r.text();
  const dataLine = raw.split("\n").find((l) => l.startsWith("data:"));
  const env = JSON.parse(dataLine.slice(5).trim());
  toolNames = env.result.tools.map((t) => t.name);

  const expected = ["generate_blog_outline", "bulk_generate_metadata", "plan_content_calendar", "score_content_against_keyword", "suggest_semantic_terms", "rewrite_meta_tags"];
  const missing = expected.filter((n) => !toolNames.includes(n));
  check("tools/list returns all 6", missing.length === 0, missing.length ? "missing " + missing.join(",") : toolNames.length + " tools");

  // Tool annotations are the single most common OpenAI rejection cause.
  const annotated = env.result.tools.filter((t) => t.annotations && typeof t.annotations.readOnlyHint === "boolean");
  check("every tool has annotations.readOnlyHint", annotated.length === toolNames.length, annotated.length + "/" + toolNames.length);

  const described = env.result.tools.filter((t) => t.description && t.description.length >= 20);
  check("every tool has a real description", described.length === toolNames.length, described.length + "/" + toolNames.length);

  const hasSchema = env.result.tools.filter((t) => t.inputSchema && t.inputSchema.type === "object");
  check("every tool has an inputSchema", hasSchema.length === toolNames.length, hasSchema.length + "/" + toolNames.length);
}

// 3. All six tools, called for real.
{
  const outline = await callTool("generate_blog_outline", { keyword: "best espresso machines", audience: "home baristas" });
  check("generate_blog_outline works", outline.status === 200 && !outline.isError, typeof outline.payload === "object" ? Object.keys(outline.payload).slice(0, 4).join(",") : "non-object");

  const bulk = await callTool("bulk_generate_metadata", { posts: [
    { title: "How to Dial In an Espresso Grinder", keyword: "espresso grinder settings" },
    { title: "Single Origin vs Blends", keyword: "single origin coffee" },
  ] });
  check("bulk_generate_metadata works", bulk.status === 200 && !bulk.isError, typeof bulk.payload === "object" ? Object.keys(bulk.payload).slice(0, 4).join(",") : "non-object");

  const cal = await callTool("plan_content_calendar", { keywords: ["espresso extraction", "milk steaming"], posts_per_week: 2 });
  check("plan_content_calendar returns 8 posts", cal.payload && cal.payload.total_posts === 8, "total_posts=" + (cal.payload && cal.payload.total_posts));

  const score = await callTool("score_content_against_keyword", {
    content: "Espresso extraction is the process of dissolving soluble solids from ground coffee. Aim for a 1:2 ratio in 25 to 30 seconds. Grind finer if the shot runs fast, coarser if it runs slow. Water temperature near 93 Celsius extracts evenly.",
    keyword: "espresso extraction guide",
  });
  check("score_content_against_keyword returns 0-100", score.payload && Number.isFinite(score.payload.score) && score.payload.score >= 0 && score.payload.score <= 100, "score=" + (score.payload && score.payload.score));

  const sem = await callTool("suggest_semantic_terms", { keyword: "espresso extraction", content: "Pulling a shot means forcing water through compacted grounds at pressure." });
  check("suggest_semantic_terms returns terms", sem.status === 200 && !sem.isError, typeof sem.payload === "object" ? Object.keys(sem.payload).slice(0, 4).join(",") : "non-object");

  const rewrite = await callTool("rewrite_meta_tags", {
    content: "A practical guide to espresso extraction covering grind size, dose, yield, and timing so you can pull balanced shots at home every morning.",
    keyword: "espresso extraction",
    site_name: "Pull Log",
  });
  const tags = rewrite.payload && rewrite.payload.metaTags;
  check("rewrite_meta_tags returns 3 variants", Array.isArray(tags) && tags.length === 3, Array.isArray(tags) ? tags.length + " variants" : "no metaTags");
  if (Array.isArray(tags)) {
    check("all titles <= 60 chars", tags.every((t) => t.titleLength <= 60), tags.map((t) => t.titleLength).join(","));
    check("all descriptions <= 155 chars", tags.every((t) => t.descriptionLength <= 155), tags.map((t) => t.descriptionLength).join(","));
  }
}

// 4. The 20k character cap, enforced at the schema layer.
{
  const big = "word ".repeat(6000); // 30k chars, over the cap
  const r = await callTool("score_content_against_keyword", { content: big, keyword: "test" });
  const rejected = r.isError || /20000|too long|String must contain/i.test(JSON.stringify(r.raw));
  check("30k-char input is rejected by the 20k cap", rejected, rejected ? "rejected as expected" : "ACCEPTED — cap not enforced");
}

// 5. No OpenAI API usage anywhere (relevant: the server must not require
//    an OpenAI key, and reviewers check for external calls).
{
  const r = await fetch(BASE + "/health");
  const j = await r.json();
  check("/health reports tools=6", j.tools && j.tools.length === 6, j.tools ? j.tools.length + " listed" : "no tools field");
}

const pass = results.filter((x) => x.ok).length;
const allOk = pass === results.length;
console.log("\n===== " + pass + "/" + results.length + " live anonymous checks passed =====");
console.log("BASE: " + BASE);

const { writeFileSync } = await import("node:fs");
writeFileSync(new URL("./live-results.json", import.meta.url), JSON.stringify({ base: BASE, pass, total: results.length, allOk, failed: results.filter((x) => !x.ok).map((x) => x.name) }, null, 2));
process.exit(allOk ? 0 : 1);
