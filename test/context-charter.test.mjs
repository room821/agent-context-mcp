import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ContextCharterAdapter, ContextEventRejectedError, createContextCharterMcpServer } from "../dist/index.js";

const graph = {
  apiVersion: "agent.context/v1",
  kind: "AgentContextGraph",
  metadata: { name: "sales-agent" },
  nodes: [
    { id: "policy", label: "Policy", type: "context-pod", stability: "immutable", capabilities: ["resolve", "cite"], resolution: { temporal: "latest_valid", conflict: "escalate" } },
    { id: "memory", label: "Memory", type: "context-pod", stability: "mutable", capabilities: ["resolve", "cache", "mutable_redaction", "scope_filter", "conflict_detection", "supersession"] },
  ],
  edges: [],
};

const provider = {
  async resolve() {
    return {
      id: "provider-release",
      status: "answer_ready",
      blocks: [{ id: "fact-1", pod_id: "policy", text: "Approved policy", stability: "immutable", source_refs: ["source-1"] }],
      citations: ["source-1"],
      conflicts: [],
    };
  },
  async revisions() { return [{ id: "rev-1", pod_id: "policy", created_at: "2026-10-02T00:00:00+00:00" }]; },
  async events() { return []; },
  async appendEvent(event) { return event; },
};

const store = {
  graph: () => graph,
  provider: () => provider,
};

describe("Agent Context Charter MCP adapter", () => {
  it("exposes the graph as a resource and resolves a release", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createContextCharterMcpServer(store);
    const client = new Client({ name: "charter-test", version: "0.1.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const resources = await client.listResources();
      assert.equal(resources.resources[0].uri, "context://graph");
      const graphResource = await client.readResource({ uri: "context://graph" });
      assert.equal(JSON.parse(graphResource.contents[0].text).metadata.name, "sales-agent");
      const resolved = await client.callTool({ name: "context_resolve", arguments: { query: "current policy" } });
      assert.equal(JSON.parse(resolved.content[0].text).status, "answer_ready");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("passes caller-owned events to the provider and returns the required pipeline", async () => {
    let received;
    const eventStore = { ...store, provider: () => ({ ...provider, async appendEvent(event) { received = event; return event; } }) };
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createContextCharterMcpServer(eventStore);
    const client = new Client({ name: "charter-event-test", version: "0.1.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const event = { id: "evt-1", type: "context.mutable.redacted", occurred_at: "2026-10-02T00:00:00+00:00", subject: { pod: "memory", item: "fact-1" }, actor: { type: "user", id: "u-1" }, effect: { retrieval: "deny", future_releases: "exclude" }, provenance: { source: "api://caller" } };
      const result = await client.callTool({ name: "context_event_append", arguments: { event } });
      assert.deepEqual(JSON.parse(result.content[0].text).pipeline.steps.slice(0, 3), ["deny_future_retrieval", "invalidate_related_cache", "exclude_from_future_releases"]);
      assert.deepEqual(received, event);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("runs redaction and cache invalidation before subsequent resolution", async () => {
    const requests = [];
    const events = [];
    const pipelineStore = {
      graph: () => graph,
      provider: () => ({
        async resolve(request) {
          requests.push(request);
          return { id: "provider-release", status: "answer_ready", blocks: [
            { id: "fact-1", pod_id: "memory", text: "private", stability: "mutable", source_refs: ["source-1"] },
            { id: "fact-2", pod_id: "memory", text: "public", stability: "mutable", source_refs: ["source-2"] },
          ], citations: ["source-1", "source-2"], conflicts: [] };
        },
        async revisions() { return []; },
        async events() { return events; },
        async appendEvent(event) { events.push(event); return event; },
      }),
    };
    const adapter = new ContextCharterAdapter(pipelineStore);
    const before = await adapter.resolve({ query: "facts", pod_ids: ["memory"] });
    assert.equal(before.blocks.length, 2);
    const event = { id: "redact-1", type: "context.mutable.redacted", occurred_at: "2026-10-02T00:00:00+00:00", subject: { pod: "memory", item: "fact-1" }, actor: { type: "user", id: "u-1" }, effect: { retrieval: "deny", future_releases: "exclude" }, provenance: { source: "api://caller" } };
    const result = await adapter.appendEvent(event);
    assert.equal(result.cache_invalidated, true);
    const after = await adapter.resolve({ query: "facts", pod_ids: ["memory"] });
    assert.deepEqual(after.blocks.map((block) => block.id), ["fact-2"]);
    assert.equal(requests.at(-1).cache, "bypass");
    assert.deepEqual(events, [event]);
    const reloaded = new ContextCharterAdapter(pipelineStore);
    const recovered = await reloaded.resolve({ query: "facts", pod_ids: ["memory"] });
    assert.deepEqual(recovered.blocks.map((block) => block.id), ["fact-2"]);
  });

  it("blocks answer-ready releases on conflict until a resolution is selected", async () => {
    const pipelineStore = {
      graph: () => graph,
      provider: () => provider,
    };
    const adapter = new ContextCharterAdapter(pipelineStore);
    const conflict = { id: "conflict-1", type: "context.conflict.detected", occurred_at: "2026-10-02T00:00:00+00:00", subject: { pod: "memory", item: "delivery_date" }, actor: { type: "resolver", id: "resolver-1" }, effect: {}, provenance: { source: "api://resolver" } };
    await adapter.appendEvent(conflict);
    assert.equal((await adapter.resolve({ query: "delivery" })).status, "requires_escalation");
    const selected = { id: "selected-1", type: "context.resolution.selected", occurred_at: "2026-10-02T00:00:01+00:00", subject: { pod: "memory", item: "delivery_date" }, actor: { type: "user", id: "u-1" }, effect: {}, provenance: { source: "api://caller" } };
    await adapter.appendEvent(selected);
    assert.equal((await adapter.resolve({ query: "delivery" })).status, "answer_ready");
  });

  it("rejects mutable events on immutable pods and deduplicates event ids", async () => {
    const adapter = new ContextCharterAdapter({ graph: () => graph, provider: () => provider });
    const event = { id: "immutable-redact", type: "context.mutable.redacted", occurred_at: "2026-10-02T00:00:00+00:00", subject: { pod: "policy", item: "fact-1" }, actor: { type: "user", id: "u-1" }, effect: { retrieval: "deny" }, provenance: { source: "api://caller" } };
    await assert.rejects(() => adapter.appendEvent(event), ContextEventRejectedError);
    const valid = { ...event, id: "mutable-redact", subject: { pod: "memory", item: "fact-1" } };
    const first = await adapter.appendEvent(valid);
    const replay = await adapter.appendEvent(valid);
    assert.equal(first.idempotent_replay, false);
    assert.equal(replay.idempotent_replay, true);
  });
});
