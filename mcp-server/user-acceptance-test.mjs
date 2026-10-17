/**
 * User-acceptance test harness for the Content & SEO MCP server (port 3002).
 *
 * Tests, as a real user would:
 *  1. Health endpoint
 *  2. Good inputs over HTTP for all 3 buttons (3+ keywords, 2+ audiences)
 *  3. Result sanity (title <= 60, description <= 155, unique slugs, FAQ,
 *     real calendar dates over 4 weeks, correct posts/week)
 *  4. Bad inputs (empty keyword, 21 posts, duplicate titles, posts/week 0 & 8,
 *     non-English keywords) -> clear error or safe result, never a crash
 *  5. MCP protocol end-to-end (initialize -> tools/list -> tools/call)
 *  6. SSE endpoint stability (concurrent clients must not kill the server)
 *
 * Usage:  node user-acceptance-test.mjs
 * Output: PASS/FAIL lines + summary. Optional JSON dump via RESULTS_PATH.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3002";
const RESULTS_PATH =
  process.env.RESULTS_PATH ||
  path.join(os.tmpdir(), "mcp-test-results.json");

const results = [];
let serverAlive = true;

function record(group, name, pass, detail = "") {
  results.push({ group, name, pass: !!pass, detail: String(detail) });
  const tag = pass ? "PASS" : "FAIL";
  console.log(`[${tag}] ${group} :: ${name}${detail ? " — " + detail : ""}`);
}

async function req(method, pathname, body, headers = {}) {
  try {
    const res = await fetch(BASE + pathname, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    const out = { status: res.status, text, json, headers: res.headers };
    if (json === null && text.includes("data:")) {
      out.sse = text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => {
          try {
            return JSON.parse(l.slice(5).trim());
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    }
    return out;
  } catch (e) {
    serverAlive = false;
    return { status: 0, text: "", json: null, error: e.message };
  }
}

function errText(r) {
  if (r.json && typeof r.json.error === "string") return r.json.error;
  if (r.json && r.json.error && typeof r.json.error.message === "string")
    return r.json.error.message;
  if (r.json && r.json.message) return String(r.json.message);
  return r.text || r.error || "";
}

function looksLikeCrash(err) {
  return /is not a function|Cannot read prop|at Object\.|at async|TypeError|ReferenceError|undefined is not|is not iterable|\sat\s\w+\s*\(/.test(
    err
  );
}

function isClearError(r) {
  if (r.status < 400 || r.status >= 500) return false;
  const msg = errText(r);
  return msg.length > 0 && !looksLikeCrash(msg);
}

const len = (s) => [...String(s)].length;
const hasKw = (text, kw) =>
  String(text).toLowerCase().includes(String(kw).toLowerCase());

/* ───────────────────────── 1. Health & static endpoints ─────────────────── */

async function testHealth() {
  const g = "1. Health & endpoints";
  const h = await req("GET", "/health");
  record(
    g,
    "GET /health answers on port 3002",
    h.status === 200 && h.json && h.json.status === "ok" && h.json.port === 3002,
    `status=${h.status} body=${h.text.slice(0, 160)}`
  );
  const tools = (h.json && h.json.tools) || [];
  const names = tools.map((t) => t.name);
  record(
    g,
    "/health lists the 3 tool buttons",
    ["generate_blog_outline", "bulk_generate_metadata", "plan_content_calendar"].every(
      (n) => names.includes(n)
    ),
    `tools=${names.join(",")}`
  );

  const ui = await req("GET", "/");
  record(g, "GET / returns the button UI", ui.status === 200 && /button/i.test(ui.text));

  const oa = await req("GET", "/openapi.json");
  const paths = (oa.json && oa.json.paths) || {};
  record(
    g,
    "GET /openapi.json documents all 3 actions",
    oa.status === 200 &&
      ["generate_blog_outline", "bulk_generate_metadata", "plan_content_calendar"].every(
        (p) => paths["/" + p]
      )
  );

  const mf = await req("GET", "/.well-known/ai-plugin.json");
  record(
    g,
    "GET /.well-known/ai-plugin.json returns a manifest",
    mf.status === 200 && mf.json && mf.json.name_for_model
  );

  // Every URL the manifest advertises must resolve (ChatGPT validates these
  // when the plugin is installed).
  const logo = await fetch(BASE + "/logo.png");
  const logoBuf = Buffer.from(await logo.arrayBuffer());
  record(
    g,
    "GET /logo.png (manifest logo_url) serves a real PNG",
    logo.status === 200 &&
      (logo.headers.get("content-type") || "").includes("image/png") &&
      logoBuf.length > 0 &&
      logoBuf.slice(0, 8).toString("hex") === "89504e470d0a1a0a",
    `status=${logo.status} type=${logo.headers.get("content-type")} bytes=${logoBuf.length}`
  );

  const legal = await req("GET", "/legal");
  record(
    g,
    "GET /legal (manifest legal_info_url) serves a page",
    legal.status === 200 && /legal/i.test(legal.text) && legal.text.includes("<html"),
    `status=${legal.status} length=${legal.text.length}`
  );

  // Browsers auto-request /favicon.ico on every UI page load — a 404 there
  // floods the visitor's console with errors even though the manifest only
  // advertises /logo.png.
  const fav = await fetch(BASE + "/favicon.ico");
  const favBuf = Buffer.from(await fav.arrayBuffer());
  record(
    g,
    "GET /favicon.ico serves an icon (no console 404s in the UI)",
    fav.status === 200 &&
      (fav.headers.get("content-type") || "").includes("image") &&
      favBuf.length > 0,
    `status=${fav.status} type=${fav.headers.get("content-type")} bytes=${favBuf.length}`
  );
}

