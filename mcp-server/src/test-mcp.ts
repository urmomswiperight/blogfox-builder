import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

async function testMcpProtocol() {
  console.log("================================================================================");
  console.log("🔌 TESTING MCP PROTOCOL VIA SSE TRANSPORT");
  console.log("================================================================================\n");

  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: {} }
  );

  const transport = new SSEClientTransport(new URL("http://localhost:3002/sse"));

  await client.connect(transport);
  console.log("✅ MCP Client connected successfully to http://localhost:3002/sse\n");

  // 1. List tools
  const { tools } = await client.listTools();
  console.log(`📋 Found ${tools.length} MCP Tools:`);
  for (const t of tools) {
    console.log(`  - [${t.name}]: ${t.description}`);
  }
  console.log("");

  // 2. Call Tool 1: generate_blog_outline ("write a blog outline")
  console.log("▶ Calling MCP Tool 1: generate_blog_outline");
  const outlineRes = await client.callTool({
    name: "generate_blog_outline",
    arguments: { keyword: "cold email outreach", audience: "b2b sales reps" },
  });
  console.log("  Result:", JSON.stringify(outlineRes, null, 2).slice(0, 300) + "...\n");

  // 3. Call Tool 2: bulk_generate_metadata ("generate meta descriptions for many posts")
  console.log("▶ Calling MCP Tool 2: bulk_generate_metadata (2 posts)");
  const metaRes = await client.callTool({
    name: "bulk_generate_metadata",
    arguments: {
      posts: [
        { title: "Cold Email Templates", topic: "B2B Sales" },
        { title: "Follow-Up Sequences", topic: "Email Cadence" },
      ],
    },
  });
  console.log("  Result:", JSON.stringify(metaRes, null, 2).slice(0, 300) + "...\n");

  // 4. Call Tool 2 with Bad Input: 21 posts at once
  console.log("▶ Calling MCP Tool 2 with Bad Input (21 posts)");
  const posts21 = Array.from({ length: 21 }, (_, i) => ({
    title: `Post #${i + 1}`,
  }));
  const badMetaRes = await client.callTool({
    name: "bulk_generate_metadata",
    arguments: { posts: posts21 },
  });
  console.log("  Result (handled error):", JSON.stringify(badMetaRes, null, 2) + "\n");

  // 5. Call Tool 3: plan_content_calendar ("plan my content calendar")
  console.log("▶ Calling MCP Tool 3: plan_content_calendar");
  const calRes = await client.callTool({
    name: "plan_content_calendar",
    arguments: {
      keywords: ["sales cadence", "inbox deliverability", "lead prospecting"],
    },
  });
  console.log("  Result:", JSON.stringify(calRes, null, 2).slice(0, 300) + "...\n");

  await client.close();
  console.log("✅ MCP Test Completed Successfully!\n");
}

testMcpProtocol().catch((err) => {
  console.error("MCP test error:", err);
  process.exit(1);
});
