import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  ContextCharterAdapter,
  ContextEventSchema,
  ContextResolveRequestSchema,
} from "./context-charter.js";
import type { ContextCharterStore } from "./context-charter.js";

const GRAPH_URI = "context://graph";
const POD_URI_PREFIX = "context://pods/";
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

const tools = [
  { name: "context_describe", description: "Read the Agent Context Graph and Pod capabilities.", inputSchema: { type: "object", properties: {} } },
  { name: "context_resolve", description: "Compile a Context Release from one or more ContextPods.", inputSchema: { type: "object", properties: { query: { type: "string" }, pod_ids: { type: "array", items: { type: "string" } }, temporal: { type: "string" }, max_blocks: { type: "number" } }, required: ["query"] } },
  { name: "context_revisions", description: "List revisions for a ContextPod.", inputSchema: { type: "object", properties: { pod_id: { type: "string" } }, required: ["pod_id"] } },
  { name: "context_events", description: "Read append-only Context events for a ContextPod.", inputSchema: { type: "object", properties: { pod_id: { type: "string" } }, required: ["pod_id"] } },
  { name: "context_event_append", description: "Append a Charter event. The caller decides when to emit it; the provider enforces authorization.", inputSchema: { type: "object", properties: { event: { type: "object" } }, required: ["event"] } },
] as const;

export const createContextCharterMcpServer = (store: ContextCharterStore): Server => {
  const adapter = new ContextCharterAdapter(store);
  const server = new Server(
    { name: "agent-context-charter", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...tools] }));
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      { uri: GRAPH_URI, name: "Agent Context Graph", mimeType: "application/json" },
      ...adapter.describe().nodes.filter((node) => node.type === "context-pod").map((node) => ({ uri: `${POD_URI_PREFIX}${encodeURIComponent(node.id)}`, name: node.id, mimeType: "application/json" })),
    ],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    if (uri === GRAPH_URI) return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(adapter.describe(), null, 2) }] };
    if (uri.startsWith(POD_URI_PREFIX)) {
      const podId = decodeURIComponent(uri.slice(POD_URI_PREFIX.length));
      const pod = adapter.describe().nodes.find((node) => node.id === podId && node.type === "context-pod");
      if (pod) return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(pod, null, 2) }] };
    }
    throw new Error(`Unknown Context resource: ${uri}`);
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments ?? {};
    switch (request.params.name) {
      case "context_describe": return text(adapter.describe());
      case "context_resolve": return text(await adapter.resolve(ContextResolveRequestSchema.parse(args)));
      case "context_revisions": {
        const podId = String(args.pod_id ?? "");
        if (!podId) throw new Error("context_revisions requires pod_id");
        return text(await adapter.revisions(podId));
      }
      case "context_events": {
        const podId = String(args.pod_id ?? "");
        if (!podId) throw new Error("context_events requires pod_id");
        return text(await adapter.events(podId));
      }
      case "context_event_append": {
        const event = ContextEventSchema.parse(args.event);
        return text(await adapter.appendEvent(event));
      }
      default: throw new Error(`Unknown Context tool: ${request.params.name}`);
    }
  });
  return server;
};