/* ───────────────────────── 2+3. Good inputs ─────────────────────────────── */

async function checkOutline(kw, aud) {
  const g = "2+3. generate_blog_outline (call + result checks)";
  const r = await req("POST", "/generate_blog_outline", { keyword: kw, audience: aud });
  const label = `keyword="${kw}" audience="${aud}"`;
  if (r.status !== 200 || !r.json) {
    record(g, `outline responds 200 — ${label}`, false, `status=${r.status} ${r.text.slice(0, 200)}`);
    return;
  }
  const o = r.json;
  record(g, `outline responds 200 — ${label}`, true);

  record(g, `title present & <= 60 chars — ${label}`,
    typeof o.title === "string" && o.title.trim().length > 0 && len(o.title) <= 60,
    `"${o.title}" (${len(o.title)})`);
  record(g, `title fits the keyword — ${label}`,
    typeof o.title === "string" && hasKw(o.title, kw), `"${o.title}"`);
  record(g, `slug non-empty & url-safe — ${label}`,
    typeof o.slug === "string" && /^[a-z0-9-]+$/.test(o.slug), `slug="${o.slug}"`);
  record(g, `sections present — ${label}`,
    Array.isArray(o.sections) && o.sections.length >= 5 &&
    o.sections.every((s) => s.heading && Array.isArray(s.key_points) && s.key_points.length > 0),
    `sections=${Array.isArray(o.sections) ? o.sections.length : "n/a"}`);

  const faq = Array.isArray(o.faq) ? o.faq : null;
  record(g, `FAQ questions present — ${label}`,
    faq !== null && faq.length >= 3 &&
    faq.every((f) => f && typeof f.question === "string" && f.question.trim().length > 0),
    faq ? `faq=${faq.length}` : "no faq field");
  record(g, `FAQ questions fit the keyword — ${label}`,
    faq !== null && faq.length >= 3 && faq.every((f) => hasKw(f.question, kw)),
    faq ? faq.map((f) => f.question).join(" | ").slice(0, 180) : "n/a");
  const faqSection = Array.isArray(o.sections)
    ? o.sections.find((s) => /faq|frequently asked/i.test(s.heading))
    : null;
  record(g, `FAQ also appears as an outline section — ${label}`,
    !!faqSection && faqSection.key_points.length >= 3,
    faqSection ? `heading="${faqSection.heading}"` : "missing");

  const rec = o.seo_recommendations || {};
  record(g, `meta title <= 60 — ${label}`,
    typeof rec.suggested_meta_title === "string" && len(rec.suggested_meta_title) <= 60,
    `len=${rec.suggested_meta_title ? len(rec.suggested_meta_title) : "n/a"}`);
  record(g, `meta description <= 155 — ${label}`,
    typeof rec.suggested_meta_description === "string" && len(rec.suggested_meta_description) <= 155,
    `len=${rec.suggested_meta_description ? len(rec.suggested_meta_description) : "n/a"}`);

  const sumWords = Array.isArray(o.sections)
    ? o.sections.reduce((a, s) => a + (s.estimated_words || 0), 0)
    : -1;
  record(g, `word counts internally consistent — ${label}`,
    o.total_estimated_words === sumWords && o.estimated_reading_time_minutes === Math.ceil(sumWords / 200),
    `total=${o.total_estimated_words} sum=${sumWords}`);
}

