import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CONTEXT_EVENT_TYPES,
  ContextCharterAdapter,
  ContextEventRejectedError,
  DEFAULT_CONTEXT_PIPELINES,
  REQUIRED_EVENT_CAPABILITIES,
  createContextCharterMcpServer,
} from "../dist/index.js";

const graph = {
  apiVersion: "agent.context/v1",
  kind: "AgentContextGraph",
  metadata: { name: "conformance-fixture" },
  nodes: [
    { id: "policy", type: "context-pod", stability: "immutable", capabilities: ["resolve"] },
    { id: "memory", type: "context-pod", stability: "mutable", capabilities: ["resolve", "cache", "mutable_redaction", "scope_filter", "conflict_detection", "supersession"] },
  ],
  edges: [],
};

const makeEvent = (type, pod = "memory", item = type, occurredAt = "2026-10-03T00:00:00+00:00") => ({
  id: `${type}-${item}-${occurredAt}`,
  type,
  occurred_at: occurredAt,
  subject: { pod, item },
  actor: { type: "test", id: "conformance" },
  effect: {},
  provenance: { source: "test://conformance" },
});

const makeStore = () => {
  const events = new Map([["policy", []], ["memory", []]]);
  let appendCount = 0;
  const provider = (podId) => ({
    async resolve() {
      return { id: `release-${podId}`, status: "answer_ready", blocks: [], citations: [], conflicts: [] };
    },
    async revisions() { return []; },
    async events() { return events.get(podId); },
    async appendEvent(event) { appendCount += 1; events.get(podId).push(event); return event; },
  });
  return { graph: () => graph, provider, events, appendCount: () => appendCount };
};

describe("Agent Context MCP conformance profile", () => {
  it("defines a default pipeline for every Charter event", () => {
    assert.equal(CONTEXT_EVENT_TYPES.length, 21);
    for (const eventType of CONTEXT_EVENT_TYPES) {
      assert.ok(DEFAULT_CONTEXT_PIPELINES[eventType]);
      assert.ok(DEFAULT_CONTEXT_PIPELINES[eventType].steps.length > 0);
    }
    assert.equal(REQUIRED_EVENT_CAPABILITIES["context.mutable.redacted"], "mutable_redaction");
  });

  it("exposes only the provider-neutral MCP surface", async () => {
    const store = makeStore();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createContextCharterMcpServer(store);
    const client = new Client({ name: "conformance", version: "0.1.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      assert.deepEqual(names, ["context_describe", "context_resolve", "context_revisions", "context_events", "context_event_append"]);
      const resources = await client.listResources();
      assert.deepEqual(resources.resources.map((resource) => resource.uri), ["context://graph", "context://pods/policy", "context://pods/memory"]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("fails closed on immutable events, missing capabilities, and out-of-order timestamps", async () => {
    const store = makeStore();
    const adapter = new ContextCharterAdapter(store);
    await assert.rejects(() => adapter.appendEvent(makeEvent("context.mutable.updated", "policy")), ContextEventRejectedError);
    await assert.rejects(() => adapter.appendEvent(makeEvent("context.cache.invalidated", "policy")), ContextEventRejectedError);
    await adapter.appendEvent(makeEvent("context.mutable.updated", "memory", "fact", "2026-10-03T00:00:02+00:00"));
    await assert.rejects(() => adapter.appendEvent(makeEvent("context.mutable.updated", "memory", "fact-old", "2026-10-03T00:00:01+00:00")), ContextEventRejectedError);
  });

  it("treats duplicate event ids as idempotent replays", async () => {
    const store = makeStore();
    const adapter = new ContextCharterAdapter(store);
    const event = makeEvent("context.mutable.updated");
    const first = await adapter.appendEvent(event);
    const replay = await adapter.appendEvent(event);
    assert.equal(first.idempotent_replay, false);
    assert.equal(replay.idempotent_replay, true);
    assert.equal(store.appendCount(), 1);
  });
});
