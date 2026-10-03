import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createContextCharterMcpServer } from "../dist/index.js";

const graph = {
  apiVersion: "agent.context/v1",
  kind: "AgentContextGraph",
  metadata: { name: "http-conformance" },
  nodes: [{ id: "memory", type: "context-pod", stability: "mutable", capabilities: ["resolve", "cache", "mutable_redaction"] }],
  edges: [],
};

const provider = {
  async resolve() { return { id: "release-1", status: "answer_ready", blocks: [], citations: [], conflicts: [] }; },
  async revisions() { return []; },
  async events() { return []; },
  async appendEvent(event) { return event; },
};

describe("Agent Context MCP Streamable HTTP profile", () => {
  it("serves the exact resources and tools over a real HTTP transport", async () => {
    const mcpServer = createContextCharterMcpServer({ graph: () => graph, provider: () => provider });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
    await mcpServer.connect(transport);
    const httpServer = createServer((request, response) => transport.handleRequest(request, response));
    await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    assert.equal(typeof address, "object");
    const client = new Client({ name: "http-conformance", version: "0.1.0" });
    const clientTransport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
      requestInit: { headers: { Authorization: "Bearer conformance" } },
    });
    try {
      await client.connect(clientTransport);
      const tools = await client.listTools();
      assert.deepEqual(tools.tools.map((tool) => tool.name), ["context_describe", "context_resolve", "context_revisions", "context_events", "context_event_append"]);
      const resources = await client.listResources();
      assert.deepEqual(resources.resources.map((resource) => resource.uri), ["context://graph", "context://pods/memory"]);
      const result = await client.callTool({ name: "context_resolve", arguments: { query: "current state" } });
      assert.equal(JSON.parse(result.content[0].text).status, "empty");
    } finally {
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
      await mcpServer.close().catch(() => {});
      await new Promise((resolve) => httpServer.close(resolve));
    }
  });
});
