# Agent Context MCP Profile v0.1

This document is the MCP binding for the provider-neutral Agent Context
Charter. It defines what a ContextPod MCP server must expose; it does not define
how a provider stores data or deploys a server.

## Required server surface

Every conforming Pod server exposes:

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

The tool names are semantic contract names. Providers must not require a client
to guess provider-specific aliases.

## Capability negotiation

`context_describe` is the authoritative capability document for a graph. A Pod
declares `stability`, `capabilities`, accepted/emitted event types, and optional
resolution policies. A caller MUST:

1. read the graph before resolving or appending an event;
2. fail closed when a Pod is absent;
3. fail closed when the Pod lacks the required capability;
4. reject mutable events on immutable Pods; and
5. preserve the graph's scope, event, and pipeline declarations.

The reference binding does not call arbitrary tools returned by a Provider. A
Provider may expose additional tools, but they are outside the Charter profile.

## Context resolution

`context_resolve` returns a Context Release, not a raw search response.

```json
{
  "id": "release:...",
  "status": "answer_ready",
  "blocks": [],
  "citations": [],
  "conflicts": [],
  "excluded": []
}
```

`requires_escalation` is never answer-ready. Provider releases with that status,
Charter conflict state, insufficient evidence, revoked sources, or redacted items
must not be flattened into a successful response.

## Event ordering and replay

- `event.id` is the idempotency key.
- The same event ID returns an idempotent replay and does not reapply effects.
- A Pod event log is durable and replayable.
- Events are replayed in `occurred_at` order before resolution.
- A newly appended event whose timestamp precedes the latest accepted event for
  the Pod is rejected by the reference binding.
- `causation_id` and `correlation_id` are optional tracing fields; they do not
  replace `event.id`.

Provider implementations remain responsible for atomic persistence and
multi-writer ordering. The reference binding defines the observable contract.

## Authorization and scope

Authentication is transport/runtime policy. A Provider may use bearer headers,
mTLS, workload identity, or another mechanism. The Charter does not accept
credentials in the graph YAML.

The caller supplies the authorized actor and Pod scope through the Provider's
runtime context. A provider MUST enforce scope before semantic retrieval and
must not widen scope through `context_event_append`.

## Conformance

The repository's conformance suite checks:

- all 21 Charter event types have a default pipeline;
- the exact MCP resource/tool surface;
- capability and immutable/mutable gates;
- chronological event ordering;
- idempotent replay; and
- redaction, cache, conflict, escalation, and release behavior.

Provider authors should run this suite against an in-memory or remote MCP
implementation before declaring Charter compatibility.
