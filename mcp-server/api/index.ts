// Vercel serverless entry point.
//
// Unlike the sibling NeuronWriter server (which exports an Express app),
// this server is built on raw node:http with a single `handleRequest(req, res)`
// function. That signature is exactly what @vercel/node accepts as a default
// export, so we re-export it and vercel.json routes every path here.
//
// src/index.ts checks process.env.VERCEL and skips httpServer.listen() when it
// is set, so importing the module on the platform does not try to bind port
// 3002 (which would hang the function).
//
// The SSE transport (/sse, /messages) needs shared in-memory state across
// requests, which serverless invocations do not have. Callers should use the
// stateless Streamable HTTP endpoint at POST /mcp.
import { handleRequest } from "../src/index.js";

export default handleRequest;
