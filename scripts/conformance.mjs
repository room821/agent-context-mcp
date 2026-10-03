#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ContextGraphSchema } from "../dist/index.js";

const endpoint = process.argv[2];
if (!endpoint) {
  console.error("Usage: npm run conformance -- https://provider.example.com/mcp");
  process.exit(2);
}

const expectedTools = ["context_describe", "context_resolve", "context_revisions", "context_events", "context_event_append"];
const expectedResources = ["context://graph"];
const headers = process.env.AGENT_CONTEXT_MCP_BEARER_TOKEN
  ? { Authorization: `Bearer ${process.env.AGENT_CONTEXT_MCP_BEARER_TOKEN}` }
  : undefined;
const client = new Client({ name: "agent-context-conformance", version: "0.1.0" });
const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
  requestInit: headers ? { headers } : undefined,
});

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const resources = await client.listResources();
  const toolNames = tools.tools.map((tool) => tool.name);
  const resourceUris = resources.resources.map((resource) => resource.uri);
  const missingTools = expectedTools.filter((name) => !toolNames.includes(name));
  const missingResources = expectedResources.filter((uri) => !resourceUris.includes(uri));
  if (missingTools.length || missingResources.length) {
    throw new Error(JSON.stringify({ missingTools, missingResources }));
  }
  const graphResource = await client.readResource({ uri: "context://graph" });
  const graph = ContextGraphSchema.parse(JSON.parse(graphResource.contents[0].text));
  console.log(JSON.stringify({
    compatible: true,
    graph: graph.metadata.name,
    pods: graph.nodes.filter((node) => node.type === "context-pod").map((node) => node.id),
    tools: expectedTools,
    resources: resourceUris,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ compatible: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
