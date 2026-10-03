# Agent Context MCP

Provider-neutral MCP binding for the Agent Context Charter.

This repository defines how an Agent Context Graph and ContextPod contract are
exposed through MCP. It does not ship GCP, Pinecone, Cloudflare, database, or
hosted Pod connectors. A provider implements the `ContextPodProvider` contract
and supplies its own storage, API, deployment, and durable event log.

## MCP surface

Resources:

```text
context://graph
context://pods/{pod_id}
```

Tools:

```text
context_describe
context_resolve
context_revisions
context_events
context_event_append
```

`context_event_append` applies the Charter's required semantic pipeline steps
(redaction, cache invalidation, supersession, conflict escalation, and release
eligibility) without guessing provider-specific side effects. The adapter
replays accepted Pod events before resolving so the semantic state survives a
process restart.

## Development

```bash
npm install
npm test
```

The normative graph document is [`docs/AGENT_CONTEXT_GRAPH.md`](docs/AGENT_CONTEXT_GRAPH.md).
The MCP binding and conformance rules are [`docs/MCP_PROFILE.md`](docs/MCP_PROFILE.md).
The YAML fixture is [`docs/sales-agent.graph.yaml`](docs/sales-agent.graph.yaml).