async function checkBulk(g, posts, label) {
  const r = await req("POST", "/bulk_generate_metadata", { posts });
  if (r.status !== 200 || !r.json) {
    record(g, `bulk responds 200 — ${label}`, false, `status=${r.status} ${r.text.slice(0, 200)}`);
    return null;
  }
  const b = r.json;
  record(g, `bulk responds 200 — ${label}`, true);
  record(g, `total_processed matches input — ${label}`,
    b.total_processed === posts.length && Array.isArray(b.results) && b.results.length === posts.length,
    `processed=${b.total_processed} input=${posts.length}`);

  const items = b.results || [];
  const badTitle = items.find((i) => len(i.seo_title) > 60 || !String(i.seo_title || "").trim());
  record(g, `every seo_title <= 60 chars — ${label}`, !badTitle,
    badTitle ? `"${badTitle.seo_title}" (${len(badTitle.seo_title)})` : `checked ${items.length}`);
  const badDesc = items.find((i) => len(i.meta_description) > 155 || !String(i.meta_description || "").trim());
  record(g, `every meta_description <= 155 chars — ${label}`, !badDesc,
    badDesc ? `(${len(badDesc.meta_description)})` : `checked ${items.length}`);
  const badSlug = items.find((i) => !i.slug || !/^[a-z0-9-]+$/.test(i.slug));
  record(g, `every slug non-empty & url-safe — ${label}`, !badSlug,
    badSlug ? `slug="${badSlug.slug}"` : `checked ${items.length}`);
  const slugs = items.map((i) => i.slug);
  const dupes = slugs.filter((s, i) => slugs.indexOf(s) !== i);
  record(g, `slugs are unique — ${label}`, dupes.length === 0 && new Set(slugs).size === items.length,
    dupes.length ? `duplicates: ${[...new Set(dupes)].join(", ")}` : `${new Set(slugs).size} unique`);
  const badLen = items.find((i) => i.title_length !== len(i.seo_title) || i.description_length !== len(i.meta_description));
  record(g, `reported lengths match actual strings — ${label}`, !badLen,
    badLen ? `item #${badLen.index}` : `checked ${items.length}`);
  const intents = ["Informational", "Commercial", "Transactional", "Navigational"];
  const badIntent = items.find((i) => !intents.includes(i.search_intent));
  record(g, `search_intent values valid — ${label}`, !badIntent, badIntent ? `#${badIntent.index}` : "ok");
  return b;
}

function calendarProblems(cal, expectedPerWeek, keywords) {
  const p = [];
  if (!cal || !Array.isArray(cal.weeks) || cal.weeks.length !== 4)
    return [`weeks=${cal && cal.weeks ? cal.weeks.length : "n/a"} (expected 4)`];

  if (cal.total_posts !== 4 * expectedPerWeek)
    p.push(`total_posts=${cal.total_posts} expected ${4 * expectedPerWeek}`);

  const allDates = [];
  let week1Min = null;
  const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

  for (let w = 0; w < 4; w++) {
    const week = cal.weeks[w];
    if (week.week_number !== w + 1) p.push(`week ${w + 1} number=${week.week_number}`);
    if (!Array.isArray(week.posts) || week.posts.length !== expectedPerWeek)
      p.push(`week ${w + 1} has ${week.posts ? week.posts.length : "n/a"} posts (expected ${expectedPerWeek})`);
    if (!week.theme) p.push(`week ${w + 1} missing theme`);

    const dates = [];
    for (const post of week.posts || []) {
      // real calendar date?
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(post.scheduled_date || "");
      if (!m) { p.push(`bad date "${post.scheduled_date}"`); continue; }
      const [Y, M, D] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const d = new Date(Date.UTC(Y, M - 1, D));
      if (d.getUTCFullYear() !== Y || d.getUTCMonth() !== M - 1 || d.getUTCDate() !== D) {
        p.push(`impossible date "${post.scheduled_date}"`); continue;
      }
      // weekday label must match the real weekday
      if (DAY_NAMES[d.getUTCDay()] !== post.day)
        p.push(`${post.scheduled_date} is ${DAY_NAMES[d.getUTCDay()]}, labeled ${post.day}`);
      // not in the past
      const t = new Date();
      const todayUtc = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
      if (d.getTime() < todayUtc) p.push(`${post.scheduled_date} is in the past`);
      // titles
      if (len(post.suggested_title) > 60)
        p.push(`title ${len(post.suggested_title)} chars: "${post.suggested_title}"`);
      if (!post.keyword) p.push(`post missing keyword (week ${w + 1})`);
      dates.push(d.getTime());
      allDates.push(d.getTime());
    }

    dates.sort((a, b) => a - b);
    if (dates.length) {
      const min = dates[0];
      if (w === 0) week1Min = min;
      else if (min !== week1Min + w * 7 * 86400000)
        p.push(`week ${w + 1} starts ${new Date(min).toISOString().slice(0, 10)}, expected ${new Date(week1Min + w * 7 * 86400000).toISOString().slice(0, 10)}`);
      const max = dates[dates.length - 1];
      if (max - min > 6 * 86400000) p.push(`week ${w + 1} spans more than 7 days`);
    }
  }

  if (week1Min !== null) {
    const spanDays = (Math.max(...allDates) - week1Min) / 86400000;
    if (spanDays > 27) p.push(`calendar spans ${spanDays + 1} days (> 4 weeks)`);
  }
  if (new Set(allDates).size !== allDates.length) p.push("duplicate scheduled dates");
  if (keywords) {
    const covered = new Set((cal.weeks || []).flatMap((w) => (w.posts || []).map((x) => x.keyword)));
    const missing = keywords.filter((k) => !covered.has(k));
    if (missing.length) p.push(`keywords not covered: ${missing.join(", ")}`);
  }
  return p;
}

