import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createContextCharterMcpServer } from "../dist/index.js";

const graph = {
  apiVersion: "agent.context/v1",
  kind: "AgentContextGraph",
  metadata: { name: "codex-exec-fixture" },
  nodes: [{
    id: "memory",
    type: "context-pod",
    stability: "mutable",
    capabilities: ["resolve", "cache", "mutable_redaction", "scope_filter"],
  }],
  edges: [],
};

const facts = [
  { id: "fact-public", pod_id: "memory", text: "The public policy is active.", stability: "mutable", source_refs: ["source-public"] },
  { id: "fact-private", pod_id: "memory", text: "The private note must be redacted.", stability: "mutable", source_refs: ["source-private"] },
];
const events = [];
const provider = {
  async resolve() {
    const redacted = new Set(events.filter((event) => event.type === "context.mutable.redacted").map((event) => event.subject.item));
    const blocks = facts.filter((fact) => !redacted.has(fact.id));
    return { id: `fixture-${blocks.map((block) => block.id).join("-")}`, status: blocks.length ? "answer_ready" : "empty", blocks, citations: blocks.flatMap((block) => block.source_refs), conflicts: [] };
  },
  async revisions() { return []; },
  async events() { return events; },
  async appendEvent(event) { events.push(event); return event; },
};

const server = createContextCharterMcpServer({ graph: () => graph, provider: () => provider });
await server.connect(new StdioServerTransport());
