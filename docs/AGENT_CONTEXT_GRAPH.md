# Agent Context Graph — draft v0.1

Status: working draft

This is the single normative draft for the graph and Pod contract. The example
YAML in `examples/sales-agent.graph.yaml` is the only companion artifact in this
draft. MCP is the first binding over this graph; SDKs and viewers consume the
same binding rather than inventing a second contract.

Agent Context Graph is a provider-neutral graph that declares which ContextPods an
agent can use, what each pod can do, and how a Context Release is compiled for a
model call. It is not an agent loop, workflow engine, vector database, or model
prompt format.

```text
Agent Context Graph
  → MCP provider discovery
  → scope / stability / capability checks
  → context plan
  → immutable Context Release
  → framework adapter (LangChain, Vercel AI SDK, direct API)
```

## Pod is the unit of composition

The Charter does not prescribe who hosts or deploys a Pod. A Pod may be operated
by a customer, an agent framework, a vendor, or a future managed service. The
only requirement is that it implements this contract and communicates through the
chosen transport (MCP in the initial profile).

```text
Agent
  └─ Context Graph
       └─ one or more ContextPods
            ├─ immutable / mutable context
            ├─ fact revisions and redaction events
            ├─ cache and invalidation events
            ├─ temporal / supersession rules
            └─ compiled Context Release
```

GCP, Pinecone, Cloudflare, Postgres, Notion, and other systems are possible
implementations behind a Pod. This Charter does not define their adapters yet.
The provider is never the semantic contract: the Pod contract owns stability,
provenance, redaction, conflict, and release semantics.

## Charter invariants

Every conforming implementation MUST:

1. preserve source provenance for every fact or evidence block;
2. distinguish immutable-within-release from mutable-over-time context;
3. treat redaction as a first-class event, not an ad-hoc delete;
4. prevent a redacted item from entering future resolutions and releases;
5. retain a redaction tombstone or audit reference without retaining forbidden
   content;
6. represent revisions and supersession explicitly;
7. reject or escalate unresolved same-authority conflicts;
8. enforce permission and scope before semantic retrieval;
9. produce an immutable Context Release for a model invocation; and
10. keep model input separate from release, citation, cache, and audit metadata.

An implementation MAY use any storage, index, cache, or model framework. Those
choices are not part of the Charter.

## Graph node types

| Node | Owns | Does not own |
| --- | --- | --- |
| `agent` | graph entry and requested assembly | model loop or tool side effects |
| `context-pod` | bounded context responsibility | final answer generation |
| `provider` | transport connection and provider capabilities | cross-pod authority |
| `resolver` | scope, freshness, temporal, supersession, conflict | external writes |
| `release` | immutable selected evidence and citations | mutable source state |
| `event` | append-only lifecycle signal | silent mutation |

Nodes have a stable `id`; a human-facing `label` is optional and may be edited by
the graph viewer without changing the node identity.

## Stability

`immutable` means immutable within a Context Release or execution. A later policy
version creates a new release; it never edits the old release.

`mutable` means the underlying value can change over time. It does not grant write
authority. A mutable pod may be read-only.

Recommended layers:

- Immutable: constitution, policy, role, tool contract, selected evidence,
  provenance.
- Mutable: session state, task state, working memory, durable memory, external
  current state.

## Capabilities

Capabilities are declared on the pod and exposed through MCP. The first set is:

```text
resolve          get              revisions
cite             history          latest_valid
supersession     conflict_detection
cache            mutable_redaction
scope_filter     subscribe_events
```

Side-effect capabilities (`mutate_source`, `send`, `approve`, `workflow`) are
outside the read/compile contract and require a separate, explicit integration.

## MCP binding

The initial transport profile is MCP. The Charter defines the semantic names;
the Pod operator decides when to call them from an API, SDK, worker, or Agent.
The binding MUST expose these operations:

```text
context_describe
context_resolve
context_revisions
context_events
context_event_append
```

It MUST expose these read resources:

```text
context://graph
context://pods/{pod_id}
```

`context_event_append` does not invent or trigger provider-specific automation.
It validates and records the event the caller chose to emit, then applies the
Charter's required semantic pipeline steps (for example, redaction blocks future
retrieval and invalidates related cache state). A future automation service may
subscribe to these events, but external side effects are not implied by the
event contract.

The adapter MUST fail closed when a requested Pod or capability is missing. It
MUST NOT guess provider-specific tool names or invoke arbitrary provider tools.

## Event model

Events are append-only facts about Context state. They are not prompt fragments.