async function checkCalendar(g, keywords, label, postsPerWeek) {
  const body = { keywords };
  if (postsPerWeek !== undefined) body.posts_per_week = postsPerWeek;
  const r = await req("POST", "/plan_content_calendar", body);
  const expected = postsPerWeek === undefined ? 3 : postsPerWeek;
  if (r.status !== 200 || !r.json) {
    record(g, `calendar responds 200 — ${label}`, false, `status=${r.status} ${r.text.slice(0, 200)}`);
    return;
  }
  const cal = r.json;
  record(g, `calendar responds 200 — ${label}`, true);
  const problems = calendarProblems(cal, expected, keywords);
  record(g, `4 weeks × ${expected} posts with real matching dates — ${label}`,
    problems.length === 0, problems.length ? problems.slice(0, 4).join("; ") : `all ${4 * expected} dates valid, future, weekday-matched`);
  record(g, `posts-per-week honored — ${label}`,
    Array.isArray(cal.weeks) && cal.weeks.every((w) => w.posts.length === expected),
    `per week: ${(cal.weeks || []).map((w) => w.posts.length).join(",")}`);

  // Bug #14: a keyword repeating in a later week used to get an identical
  // suggested_title (template was picked by weekday, so week 1 Monday and
  // week 3 Monday collided). Every title must be unique and ≤ 60 chars.
  const titles = (cal.weeks || []).flatMap((w) => w.posts.map((p) => p.suggested_title));
  record(g, `all suggested titles are unique — ${label}`,
    new Set(titles).size === titles.length,
    `${new Set(titles).size}/${titles.length} unique` +
      (new Set(titles).size !== titles.length
        ? ` — dupes: ${titles.filter((t, i) => titles.indexOf(t) !== i).slice(0, 2).map((t) => `"${t}"`).join(", ")}`
        : ""));
  record(g, `every suggested title ≤ 60 chars — ${label}`,
    titles.length > 0 && titles.every((t) => typeof t === "string" && t.length > 0 && t.length <= 60),
    `longest=${Math.max(0, ...titles.map((t) => t.length))}`);
}

async function testGoodInputs() {
  await checkOutline("email marketing", "small business owners");
  await checkOutline("organic gardening", "urban apartment dwellers");
  await checkOutline("freelance pricing", "freelance writers");

  await checkBulk("2+3. bulk_generate_metadata (call + result checks)", [
    { title: "How to Start an Email Newsletter", topic: "email newsletter" },
    { title: "Best SEO Tools for Bloggers", topic: "seo tools" },
    { title: "Organic Gardening for Beginners", topic: "organic gardening" },
  ], "3 posts / 3 keywords");

  await checkBulk("2+3. bulk_generate_metadata (call + result checks)", [
    { title: "Freelance Pricing Guide", topic: "freelance pricing" },
    { title: "Client Onboarding Checklist", topic: "client onboarding" },
    { title: "Email Deliverability Checklist", topic: "email deliverability" },
    { title: "Proposal Templates That Win Projects", topic: "proposal templates" },
    { title: "Retainer Contracts Explained", topic: "retainer contracts" },
  ], "5 posts / 5 keywords");

  const g = "2+3. plan_content_calendar (call + result checks)";
  await checkCalendar(g,
    ["email marketing", "SEO tips", "lead generation", "conversion rate optimization"],
    "4 keywords, default cadence");
  await checkCalendar(g,
    ["content marketing", "keyword research", "backlink strategy"],
    "3 keywords, 2 posts per week", 2);
  await checkCalendar(g,
    ["email marketing", "SEO tips"],
    "2 keywords, 5 posts per week (Mon-Fri)", 5);
  // Stress case: the same keyword 12 times forces the "Part N" suffix path —
  // titles must stay unique and ≤ 60 without clipping the suffix.
  await checkCalendar(g,
    ["content marketing strategy for B2B SaaS companies"],
    "1 keyword, 12 posts (repeated-keyword title rotation)");
}

