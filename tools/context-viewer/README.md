# Agent Context Graph Viewer

Local-only graph editor for the single Charter YAML artifact. It does not
connect to providers or production data.

```bash
node scripts/context-viewer.mjs
```

Open <http://127.0.0.1:4177>. Select a node, edit its stability or capabilities,
apply the change, and press **Save YAML**. The server writes the same
`docs/agent-context/examples/sales-agent.graph.yaml` file.

The viewer uses the repository's direct `yaml` dependency only for local parsing
and serialization; it does not add a provider SDK or a production dependency.