```text
context.snapshot.created
context.release.published
context.release.revoked

context.cache.created
context.cache.hit
context.cache.miss
context.cache.invalidated
context.cache.expired
context.cache.revalidated

context.mutable.created
context.mutable.updated
context.mutable.superseded
context.mutable.compacted
context.mutable.redacted
context.mutable.expired

context.conflict.detected
context.resolution.selected
context.resolution.escalated
context.evidence.insufficient
context.scope.changed
context.source.revoked
```

Redaction removes a value from future retrieval and releases. Audit metadata and
the redaction tombstone remain; an already-issued release is not silently edited.
If a prior release must no longer be used, it emits `context.release.revoked`.

Every event uses the same envelope:

```yaml
event:
  id: evt_01J...
  type: context.mutable.redacted
  occurred_at: 2026-10-02T12:00:00Z
  subject:
    pod: meeting-history
    item: fact_456
  actor:
    type: user
    id: user_123
  effect:
    retrieval: deny
    future_releases: exclude
  provenance:
    source: connector://notion/workspace/sales
```

The envelope is part of the contract. The event payload may be provider-specific
only inside a namespaced extension.

## Event pipelines

The caller decides when to emit an event. A conforming adapter then applies the
required semantic transition; it does not call a provider-specific automation.

| Event | Required transition |
| --- | --- |
| `context.snapshot.created` | validate provenance; create revision candidate |
| `context.mutable.updated` | create revision candidate; invalidate related cache |
| `context.mutable.superseded` | exclude revision from `latest_valid`; invalidate cache |
| `context.mutable.redacted` | deny future retrieval; invalidate cache; exclude future releases |
| `context.cache.invalidated` | prevent cache reuse |
| `context.conflict.detected` | require escalation; block answer-ready release |
| `context.resolution.selected` | clear the matching escalation; mark release candidate |
| `context.evidence.insufficient` | block answer-ready release |
| `context.scope.changed` | recheck scope; deny affected retrieval; invalidate cache |
| `context.source.revoked` | deny source retrieval; invalidate cache; revoke affected releases |

The remaining cache and release events are observable state transitions with the
same explicit pipeline representation. Replaying the same event `id` is
idempotent: the adapter returns the prior pipeline result without applying it a
second time.

The single graph artifact declares custom pipeline names or additional steps;
the adapter always retains the Charter's required default steps.

Before resolving a Pod, an adapter replays that Pod's accepted event log in
`occurred_at` order. Providers therefore MUST make accepted events durable enough
for a fresh adapter instance to rebuild redaction, cache, supersession, and
escalation state.

## Resolution order

```text
permission
  → scope
  → temporal mode
  → supersession
  → authority precedence
  → exact conflict detection
  → release or escalation
```

Supported temporal modes:

```text
latest_valid | as_of | history | first_known | all_versions | changed_since
```

The default conflict policy is `escalate`. Same-authority contradictory evidence
must not be silently merged.

## SDK shape

```ts
const graph = defineAgentContextGraph({
  agent: "sales-agent",
  pods: [
    contextPod("company-policy")
      .immutable()
      .mcp("https://policy.example.com/mcp")
      .capabilities(["resolve", "cite", "cache"]),
    contextPod("meeting-history")
      .mutable()
      .mcp("https://meetings.example.com/mcp")
      .resolve({ temporal: "latest_valid", conflict: "escalate" })
      .capabilities([
        "resolve", "history", "supersession", "conflict_detection",
        "mutable_redaction",
      ]),
  ],
});

const compiled = await graph.compile({
  query: "A사와 현재 합의된 납품 조건은?",
  budget: { maxInputTokens: 16_000 },
});

await compiled.forVercelAI({ model, messages });
await compiled.forLangChain({ model, messages });
```

`CompiledContext` has two surfaces:

- model input: `system`, `messages`, and optional lazy MCP resources;
- runtime metadata: `releaseId`, `contextHandle`, citations, exclusions, and
  conflict state.

The model should not receive runtime metadata accidentally. Framework adapters
decide how the model-facing blocks are represented.

## Framework adapters

Vercel AI SDK maps immutable policy to `system`, selected evidence and conversation
to `messages`, and release metadata to `experimental_context`. `prepareStep` may
recompile after a tool result.

LangChain maps the compiled blocks to `SystemMessage` and model messages. LangGraph
state should retain raw blocks or a release handle and format messages at the node
that calls the model.

The graph is the source of truth. YAML is one optional import/export format, not a
set of hand-maintained files.