/* ───────────────────────── 4. Bad inputs ────────────────────────────────── */

async function testBadInputs() {
  const g = "4. Bad inputs";

  // a) empty keyword
  let r = await req("POST", "/generate_blog_outline", { keyword: "", audience: "bloggers" });
  record(g, "empty keyword rejected with clear error",
    isClearError(r) && /keyword/i.test(errText(r)), `status=${r.status} "${errText(r).slice(0, 140)}"`);

  r = await req("POST", "/generate_blog_outline", { keyword: "   ", audience: "bloggers" });
  record(g, "whitespace-only keyword rejected with clear error",
    isClearError(r) && /keyword/i.test(errText(r)), `status=${r.status} "${errText(r).slice(0, 140)}"`);

  // b) 21 posts
  const posts21 = Array.from({ length: 21 }, (_, i) => ({ title: `Test Post #${i + 1}`, topic: `topic ${i + 1}` }));
  r = await req("POST", "/bulk_generate_metadata", { posts: posts21 });
  record(g, "21 posts rejected with clear error",
    isClearError(r) && /20/.test(errText(r)), `status=${r.status} "${errText(r).slice(0, 160)}"`);

  // c) two items with the same title
  r = await req("POST", "/bulk_generate_metadata", {
    posts: [
      { title: "Email Marketing Tips for Beginners", topic: "email marketing" },
      { title: "Email Marketing Tips for Beginners", topic: "email marketing" },
    ],
  });
  if (r.status === 200 && r.json) {
    const slugs = (r.json.results || []).map((x) => x.slug);
    record(g, "duplicate titles → safe result with unique slugs",
      slugs.length === 2 && new Set(slugs).size === 2 && slugs.every((s) => /^[a-z0-9-]+$/.test(s)),
      `slugs=${slugs.join(", ")}`);
  } else {
    record(g, "duplicate titles → clear error", isClearError(r),
      `status=${r.status} "${errText(r).slice(0, 160)}"`);
  }

  // same-slug-but-different-title case (punctuation-only difference)
  r = await req("POST", "/bulk_generate_metadata", {
    posts: [
      { title: "Email Marketing Tips!", topic: "a" },
      { title: "Email Marketing Tips?", topic: "b" },
    ],
  });
  if (r.status === 200 && r.json) {
    const slugs = (r.json.results || []).map((x) => x.slug);
    record(g, "punctuation-duplicate titles → unique slugs",
      new Set(slugs).size === slugs.length && slugs.every(Boolean), `slugs=${slugs.join(", ")}`);
  } else {
    record(g, "punctuation-duplicate titles → clear error", isClearError(r),
      `status=${r.status} "${errText(r).slice(0, 160)}"`);
  }

  // d) posts per week = 0
  r = await req("POST", "/plan_content_calendar", { keywords: ["seo tips"], posts_per_week: 0 });
  if (r.status === 200 && r.json) {
    const ok = Array.isArray(r.json.weeks) && r.json.weeks.every((w) => w.posts.length === 0);
    record(g, "posts_per_week=0 → safe result (0 posts/week, no crash)", ok,
      `status=200 per-week=${(r.json.weeks || []).map((w) => w.posts.length).join(",")}`);
  } else {
    record(g, "posts_per_week=0 → clear error", isClearError(r) && /posts_per_week|per week|between/i.test(errText(r)),
      `status=${r.status} "${errText(r).slice(0, 160)}"`);
  }

  // e) posts per week = 8
  r = await req("POST", "/plan_content_calendar", { keywords: ["seo tips"], posts_per_week: 8 });
  if (r.status === 200 && r.json) {
    const ok = Array.isArray(r.json.weeks) && r.json.weeks.every((w) => w.posts.length === 8);
    record(g, "posts_per_week=8 → safe result (8 posts/week, no crash)", ok,
      `status=200 per-week=${(r.json.weeks || []).map((w) => w.posts.length).join(",")}`);
  } else {
    record(g, "posts_per_week=8 → clear error", isClearError(r) && /posts_per_week|per week|between/i.test(errText(r)),
      `status=${r.status} "${errText(r).slice(0, 160)}"`);
  }

  // f) keywords in other languages
  r = await req("POST", "/generate_blog_outline", { keyword: "meilleures pratiques SEO", audience: "petites entreprises" });
  if (r.status === 200 && r.json) {
    const o = r.json;
    record(g, "French keyword → safe outline",
      len(o.title) <= 60 && !!o.slug && Array.isArray(o.sections) && Array.isArray(o.faq) &&
      o.faq.every((f) => hasKw(f.question, "meilleures pratiques SEO")),
      `title="${o.title}" slug="${o.slug}"`);
  } else record(g, "French keyword → clear error", isClearError(r), `status=${r.status} "${errText(r).slice(0, 140)}"`);

  r = await req("POST", "/generate_blog_outline", { keyword: "como crear un blog", audience: "pequeñas empresas" });
  if (r.status === 200 && r.json) {
    const o = r.json;
    record(g, "Spanish keyword → safe outline",
      len(o.title) <= 60 && !!o.slug && Array.isArray(o.sections),
      `title="${o.title}" slug="${o.slug}"`);
  } else record(g, "Spanish keyword → clear error", isClearError(r), `status=${r.status}`);

  r = await req("POST", "/generate_blog_outline", { keyword: "博客写作技巧", audience: "自由职业者" });
  if (r.status === 200 && r.json) {
    const o = r.json;
    record(g, "Chinese keyword → safe outline with non-empty slug",
      !!o.slug && /^[a-z0-9-]+$/.test(o.slug) && len(o.title) <= 60,
      `title="${o.title}" slug="${o.slug}"`);
  } else record(g, "Chinese keyword → clear error", isClearError(r), `status=${r.status} "${errText(r).slice(0, 140)}"`);

  r = await req("POST", "/bulk_generate_metadata", {
    posts: [
      { title: "Cómo crear un blog rentable", topic: "crear un blog" },
      { title: "Mejores prácticas de SEO", topic: "prácticas SEO" },
      { title: "博客写作技巧", topic: "写作" },
    ],
  });
  if (r.status === 200 && r.json) {
    const items = r.json.results || [];
    const slugs = items.map((i) => i.slug);
    record(g, "non-English titles → safe result",
      items.length === 3 && slugs.every((s) => s && /^[a-z0-9-]+$/.test(s)) &&
      new Set(slugs).size === 3 && items.every((i) => len(i.seo_title) <= 60 && len(i.meta_description) <= 155),
      `slugs=${slugs.join(", ")}`);
  } else record(g, "non-English titles → clear error", isClearError(r), `status=${r.status} "${errText(r).slice(0, 140)}"`);

  r = await req("POST", "/plan_content_calendar", {
    keywords: ["créer un blog", "consejos de SEO", "marketing de contenidos"],
  });
  if (r.status === 200 && r.json) {
    const probs = calendarProblems(r.json, 3, ["créer un blog", "consejos de SEO", "marketing de contenidos"]);
    record(g, "non-English calendar keywords → safe result", probs.length === 0, probs.slice(0, 3).join("; ") || "valid calendar");
  } else record(g, "non-English calendar keywords → clear error", isClearError(r), `status=${r.status} "${errText(r).slice(0, 140)}"`);

  // extra robustness (not required, but "no crash" is)
  r = await req("POST", "/plan_content_calendar", { keywords: [123, true] });
  record(g, "non-string keywords → clear error (not a stack trace)",
    isClearError(r), `status=${r.status} "${errText(r).slice(0, 140)}"`);

  r = await req("POST", "/bulk_generate_metadata", { posts: [{ title: 42 }] });
  record(g, "numeric title → clear error (not a stack trace)",
    isClearError(r), `status=${r.status} "${errText(r).slice(0, 140)}"`);

  // server still alive after all abuse
  const h = await req("GET", "/health");
  record(g, "server still alive after all bad inputs", h.status === 200 && h.json && h.json.status === "ok",
    `status=${h.status}`);
}

