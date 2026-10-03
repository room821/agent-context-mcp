const state = { graph: null, selectedId: null, filter: "" };
const $ = (selector) => document.querySelector(selector);

const kindClass = (node) => node.type === "provider" ? "provider" : node.stability;
const nodePosition = (nodeId) => ({
  "sales-agent": [8, 42],
  "company-policy": [32, 12],
  "meeting-history": [32, 42],
  "context-release": [61, 42],
  "session-state": [32, 72],
})[nodeId] || [15, 15];

function visibleNodes() {
  return state.graph.nodes.filter((node) => `${node.id} ${node.type}`.toLowerCase().includes(state.filter.toLowerCase()));
}

function selectNode(id) {
  state.selectedId = id;
  render();
}

function renderList() {
  const list = $("#node-list");
  list.innerHTML = visibleNodes().map((node) => `
    <button class="node-row ${node.id === state.selectedId ? "selected" : ""}" data-node="${node.id}" type="button">
      <strong>${node.label || node.id}</strong>
      <small>${node.type}</small>
      <em class="${node.stability}">${node.stability}</em>
    </button>
  `).join("");
  list.querySelectorAll("[data-node]").forEach((button) => button.addEventListener("click", () => selectNode(button.dataset.node)));
}

function renderGraph() {
  const cards = $("#cards");
  const svg = $("#edges");
  cards.innerHTML = "";
  svg.innerHTML = "";
  const byId = new Map(state.graph.nodes.map((node) => [node.id, node]));
  state.graph.edges.forEach((edge) => {
    const from = nodePosition(edge.from);
    const to = nodePosition(edge.to);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", `${from[0] + 13}%`);
    line.setAttribute("y1", `${from[1] + 6}%`);
    line.setAttribute("x2", `${to[0] + 1}%`);
    line.setAttribute("y2", `${to[1] + 6}%`);
    svg.appendChild(line);
  });
  visibleNodes().forEach((node) => {
    const card = document.createElement("button");
    card.className = `graph-card ${kindClass(node)} ${node.id === state.selectedId ? "selected" : ""}`;
    card.type = "button";
    const [left, top] = nodePosition(node.id);
    card.style.left = `${left}%`;
    card.style.top = `${top}%`;
    card.innerHTML = `<span class="kind">${node.type}</span><h3>${node.label || node.id}</h3><p>${node.summary || "Context contract node"}</p>`;
    card.addEventListener("click", () => selectNode(node.id));
    cards.appendChild(card);
  });
}

function renderInspector() {
  const inspector = $("#inspector");
  const node = state.graph.nodes.find((candidate) => candidate.id === state.selectedId);
  if (!node) { inspector.innerHTML = `<div class="inspector-empty">Select a node to edit its contract.</div>`; return; }
  const capabilities = node.capabilities || [];
  const known = ["resolve", "cite", "cache", "revisions", "history", "supersession", "conflict_detection", "mutable_redaction", "scope_filter", "compile"];
  inspector.innerHTML = `
    <p class="eyebrow">NODE INSPECTOR</p>
    <h2>${node.label || node.id}</h2>
    <p class="inspector-copy">Edit the graph contract. Provider behavior is not implemented here.</p>
    <div class="field"><label for="node-label">Label</label><input id="node-label" value="${node.label || node.id}" /></div>
    <div class="field"><label for="node-stability">Stability</label><select id="node-stability"><option value="immutable" ${node.stability === "immutable" ? "selected" : ""}>immutable</option><option value="mutable" ${node.stability === "mutable" ? "selected" : ""}>mutable</option></select></div>
    <div class="field"><label>Capabilities</label><div class="capabilities">${known.map((capability) => `<button class="capability ${capabilities.includes(capability) ? "on" : ""}" data-capability="${capability}" type="button">${capability}</button>`).join("")}</div></div>
    <button id="apply-node" class="inspector-save" type="button">Apply node changes</button>
  `;
  inspector.querySelectorAll("[data-capability]").forEach((button) => button.addEventListener("click", () => button.classList.toggle("on")));
  $("#apply-node").addEventListener("click", () => {
    node.label = $("#node-label").value.trim() || node.id;
    node.stability = $("#node-stability").value;
    node.capabilities = [...inspector.querySelectorAll("[data-capability].on")].map((button) => button.dataset.capability);
    $("#save-state").textContent = "Unsaved graph changes";
    $("#save-state").classList.remove("is-saved");
    render();
  });
}

async function saveGraph() {
  const response = await fetch("/api/graph", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(state.graph) });
  if (!response.ok) throw new Error(`Save failed (${response.status})`);
  $("#save-state").textContent = "Saved to graph.yaml";
  $("#save-state").classList.add("is-saved");
}

function render() {
  $("#graph-name").textContent = state.graph.metadata.name;
  $("#node-count").textContent = state.graph.nodes.length;
  renderList(); renderGraph(); renderInspector();
}

$("#node-filter").addEventListener("input", (event) => { state.filter = event.target.value; render(); });
$("#save").addEventListener("click", () => saveGraph().catch((error) => { $("#save-state").textContent = error.message; }));
fetch("/api/graph").then((response) => response.json()).then((graph) => { state.graph = graph; state.selectedId = graph.nodes[0]?.id || null; render(); }).catch((error) => { $("#save-state").textContent = error.message; });
