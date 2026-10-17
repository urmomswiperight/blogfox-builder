/**
 * Comprehensive Test Suite for ChatGPT Plugin & MCP Server
 * Tests all 3 buttons/tools, valid inputs, and bad inputs (including 21 posts at once).
 */

const BASE_URL = "http://localhost:3002";

async function runTests() {
  console.log("================================================================================");
  console.log("🧪 STARTING TEST SUITE: Content & SEO Plugin Server (Port 3002)");
  console.log("================================================================================\n");

  let passed = 0;
  let failed = 0;

  // Helper for HTTP requests
  async function testEndpoint(
    name: string,
    url: string,
    method: "GET" | "POST",
    body?: any,
    expectedStatus = 200
  ) {
    console.log(`▶ TEST: ${name}`);
    try {
      const options: RequestInit = {
        method,
        headers: { "Content-Type": "application/json" },
      };
      if (body) {
        options.body = JSON.stringify(body);
      }

      const res = await fetch(`${BASE_URL}${url}`, options);
      const data = await res.json();

      console.log(`  Status: ${res.status} (Expected: ${expectedStatus})`);
      if (res.status === expectedStatus) {
        console.log(`  ✅ PASSED`);
        passed++;
      } else {
        console.log(`  ❌ FAILED: Status mismatch`);
        failed++;
      }
      console.log(`  Response Preview:\n`, JSON.stringify(data, null, 2).split("\n").slice(0, 15).join("\n"));
      if (JSON.stringify(data, null, 2).split("\n").length > 15) {
        console.log("  ... (truncated for display)");
      }
      console.log("--------------------------------------------------------------------------------\n");
      return { status: res.status, data };
    } catch (err: any) {
      console.log(`  ❌ FAILED with exception:`, err.message);
      failed++;
      console.log("--------------------------------------------------------------------------------\n");
      return { error: err.message };
    }
  }

  // 1. Health check
  await testEndpoint("Health Check", "/health", "GET", undefined, 200);

  // 2. Plugin Manifest
  await testEndpoint("ChatGPT Plugin Manifest", "/.well-known/ai-plugin.json", "GET", undefined, 200);

  // 3. OpenAPI Spec
  await testEndpoint("OpenAPI Specification", "/openapi.json", "GET", undefined, 200);

  // 4. Button 1 (Valid): "write a blog outline"
  console.log("🔷 BUTTON 1: generate_blog_outline (\"write a blog outline\")");
  await testEndpoint(
    "Button 1: Valid Outline Request",
    "/generate_blog_outline",
    "POST",
    {
      keyword: "sustainable fashion",
      audience: "gen z shoppers",
    },
    200
  );

  // 5. Button 1 (Bad Input): missing audience
  await testEndpoint(
    "Button 1: Bad Input (Missing audience)",
    "/generate_blog_outline",
    "POST",
    {
      keyword: "sustainable fashion",
      audience: "",
    },
    400
  );

  // 6. Button 2 (Valid): "generate meta descriptions for many posts" (3 posts)
  console.log("🔷 BUTTON 2: bulk_generate_metadata (\"generate meta descriptions for many posts\")");
  await testEndpoint(
    "Button 2: Valid Bulk Metadata (3 posts)",
    "/bulk_generate_metadata",
    "POST",
    {
      posts: [
        { title: "Complete Guide to Ethical Denim", topic: "Ethical denim clothing" },
        { title: "Best Thrift Stores in Brooklyn", topic: "Vintage thrift shopping" },
        { title: "How to Build a Capsule Wardrobe", topic: "Minimalist fashion" },
      ],
    },
    200
  );

  // 7. Button 2 (Bad Input): Exactly 21 posts at once!
  const posts21 = Array.from({ length: 21 }, (_, i) => ({
    title: `Post Title Number ${i + 1}`,
    topic: `Topic ${i + 1}`,
  }));

  console.log(`[Testing boundary condition: Sending array of ${posts21.length} posts]`);
  await testEndpoint(
    "Button 2: Bad Input — Exceeding Limit with 21 Posts at Once",
    "/bulk_generate_metadata",
    "POST",
    { posts: posts21 },
    400
  );

  // 8. Button 2 (Bad Input): Empty array of posts
  await testEndpoint(
    "Button 2: Bad Input — Empty posts array",
    "/bulk_generate_metadata",
    "POST",
    { posts: [] },
    400
  );

  // 9. Button 3 (Valid): "plan my content calendar"
  console.log("🔷 BUTTON 3: plan_content_calendar (\"plan my content calendar\")");
  await testEndpoint(
    "Button 3: Valid 4-Week Content Calendar (4 keywords)",
    "/plan_content_calendar",
    "POST",
    {
      keywords: [
        "ethical denim",
        "thrift flipping",
        "capsule wardrobe",
        "sustainable fabrics",
      ],
    },
    200
  );

  // 10. Button 3 (Bad Input): Empty keywords list
  await testEndpoint(
    "Button 3: Bad Input — Empty keywords array",
    "/plan_content_calendar",
    "POST",
    { keywords: [] },
    400
  );

  console.log("================================================================================");
  console.log(`🏁 TEST RESULTS SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner encountered fatal error:", err);
  process.exit(1);
});
