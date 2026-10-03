# Changelog

## 0.1.2 — 2026-10-03

- Make the event envelope explicit in MCP tool schemas.
- Add a Codex exec stdio fixture for end-to-end Agent tool-call smoke testing.

## 0.1.1 — 2026-10-03

- Make the `context_event_append` MCP input schema explicit so Agents emit the
  Charter event envelope instead of inventing provider-specific fields.

## 0.1.0 — 2026-10-03

- Initial Agent Context Charter MCP profile.
- Provider-neutral graph, Pod, release, event, and pipeline contracts.
- Reference MCP server and local graph viewer.
- In-memory and Streamable HTTP conformance coverage.