/* ───────────────────────── 5. MCP protocol end-to-end ───────────────────── */

async function testMcp() {
  const g = "5. MCP protocol end-to-end (/mcp)";
  const headers = { Accept: "application/json, text/event-stream" };

  const init = await req("POST", "/mcp", {
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "acceptance-test", version: "1.0" } },
  }, headers);
  const initMsg = (init.json && init.json.id === 1 && init.json) ||
    ((init.sse || []).find((m) => m.id === 1)) || null;
  record(g, "initialize succeeds", init.status === 200 && !!initMsg && !!initMsg.result && !!initMsg.result.serverInfo,
    `status=${init.status} ${init.text.slice(0, 160)}`);
  const sessionId = init.headers.get("mcp-session-id");
  const sessHeaders = sessionId ? { "Mcp-Session-Id": sessionId } : {};

  const notif = await req("POST", "/mcp",
    { jsonrpc: "2.0", method: "notifications/initialized" }, { ...headers, ...sessHeaders });
  record(g, "notifications/initialized accepted", notif.status === 200 || notif.status === 202,
    `status=${notif.status} ${notif.text.slice(0, 160)}`);

  const list = await req("POST", "/mcp", { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { ...headers, ...sessHeaders });
  const listMsg = (list.json && list.json.id === 2 && list.json) ||
    ((list.sse || []).find((m) => m.id === 2)) || null;
  const toolNames = listMsg && listMsg.result ? listMsg.result.tools.map((t) => t.name) : [];
  record(g, "tools/list returns the 3 tools",
    list.status === 200 && ["generate_blog_outline", "bulk_generate_metadata", "plan_content_calendar"].every((n) => toolNames.includes(n)),
    `status=${list.status} tools=${toolNames.join(",")}`);

  const call = await req("POST", "/mcp", {
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "generate_blog_outline", arguments: { keyword: "seo checklist", audience: "bloggers" } },
  }, { ...headers, ...sessHeaders });
  const callMsg = (call.json && call.json.id === 3 && call.json) ||
    ((call.sse || []).find((m) => m.id === 3)) || null;
  let outlineOk = false, outlineDetail = `status=${call.status}`;
  if (callMsg && callMsg.result && !callMsg.result.isError) {
    try {
      const data = JSON.parse(callMsg.result.content[0].text);
      outlineOk = len(data.title) <= 60 && Array.isArray(data.faq) && data.faq.length >= 3;
      outlineDetail = `title="${data.title}" faq=${data.faq ? data.faq.length : 0}`;
    } catch (e) { outlineDetail = "unparseable payload: " + e.message; }
  } else if (callMsg && callMsg.result && callMsg.result.isError) {
    outlineDetail = "isError: " + callMsg.result.content[0].text.slice(0, 160);
  } else if (callMsg && callMsg.error) {
    outlineDetail = "jsonrpc error: " + JSON.stringify(callMsg.error).slice(0, 160);
  }
  record(g, "tools/call generate_blog_outline returns a valid outline", outlineOk, outlineDetail);

  const bad = await req("POST", "/mcp", {
    jsonrpc: "2.0", id: 4, method: "tools/call",
    params: { name: "bulk_generate_metadata", arguments: { posts: Array.from({ length: 21 }, (_, i) => ({ title: `P${i}` })) } },
  }, { ...headers, ...sessHeaders });
  const badMsg = (bad.json && bad.json.id === 4 && bad.json) || ((bad.sse || []).find((m) => m.id === 4)) || null;
  const badText = badMsg && badMsg.result ? JSON.stringify(badMsg.result) : JSON.stringify(badMsg || {});
  record(g, "tools/call with 21 posts returns isError (no crash)",
    bad.status === 200 && badMsg && badMsg.result && badMsg.result.isError === true && /20/.test(badText),
    badText.slice(0, 180));

  // posts_per_week over MCP: 0 and 8 must be clear errors, 2 must be honored
  async function mcpCall(id, name, args) {
    const r = await req("POST", "/mcp", {
      jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args },
    }, { ...headers, ...sessHeaders });
    const msg = (r.json && r.json.id === id && r.json) || ((r.sse || []).find((m) => m.id === id)) || null;
    return { status: r.status, msg };
  }

  const ppw0 = await mcpCall(5, "plan_content_calendar", { keywords: ["seo tips"], posts_per_week: 0 });
  const ppw0Text = JSON.stringify(ppw0.msg || {});
  record(g, "tools/call posts_per_week=0 → clear isError",
    ppw0.status === 200 && ppw0.msg && ppw0.msg.result && ppw0.msg.result.isError === true &&
    /posts_per_week/.test(ppw0Text), ppw0Text.slice(0, 160));

  const ppw8 = await mcpCall(6, "plan_content_calendar", { keywords: ["seo tips"], posts_per_week: 8 });
  const ppw8Text = JSON.stringify(ppw8.msg || {});
  record(g, "tools/call posts_per_week=8 → clear isError",
    ppw8.status === 200 && ppw8.msg && ppw8.msg.result && ppw8.msg.result.isError === true &&
    /posts_per_week/.test(ppw8Text), ppw8Text.slice(0, 160));

  const ppw2 = await mcpCall(7, "plan_content_calendar", { keywords: ["seo tips", "link building"], posts_per_week: 2 });
  let ppw2Ok = false, ppw2Detail = JSON.stringify(ppw2.msg || {}).slice(0, 160);
  if (ppw2.status === 200 && ppw2.msg && ppw2.msg.result && !ppw2.msg.result.isError) {
    try {
      const cal = JSON.parse(ppw2.msg.result.content[0].text);
      ppw2Ok = cal.total_posts === 8 && cal.weeks.every((w) => w.posts.length === 2);
      ppw2Detail = `total=${cal.total_posts} per-week=${cal.weeks.map((w) => w.posts.length).join(",")}`;
    } catch (e) { ppw2Detail = "unparseable: " + e.message; }
  }
  record(g, "tools/call posts_per_week=2 honors the cadence", ppw2Ok, ppw2Detail);

  const spaceKw = await mcpCall(8, "generate_blog_outline", { keyword: "   ", audience: "bloggers" });
  const spaceText = JSON.stringify(spaceKw.msg || {});
  record(g, "tools/call whitespace keyword → clear isError",
    spaceKw.status === 200 && spaceKw.msg && spaceKw.msg.result && spaceKw.msg.result.isError === true &&
    /keyword/i.test(spaceText), spaceText.slice(0, 160));
}

