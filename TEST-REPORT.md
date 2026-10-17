# TEST-REPORT — Content & SEO MCP Server (`mcp-server/`)

**Date:** 2026-10-14 (re-verified & extended 2026-10-15)
**Target:** `D:\Plugin Builder\Builder-BlogFox\mcp-server` — ChatGPT plugin + MCP server on **port 3002**
**Environment:** Node v24.15.0, npm 11.12.1, Windows (local, `http://127.0.0.1:3002`), desktop Chrome via Playwright
**Final result:** **104 / 104 automated checks PASS** (see appendix) **plus a real-browser click-through of every UI button — PASS** (§6b). Repo suites also pass: `npm test` **10/10**, official MCP SDK SSE client (`node dist/test-mcp.js`) **exit 0**.
**Baseline before fixes:** **53 PASS / 30 FAIL**, plus the server process **crashed** mid-test (see Bug #2).
**Constraints respected:** tool names unchanged (`generate_blog_outline`, `bulk_generate_metadata`, `plan_content_calendar`); port unchanged (3002).

---

## Verdict per requested step

| # | What you asked for | Verdict | Evidence |
|---|---|---|---|
| 1 | Install, build, start from this folder on port 3002; `/health` answers | **PASS** | `npm install` (0 vulnerabilities), `npm run build` (`tsc` clean), `npm start`. `GET /health` → `200 {"status":"ok","port":3002,...}` listing all 3 tools. |
| 2 | Call each button over HTTP: 3+ keywords, 2+ audiences | **PASS** | 6 outline calls (keywords: email marketing, organic gardening, freelance pricing, SEO tips…; audiences: small business owners, urban apartment dwellers, freelance writers, B2B marketers + French/Spanish/Chinese), 3 bulk calls (8 titles/keywords), 4 calendar calls. All 200. |
| 3 | Results make sense: title/sections/FAQ fit keyword; titles ≤ 60; descriptions ≤ 155; unique slugs; calendar has real dates over 4 weeks with right posts/week | **PASS** | Every outline has a ≤60-char keyword-bearing title, 7 sections incl. FAQ section, and 5 keyword-bearing FAQ questions. Max title observed 60, max description observed 155. Slugs unique in every batch. Calendar sample: Mon 2026-10-19 → Fri 2026-11-13, weekday labels match real dates, 3/3/3/3 (also verified 2/2/2/2 and 5/5/5/5). |
| 4 | Bad inputs: empty keyword, 21 items, duplicate titles, posts/week 0 & 8, non-English keywords → clear error or safe result, no crash | **PASS** | All 6 scenarios clear errors or safe results (details below); server health OK after the abuse run. |
| 5 | Read each button's description: does it sound human-typed? Any two confusable? | **PASS (notes)** | Yes — each opens with a verbatim phrase people type. No two are confusable in practice. One strategy nit flagged (not a defect). See “Button description review”. |
| 6 | Fix every bug and re-run until everything passes | **PASS** | 15 bugs fixed (2 of them — #14, #15 — found only by clicking the real browser UI); suite re-run repeatedly: 53/30 → 92/0 → **104/0**. |
| 7 | Save full results in TEST-REPORT.md | **PASS** | This file (saved at repo root and in `mcp-server/`). |

---

## 1. Setup & health — PASS

```
npm install      → 34 packages, found 0 vulnerabilities
npm run build    → tsc (no errors)
npm start        → 🚀 running on port 3002
GET /health      → 200 {"status":"ok","port":3002,"server":"content-seo-tools",...}
```

Also verified 200: `GET /` (button UI), `/openapi.json`, `/.well-known/ai-plugin.json`, `/logo.png` (valid PNG), `/favicon.ico` (valid PNG), `/legal`.

## 2. Good-input calls (the 3 buttons, over HTTP)

| Button (endpoint) | Calls made | Result |
|---|---|---|
| `POST /generate_blog_outline` | `email marketing` × small business owners; `organic gardening` × urban apartment dwellers; `freelance pricing` × freelance writers; `SEO tips for small businesses` × B2B marketers; French, Spanish, Chinese keyword runs | 200 every time |
| `POST /bulk_generate_metadata` | 3 posts (3 keywords), 5 posts (5 keywords), 3 non-English titles, 1× 89-char title stress case | 200 every time |
| `POST /plan_content_calendar` | 4 keywords @ default; 3 keywords @ 2/week; 2 keywords @ 5/week; 3 non-English keywords | 200 every time |

## 3. Result sanity — PASS

**Outlines** (3 required keyword/audience pairs):

| Keyword | Audience | Title (chars) | Sections | FAQ | Meta desc (chars) |
|---|---|---|---|---|---|
| email marketing | small business owners | `Email Marketing Guide for small business owners` (47) | 7 (incl. FAQ) | 5 keyword-bearing questions | 146 |
| organic gardening | urban apartment dwellers | `Organic Gardening Guide for urban apartment dwellers` (52) | 7 | 5 | 151 |
| freelance pricing | freelance writers | `Freelance Pricing Guide for freelance writers` (45) | 7 | 5 | 144 |

Extra: `SEO tips for small businesses` × B2B marketers → `SEO Tips For Small Businesses Guide for B2B marketers` (53, acronym preserved). Word counts internally consistent (2,300 total = sum of sections; reading time = ceil(total/200)).

**Bulk metadata** (includes an 89-character title stress case):

| Metric | Observed |
|---|---|
| Max `seo_title` length | **60** (long input truncated to 60 with `...`) |
| Max `meta_description` length | **155** (hard cap held) |
| Slugs | 5/5 unique, non-empty, URL-safe, accent-folded (`como-crear-un-blog-rentable`, not `c-mo-…`) |
| Reported `title_length`/`description_length` | Match the actual strings for every item |
| `search_intent` | Valid enum values, sensible keyword-trigger matches |

**Calendar** (`keywords: [email marketing, SEO tips, lead generation]`, default cadence):

```
cadence: 3 posts per week (Monday, Wednesday, Friday) | total_posts: 12 | weeks: 4
week 1: 2026-10-19(Mon) 2026-10-21(Wed) 2026-10-23(Fri)
week 2: 2026-10-26(Mon) 2026-10-28(Wed) 2026-10-30(Fri)
week 3: 2026-11-02(Mon) 2026-11-04(Wed) 2026-11-06(Fri)
week 4: 2026-11-09(Mon) 2026-11-11(Wed) 2026-11-13(Fri)
```

- Real calendar dates, always in the future (first post = next Monday), exactly 7 days apart per week, no duplicate dates, total span ≤ 4 weeks.
- Every `scheduled_date`'s real weekday matches its `day` label (asserted for all 40 dates across the three cadence runs).
- Posts/week honored exactly: 3/3/3/3 (default), 2/2/2/2, 5/5/5/5. All 3 keywords rotate through all 4 weeks. All suggested titles ≤ 60 chars.

## 4. Bad inputs — PASS (clear error or safe result, never a crash)

| Input | Endpoint | Behaviour after fixes |
|---|---|---|
| `keyword: ""` | outline | 400 `Validation error: 'keyword' is required and must be a non-empty string.` |
| `keyword: "   "` (whitespace) | outline | 400 same clear message (previously slipped through MCP validation) |
| 21 posts | bulk | 400 `Validation error: Cannot generate metadata for more than 20 posts at once. Received 21 posts. Maximum allowed is 20.` (MCP: `isError: true`, same text) |
| Two items with the same title | bulk | Safe result: both processed, slugs `email-marketing-tips-for-beginners`, `…-for-beginners-2` |
| Titles differing only in punctuation (`…Tips!` / `…Tips?`) | bulk | Safe result: `email-marketing-tips`, `email-marketing-tips-2` |
| `posts_per_week: 0` | calendar | 400 `Validation error: 'posts_per_week' must be a whole number between 1 and 7. Received 0.` |
| `posts_per_week: 8` | calendar | 400 `…between 1 and 7. Received 8.` |
| French keyword (`meilleures pratiques SEO`) | outline | Safe result: title 47 chars, slug `meilleures-pratiques-seo`, FAQ in French context |
| Spanish keyword (`como crear un blog`) | outline | Safe result: slug `como-crear-un-blog` (accents folded, not dropped) |
| Chinese keyword (`博客写作技巧`) | outline | Safe result: title ≤ 60, non-empty slug `keyword-32127e32` (was `""` before the fix) |
| Non-English titles (Spanish + Chinese) | bulk | Safe result: 3 unique non-empty slugs, all titles ≤ 60, all descriptions ≤ 155 |
| Non-English keyword list | calendar | Safe result: valid 4-week calendar |
| `keywords: [123, true]` | calendar | 400 `Validation error: keyword at position 1 must be a string. Received number.` (was `k.trim is not a function`) |
| `posts: [{ title: 42 }]` | bulk | 400 `Validation error: Post at index 1 must have a non-empty 'title' string. Received 42.` (was a leaked TypeError) |
| After all of the above | `/health` | 200 — server alive |

## 5. Button description review (your step 5)

Tool descriptions as ChatGPT sees them (MCP `tools/list`, identical wording in the OpenAPI spec):

1. **`generate_blog_outline`** — *"write a blog outline — builds a structured blog post outline from a keyword and audience with section breakdowns and SEO tips"*
2. **`bulk_generate_metadata`** — *"generate meta descriptions for many posts — writes SEO titles and meta descriptions for up to 20 posts at once"*
3. **`plan_content_calendar`** — *"plan my content calendar — makes a 4-week posting schedule and content calendar from a list of keywords"*

**Do they sound like something a person types into ChatGPT?** Yes. All three lead with a verbatim natural phrase ("write a blog outline", "generate meta descriptions for many posts", "plan my content calendar") followed by an em-dash tail that helps the model — the same shape that works well for tool matching. The yellow phrase chips on the web UI match these exactly, and none contain company names (per the vault strategy).

**Could two be confused with each other?** No real overlap:
- *1 vs 2:* both are "blog writing", but the deliverables are named distinctly (outline vs meta description) and the inputs differ (keyword+audience vs a posts array). The only fuzzy prompt would be something like "prepare these posts for publishing", where even a human would ask which artifact you want — the model would likely ask too.
- *2 vs 3:* "meta descriptions for many posts" vs "content calendar/schedule" — different deliverables, different inputs, zero ambiguity.
- *1 vs 3:* both take keywords, but "write … outline" vs "plan … calendar" and the output shapes are unambiguous.

**One nit (left unchanged, your call):** tool 2's phrase says *"for many posts"* although it accepts a single post (`min 1`). A user typing "generate a meta description for my post" may match slightly less often. Since the exact phrase is the deliberate SEO/distribution choice documented in the vault, I did not rewrite it — flagging it so you can decide.

## 6. Bugs found and fixed (15)

All in `mcp-server/src/index.ts` unless noted. "Baseline" = the behaviour observed before any change.

| # | Sev | Bug | Baseline symptom | Fix | Verified by |
|---|---|---|---|---|---|
| 1 | Critical | **MCP endpoint dead after `initialize`** | `/mcp` made a fresh session-validating transport per request over one shared server → every later request (`notifications/initialized`, `tools/list`, `tools/call`) got `400 Bad Request: Server not initialized` | Stateless `/mcp`: `sessionIdGenerator: undefined` + a fresh `McpServer` per request (new `createMcpServer()` factory) | Full JSON-RPC handshake + 6 `tools/call`s pass over `/mcp` |
| 2 | Critical | **Server process crash (observed live)** | Two concurrent `/sse` clients → `mcpServer.connect()` threw `Already connected to a transport`, the async request handler rejected, Node killed the process (stack trace captured) | One `McpServer` per SSE connection; `try/catch` around `/sse` and `/messages`; a global `.catch` on the request handler converts any rejection into a 500 | 2 concurrent SSE clients + `/health` still 200 |
| 3 | High | Outline title over 60 chars | 63 / 68 / 61 chars for the 3 test pairs (67 for French) | Shorter fallback templates (`{Keyword} Guide for {Audience}`) + hard `truncateTo(60)` with keyword kept at the front | All outline titles ≤ 60 |
| 4 | High | **No FAQ in the outline** | No FAQ field or section at all | Added top-level `faq` array (5 questions, every one contains the keyword, with answer summaries) **and** an "Frequently Asked Questions (FAQ)" H2 section | Both presence checks + keyword-fit check pass |
| 5 | High | `posts_per_week` didn't exist | Requests for 0, 2, or 8 posts/week were silently ignored and returned 3/week | Optional `posts_per_week` (default 3, whole number 1–7) in tool logic, MCP schema, OpenAPI spec, and a UI field; 0 and 8 → clear error | REST + MCP: 2/week, 5/week honored; 0 and 8 rejected |
| 6 | High | Duplicate slugs in bulk metadata | Identical titles (or titles differing only in punctuation) produced identical slugs | `makeUniqueSlug()` appends `-2`, `-3`, … | Duplicate-title and punctuation cases unique |
| 7 | Medium | Non-Latin slugs empty or mangled | `博客写作技巧` → slug `""`; `Cómo crear un blog` → `c-mo-crear-un-blog`; `prácticas` → `pr-cticas` | `slugify()` folds accents (NFKD → `como-crear-un-blog`) and falls back to a deterministic sha1 slug (`keyword-32127e32`) when nothing Latin remains | French/Spanish/Chinese runs all URL-safe & non-empty |
| 8 | Medium | Calendar titles over 60 chars | `7 Best Practices for Conversion rate optimization That Actually Work` = 68 (also 65, 63) | `truncateTo(60)` on every suggested title | All calendar titles ≤ 60 |
| 9 | Medium | UTC date-shift risk in calendar | Dates copied `now`'s time-of-day and serialized via `toISOString()` — near a UTC boundary the calendar day (and thus the Mon/Wed/Fri label) can shift | Local-midnight date math + `formatYmd()` on local fields; day label derived from the real date | Harness asserts label == real weekday for every date; sample 2026-10-19…11-13 Mon/Wed/Fri |
| 10 | Medium | Leaked `TypeError` messages | `keywords:[123]` → `400 "k.trim is not a function"`; `title: 42` → `400 "(post.title \|\| "").trim is not a function"` | Explicit type checks with clear validation messages | Clear messages returned; harness treats leaked TypeErrors as failures |
| 11 | Medium | Whitespace-only keyword bypass | MCP schema `min(1)` accepts `"   "`, producing `The Complete Guide to  for …` with empty slug | Trim-then-validate inside the tool logic (covers REST and MCP) | 400 / `isError` with clear message |
| 12 | Medium | Manifest URLs 404 | `logo_url` (`/logo.png`) and `legal_info_url` (`/legal`) returned 404 — ChatGPT install validation fetches these | Embedded 64×64 PNG logo (generator: `scripts/gen-logo.mjs`) and a legal info page; endpoints listed in the 404 index and UI footer | 200 `image/png` with valid PNG signature; 200 HTML |
| 13 | Low | Acronyms mangled in outline titles | `SEO tips` → `Seo Tips` | Already-uppercase words (≤5 chars) preserved in title casing | `SEO tips for small businesses` → `SEO Tips For Small Businesses Guide for B2B marketers` |
| 14 | High | **Calendar repeats identical suggested titles** | Title template was picked by weekday index, so the same keyword landing on the same weekday in two different weeks got an identical title — clicking the UI with 2 posts/week × 4 keywords produced `Email marketing: Everything You Need to Know in 2026` in **both** week 1 and week 3 (4 of 8 titles duplicated) | Template now chosen by a per-keyword usage counter (fresh angle each time the keyword returns); once all 3 templates are used, an editorial ` (Part N)` suffix is added — its length is subtracted from the 60-char budget *before* truncation so long keywords can't clip it back into a duplicate. Content format now rotates on the global post counter as well | Found only by clicking the browser UI; harness now asserts unique **and** ≤60 titles across 4 calendar configs, incl. a 1-keyword × 12-post stress case |
| 15 | Low | **`/favicon.ico` 404 → console errors** | Browsers auto-request `/favicon.ico` on every page load; the JSON 404 logged 1 console error per load (7 accumulated during one test session) — the manifest only advertises `/logo.png`, so HTTP tests never touched it | Serve `/favicon.ico` reusing the embedded logo PNG (PNG is valid favicon data — no second asset) | New harness check `GET /favicon.ico serves an icon`; browser fresh load now shows **0 console errors** |

Supporting doc/UI updates: `README.md` (documents `posts_per_week`, FAQ, unique slugs, and the new acceptance suite), web UI (posts-per-week field, "0 Posts/Week" bad-input button, endpoints list).

**New test tooling:** `mcp-server/user-acceptance-test.mjs` — re-runnable acceptance suite (**104 checks**: health/endpoints incl. favicon, good inputs, result sanity incl. calendar title uniqueness, bad inputs, MCP end-to-end, SSE stability). Run with `node user-acceptance-test.mjs` while the server is up. UI evidence: `mcp-server/ui-browser-test.png` (full-page screenshot of a live response).

## 6b. Real-browser click-through (desktop Chrome via Playwright) — PASS

The earlier "no desktop browser connected" limitation was lifted — every button was clicked on the live page at `http://127.0.0.1:3002/` in a real browser, with fresh values typed into the fields.

| Click / input | Result |
|---|---|
| Button 1, default fields (email marketing / small business owners) | **HTTP 200** — 7 sections, 5 FAQ questions, title ≤ 60, slug `email-marketing` |
| Button 1 after typing new values (`keto diet for beginners` / `busy professionals over 40`) | **HTTP 200** — keyword + audience echoed back, FAQ fits the keyword, slug `keto-diet-for-beginners` |
| Button 1 again (`on page SEO checklist` / `content marketers`) — screenshot: `mcp-server/ui-browser-test.png` | **HTTP 200** — 5 FAQs, full JSON rendered in the output pane |
| Button 2, default 3-post JSON | **HTTP 200** — 3 results, titles ≤ 48 chars, descriptions ≤ 155 |
| Button 2 → "Test Bad Input: Send 21 Posts" | **HTTP 400** — `Cannot generate metadata for more than 20 posts at once. Received 21 posts…` shown in the pane |
| Button 3, default 3/week × 4 keywords | **HTTP 200** — 12 posts, dates 2026-10-19 → 2026-11-13, weekday-matched |
| Button 3 with posts/week typed as **2** | **HTTP 200** — 8 posts (2/2/2/2), `posts_per_week: 2`, cadence "2 posts per week (Monday, Tuesday)", all 8 titles unique & ≤ 60 |
| Button 3 → "Test Bad Input: Empty Keywords" | **HTTP 400** — `At least 1 keyword is required to plan a content calendar.` |
| Button 3 → "Test Bad Input: 0 Posts/Week" | **HTTP 400** — `'posts_per_week' must be a whole number between 1 and 7. Received 0.` |
| Console on a fresh page load | **0 errors** (was 7 before the favicon fix, Bug #15) |

The browser pass is what uncovered **bugs #14 and #15** — both invisible to HTTP-only tests — and both were fixed and locked into the acceptance suite afterwards.

## 7. Things I could not test (or chose not to)

1. **A real ChatGPT session** (plugin install / MCP connector through the ChatGPT UI) — no ChatGPT account or public tunnel exists in this environment. The MCP protocol itself is verified end-to-end twice (raw JSON-RPC over `/mcp`, and the official MCP SDK client over `/sse` via `dist/test-mcp.js`), and the manifest now resolves every URL it advertises — but the actual ChatGPT handshake remains untested. README documents the tunnel step (`cloudflared`/`ngrok`) for when you do it.
2. **~~Clicking the web buttons in a real browser~~ — DONE.** Every button (incl. all three bad-input buttons) was clicked in desktop Chrome via Playwright; results in §6b. Two bugs found and fixed (#14 duplicate calendar titles, #15 favicon 404).
3. **`contact_email: support@example.com` and the legal text are placeholders** — ChatGPT requires a real, monitored email and real terms before public listing. I can't invent those; they're flagged inside the `/legal` page too.
4. **`localhost:3002` URLs in the manifest/OpenAPI** — correct for local dev; a real deployment must swap the tunnel URL. Not fixable in code alone.
5. **Other timezones / DST transitions** — date logic no longer converts through UTC and weekday labels are asserted against real dates, but only the machine's local timezone was exercised.
6. **Load, soak, TLS and auth** — concurrency was tested lightly (2 simultaneous SSE clients plus parallel REST/MCP calls). No long-running soak test; CORS is `*` and auth is "none" by design, so do not expose port 3002 publicly.
7. **Extremely long keywords (>55 chars)** — the 60-char title cap forces truncation, so the keyword tail gets cut (it stays at the front of the title). Designed behaviour, not exhaustively tested.

## Appendix — full check log (104 checks, final run)

| Result | Area | Check | Observed |
|---|---|---|---|
| PASS | 1. Health & endpoints | GET /health answers on port 3002 | status=200 body={"status":"ok","port":3002,"server":"content-seo-tools","uptime_seconds":446.6520165,"tools":[{"name":"generate_blog_outline","phrase":"write a blog outline"},{ |
| PASS | 1. Health & endpoints | /health lists the 3 tool buttons | tools=generate_blog_outline,bulk_generate_metadata,plan_content_calendar |
| PASS | 1. Health & endpoints | GET / returns the button UI |  |
| PASS | 1. Health & endpoints | GET /openapi.json documents all 3 actions |  |
| PASS | 1. Health & endpoints | GET /.well-known/ai-plugin.json returns a manifest |  |
| PASS | 1. Health & endpoints | GET /logo.png (manifest logo_url) serves a real PNG | status=200 type=image/png bytes=171 |
| PASS | 1. Health & endpoints | GET /legal (manifest legal_info_url) serves a page | status=200 length=1523 |
| PASS | 1. Health & endpoints | GET /favicon.ico serves an icon (no console 404s in the UI) | status=200 type=image/png bytes=171 |
| PASS | 2+3. generate_blog_outline (call + result checks) | outline responds 200 — keyword="email marketing" audience="small business owners" |  |
| PASS | 2+3. generate_blog_outline (call + result checks) | title present & <= 60 chars — keyword="email marketing" audience="small business owners" | "Email Marketing Guide for small business owners" (47) |
| PASS | 2+3. generate_blog_outline (call + result checks) | title fits the keyword — keyword="email marketing" audience="small business owners" | "Email Marketing Guide for small business owners" |
| PASS | 2+3. generate_blog_outline (call + result checks) | slug non-empty & url-safe — keyword="email marketing" audience="small business owners" | slug="email-marketing" |
| PASS | 2+3. generate_blog_outline (call + result checks) | sections present — keyword="email marketing" audience="small business owners" | sections=7 |
| PASS | 2+3. generate_blog_outline (call + result checks) | FAQ questions present — keyword="email marketing" audience="small business owners" | faq=5 |
| PASS | 2+3. generate_blog_outline (call + result checks) | FAQ questions fit the keyword — keyword="email marketing" audience="small business owners" | What is email marketing and why should small business owners care? \| How long does it take to see results from email marketing? \| What are the most common email marketing mistakes  |
| PASS | 2+3. generate_blog_outline (call + result checks) | FAQ also appears as an outline section — keyword="email marketing" audience="small business owners" | heading="Frequently Asked Questions (FAQ)" |
| PASS | 2+3. generate_blog_outline (call + result checks) | meta title <= 60 — keyword="email marketing" audience="small business owners" | len=60 |
| PASS | 2+3. generate_blog_outline (call + result checks) | meta description <= 155 — keyword="email marketing" audience="small business owners" | len=146 |
| PASS | 2+3. generate_blog_outline (call + result checks) | word counts internally consistent — keyword="email marketing" audience="small business owners" | total=2300 sum=2300 |
| PASS | 2+3. generate_blog_outline (call + result checks) | outline responds 200 — keyword="organic gardening" audience="urban apartment dwellers" |  |
| PASS | 2+3. generate_blog_outline (call + result checks) | title present & <= 60 chars — keyword="organic gardening" audience="urban apartment dwellers" | "Organic Gardening Guide for urban apartment dwellers" (52) |
| PASS | 2+3. generate_blog_outline (call + result checks) | title fits the keyword — keyword="organic gardening" audience="urban apartment dwellers" | "Organic Gardening Guide for urban apartment dwellers" |
| PASS | 2+3. generate_blog_outline (call + result checks) | slug non-empty & url-safe — keyword="organic gardening" audience="urban apartment dwellers" | slug="organic-gardening" |
| PASS | 2+3. generate_blog_outline (call + result checks) | sections present — keyword="organic gardening" audience="urban apartment dwellers" | sections=7 |
| PASS | 2+3. generate_blog_outline (call + result checks) | FAQ questions present — keyword="organic gardening" audience="urban apartment dwellers" | faq=5 |
| PASS | 2+3. generate_blog_outline (call + result checks) | FAQ questions fit the keyword — keyword="organic gardening" audience="urban apartment dwellers" | What is organic gardening and why should urban apartment dwellers care? \| How long does it take to see results from organic gardening? \| What are the most common organic gardening  |
| PASS | 2+3. generate_blog_outline (call + result checks) | FAQ also appears as an outline section — keyword="organic gardening" audience="urban apartment dwellers" | heading="Frequently Asked Questions (FAQ)" |
| PASS | 2+3. generate_blog_outline (call + result checks) | meta title <= 60 — keyword="organic gardening" audience="urban apartment dwellers" | len=60 |
| PASS | 2+3. generate_blog_outline (call + result checks) | meta description <= 155 — keyword="organic gardening" audience="urban apartment dwellers" | len=151 |
| PASS | 2+3. generate_blog_outline (call + result checks) | word counts internally consistent — keyword="organic gardening" audience="urban apartment dwellers" | total=2300 sum=2300 |
| PASS | 2+3. generate_blog_outline (call + result checks) | outline responds 200 — keyword="freelance pricing" audience="freelance writers" |  |
| PASS | 2+3. generate_blog_outline (call + result checks) | title present & <= 60 chars — keyword="freelance pricing" audience="freelance writers" | "Freelance Pricing Guide for freelance writers" (45) |
| PASS | 2+3. generate_blog_outline (call + result checks) | title fits the keyword — keyword="freelance pricing" audience="freelance writers" | "Freelance Pricing Guide for freelance writers" |
| PASS | 2+3. generate_blog_outline (call + result checks) | slug non-empty & url-safe — keyword="freelance pricing" audience="freelance writers" | slug="freelance-pricing" |
| PASS | 2+3. generate_blog_outline (call + result checks) | sections present — keyword="freelance pricing" audience="freelance writers" | sections=7 |
| PASS | 2+3. generate_blog_outline (call + result checks) | FAQ questions present — keyword="freelance pricing" audience="freelance writers" | faq=5 |
| PASS | 2+3. generate_blog_outline (call + result checks) | FAQ questions fit the keyword — keyword="freelance pricing" audience="freelance writers" | What is freelance pricing and why should freelance writers care? \| How long does it take to see results from freelance pricing? \| What are the most common freelance pricing mistake |
| PASS | 2+3. generate_blog_outline (call + result checks) | FAQ also appears as an outline section — keyword="freelance pricing" audience="freelance writers" | heading="Frequently Asked Questions (FAQ)" |
| PASS | 2+3. generate_blog_outline (call + result checks) | meta title <= 60 — keyword="freelance pricing" audience="freelance writers" | len=59 |
| PASS | 2+3. generate_blog_outline (call + result checks) | meta description <= 155 — keyword="freelance pricing" audience="freelance writers" | len=144 |
| PASS | 2+3. generate_blog_outline (call + result checks) | word counts internally consistent — keyword="freelance pricing" audience="freelance writers" | total=2300 sum=2300 |
| PASS | 2+3. bulk_generate_metadata (call + result checks) | bulk responds 200 — 3 posts / 3 keywords |  |
| PASS | 2+3. bulk_generate_metadata (call + result checks) | total_processed matches input — 3 posts / 3 keywords | processed=3 input=3 |
| PASS | 2+3. bulk_generate_metadata (call + result checks) | every seo_title <= 60 chars — 3 posts / 3 keywords | checked 3 |
| PASS | 2+3. bulk_generate_metadata (call + result checks) | every meta_description <= 155 chars — 3 posts / 3 keywords | checked 3 |
| PASS | 2+3. bulk_generate_metadata (call + result checks) | every slug non-empty & url-safe — 3 posts / 3 keywords | checked 3 |
| PASS | 2+3. bulk_generate_metadata (call + result checks) | slugs are unique — 3 posts / 3 keywords | 3 unique |
| PASS | 2+3. bulk_generate_metadata (call + result checks) | reported lengths match actual strings — 3 posts / 3 keywords | checked 3 |
| PASS | 2+3. bulk_generate_metadata (call + result checks) | search_intent values valid — 3 posts / 3 keywords | ok |
| PASS | 2+3. bulk_generate_metadata (call + result checks) | bulk responds 200 — 5 posts / 5 keywords |  |
| PASS | 2+3. bulk_generate_metadata (call + result checks) | total_processed matches input — 5 posts / 5 keywords | processed=5 input=5 |
| PASS | 2+3. bulk_generate_metadata (call + result checks) | every seo_title <= 60 chars — 5 posts / 5 keywords | checked 5 |
| PASS | 2+3. bulk_generate_metadata (call + result checks) | every meta_description <= 155 chars — 5 posts / 5 keywords | checked 5 |
| PASS | 2+3. bulk_generate_metadata (call + result checks) | every slug non-empty & url-safe — 5 posts / 5 keywords | checked 5 |
| PASS | 2+3. bulk_generate_metadata (call + result checks) | slugs are unique — 5 posts / 5 keywords | 5 unique |
| PASS | 2+3. bulk_generate_metadata (call + result checks) | reported lengths match actual strings — 5 posts / 5 keywords | checked 5 |
| PASS | 2+3. bulk_generate_metadata (call + result checks) | search_intent values valid — 5 posts / 5 keywords | ok |
| PASS | 2+3. plan_content_calendar (call + result checks) | calendar responds 200 — 4 keywords, default cadence |  |
| PASS | 2+3. plan_content_calendar (call + result checks) | 4 weeks × 3 posts with real matching dates — 4 keywords, default cadence | all 12 dates valid, future, weekday-matched |
| PASS | 2+3. plan_content_calendar (call + result checks) | posts-per-week honored — 4 keywords, default cadence | per week: 3,3,3,3 |
| PASS | 2+3. plan_content_calendar (call + result checks) | all suggested titles are unique — 4 keywords, default cadence | 12/12 unique |
| PASS | 2+3. plan_content_calendar (call + result checks) | every suggested title ≤ 60 chars — 4 keywords, default cadence | longest=60 |
| PASS | 2+3. plan_content_calendar (call + result checks) | calendar responds 200 — 3 keywords, 2 posts per week |  |
| PASS | 2+3. plan_content_calendar (call + result checks) | 4 weeks × 2 posts with real matching dates — 3 keywords, 2 posts per week | all 8 dates valid, future, weekday-matched |
| PASS | 2+3. plan_content_calendar (call + result checks) | posts-per-week honored — 3 keywords, 2 posts per week | per week: 2,2,2,2 |
| PASS | 2+3. plan_content_calendar (call + result checks) | all suggested titles are unique — 3 keywords, 2 posts per week | 8/8 unique |
| PASS | 2+3. plan_content_calendar (call + result checks) | every suggested title ≤ 60 chars — 3 keywords, 2 posts per week | longest=57 |
| PASS | 2+3. plan_content_calendar (call + result checks) | calendar responds 200 — 2 keywords, 5 posts per week (Mon-Fri) |  |
| PASS | 2+3. plan_content_calendar (call + result checks) | 4 weeks × 5 posts with real matching dates — 2 keywords, 5 posts per week (Mon-Fri) | all 20 dates valid, future, weekday-matched |
| PASS | 2+3. plan_content_calendar (call + result checks) | posts-per-week honored — 2 keywords, 5 posts per week (Mon-Fri) | per week: 5,5,5,5 |
| PASS | 2+3. plan_content_calendar (call + result checks) | all suggested titles are unique — 2 keywords, 5 posts per week (Mon-Fri) | 20/20 unique |
| PASS | 2+3. plan_content_calendar (call + result checks) | every suggested title ≤ 60 chars — 2 keywords, 5 posts per week (Mon-Fri) | longest=60 |
| PASS | 2+3. plan_content_calendar (call + result checks) | calendar responds 200 — 1 keyword, 12 posts (repeated-keyword title rotation) |  |
| PASS | 2+3. plan_content_calendar (call + result checks) | 4 weeks × 3 posts with real matching dates — 1 keyword, 12 posts (repeated-keyword title rotation) | all 12 dates valid, future, weekday-matched |
| PASS | 2+3. plan_content_calendar (call + result checks) | posts-per-week honored — 1 keyword, 12 posts (repeated-keyword title rotation) | per week: 3,3,3,3 |
| PASS | 2+3. plan_content_calendar (call + result checks) | all suggested titles are unique — 1 keyword, 12 posts (repeated-keyword title rotation) | 12/12 unique |
| PASS | 2+3. plan_content_calendar (call + result checks) | every suggested title ≤ 60 chars — 1 keyword, 12 posts (repeated-keyword title rotation) | longest=60 |
| PASS | 4. Bad inputs | empty keyword rejected with clear error | status=400 "Validation error: 'keyword' is required and must be a non-empty string." |
| PASS | 4. Bad inputs | whitespace-only keyword rejected with clear error | status=400 "Validation error: 'keyword' is required and must be a non-empty string." |
| PASS | 4. Bad inputs | 21 posts rejected with clear error | status=400 "Validation error: Cannot generate metadata for more than 20 posts at once. Received 21 posts. Maximum allowed is 20." |
| PASS | 4. Bad inputs | duplicate titles → safe result with unique slugs | slugs=email-marketing-tips-for-beginners, email-marketing-tips-for-beginners-2 |
| PASS | 4. Bad inputs | punctuation-duplicate titles → unique slugs | slugs=email-marketing-tips, email-marketing-tips-2 |
| PASS | 4. Bad inputs | posts_per_week=0 → clear error | status=400 "Validation error: 'posts_per_week' must be a whole number between 1 and 7. Received 0." |
| PASS | 4. Bad inputs | posts_per_week=8 → clear error | status=400 "Validation error: 'posts_per_week' must be a whole number between 1 and 7. Received 8." |
| PASS | 4. Bad inputs | French keyword → safe outline | title="Meilleures Pratiques SEO Guide for petites entreprises" slug="meilleures-pratiques-seo" |
| PASS | 4. Bad inputs | Spanish keyword → safe outline | title="Como Crear Un Blog Guide for pequeñas empresas" slug="como-crear-un-blog" |
| PASS | 4. Bad inputs | Chinese keyword → safe outline with non-empty slug | title="The Complete Guide to 博客写作技巧 for 自由职业者" slug="keyword-32127e32" |
| PASS | 4. Bad inputs | non-English titles → safe result | slugs=como-crear-un-blog-rentable, mejores-practicas-de-seo, post-32127e32 |
| PASS | 4. Bad inputs | non-English calendar keywords → safe result | valid calendar |
| PASS | 4. Bad inputs | non-string keywords → clear error (not a stack trace) | status=400 "Validation error: keyword at position 1 must be a string. Received number." |
| PASS | 4. Bad inputs | numeric title → clear error (not a stack trace) | status=400 "Validation error: Post at index 1 must have a non-empty 'title' string. Received 42." |
| PASS | 4. Bad inputs | server still alive after all bad inputs | status=200 |
| PASS | 5. MCP protocol end-to-end (/mcp) | initialize succeeds | status=200 event: message
data: {"result":{"protocolVersion":"2025-03-26","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"content-seo-tools","version": |
| PASS | 5. MCP protocol end-to-end (/mcp) | notifications/initialized accepted | status=202  |
| PASS | 5. MCP protocol end-to-end (/mcp) | tools/list returns the 3 tools | status=200 tools=generate_blog_outline,bulk_generate_metadata,plan_content_calendar |
| PASS | 5. MCP protocol end-to-end (/mcp) | tools/call generate_blog_outline returns a valid outline | title="The Complete Guide to Seo Checklist for bloggers" faq=5 |
| PASS | 5. MCP protocol end-to-end (/mcp) | tools/call with 21 posts returns isError (no crash) | {"content":[{"type":"text","text":"Error: Validation error: Cannot generate metadata for more than 20 posts at once. Received 21 posts. Maximum allowed is 20."}],"isError":true} |
| PASS | 5. MCP protocol end-to-end (/mcp) | tools/call posts_per_week=0 → clear isError | {"result":{"content":[{"type":"text","text":"Error: Validation error: 'posts_per_week' must be a whole number between 1 and 7. Received 0."}],"isError":true},"j |
| PASS | 5. MCP protocol end-to-end (/mcp) | tools/call posts_per_week=8 → clear isError | {"result":{"content":[{"type":"text","text":"Error: Validation error: 'posts_per_week' must be a whole number between 1 and 7. Received 8."}],"isError":true},"j |
| PASS | 5. MCP protocol end-to-end (/mcp) | tools/call posts_per_week=2 honors the cadence | total=8 per-week=2,2,2,2 |
| PASS | 5. MCP protocol end-to-end (/mcp) | tools/call whitespace keyword → clear isError | {"result":{"content":[{"type":"text","text":"Error: Validation error: 'keyword' is required and must be a non-empty string."}],"isError":true},"jsonrpc":"2.0"," |
| PASS | 6. SSE endpoint & stability | GET /sse opens a stream | first="event: endpoint
data: /messages?sessionId=a54ccf52-0947-4b7c-87c2-718c6807d56d

" |
| PASS | 6. SSE endpoint & stability | second concurrent /sse client does not kill the server | status=200 event: endpoint
data: /messages?sessionId=155f3dcb-fee9-4b1f-ad1d-24ecec319365

 |
| PASS | 6. SSE endpoint & stability | server survives SSE test (health still ok) | status=200 |