/* ───────────────────────── 6. SSE stability ─────────────────────────────── */

async function openSse() {
  try {
    const res = await fetch(BASE + "/sse", { headers: { Accept: "text/event-stream" } });
    if (!res.ok) return { ok: false, status: res.status };
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const first = await Promise.race([
      reader.read(),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 3000)),
    ]);
    if (!first.timeout) buf += dec.decode(first.value || new Uint8Array());
    return { ok: true, status: res.status, first: buf.slice(0, 200), cancel: () => reader.cancel().catch(() => {}) };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
}

async function testSse() {
  const g = "6. SSE endpoint & stability";
  const s1 = await openSse();
  record(g, "GET /sse opens a stream", s1.ok && /endpoint|event/i.test(s1.first || ""),
    s1.ok ? `first="${(s1.first || "").slice(0, 120)}"` : `status=${s1.status} ${s1.error || ""}`);

  const s2 = await openSse(); // concurrent second client — used to crash the server
  record(g, "second concurrent /sse client does not kill the server",
    s2.ok || s2.status === 409 || s2.status === 500,
    `status=${s2.status} ${s2.error || (s2.first || "").slice(0, 80)}`);

  if (s1.cancel) s1.cancel();
  if (s2.cancel) s2.cancel();
  await new Promise((r) => setTimeout(r, 300));

  const h = await req("GET", "/health");
  record(g, "server survives SSE test (health still ok)", h.status === 200 && h.json && h.json.status === "ok",
    `status=${h.status}`);
}

/* ───────────────────────── main ─────────────────────────────────────────── */

async function main() {
  console.log(`Running user-acceptance tests against ${BASE}\n`);
  await testHealth();
  await testGoodInputs();
  await testBadInputs();
  await testMcp();
  await testSse();

  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  console.log(`\n========== SUMMARY: ${pass} PASS / ${fail} FAIL (of ${results.length}) ==========`);
  if (fail) {
    console.log("Failures:");
    for (const r of results.filter((x) => !x.pass))
      console.log(`  FAIL ${r.group} :: ${r.name} — ${r.detail}`);
  }
  try {
    fs.writeFileSync(RESULTS_PATH, JSON.stringify({ base: BASE, results }, null, 2));
    console.log(`\nResults written to ${RESULTS_PATH}`);
  } catch (e) {
    console.log(`(could not write results file: ${e.message})`);
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("HARNESS CRASH:", e);
  process.exit(2);
});
