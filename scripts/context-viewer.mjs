import { existsSync, createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const viewerRoot = join(repoRoot, "tools/context-viewer");
const graphPath = join(repoRoot, "docs/sales-agent.graph.yaml");
const port = Number(process.env.CONTEXT_VIEWER_PORT || 4177);
const contentTypes = { ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

const readBody = (request) => new Promise((resolve, reject) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  request.on("error", reject);
});

const sendJson = (response, status, value) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
};

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/api/graph") {
      sendJson(response, 200, parse(await readFile(graphPath, "utf8")));
      return;
    }
    if (request.method === "PUT" && request.url === "/api/graph") {
      const graph = JSON.parse(await readBody(request));
      if (graph?.kind !== "AgentContextGraph" || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
        sendJson(response, 400, { error: "invalid AgentContextGraph" });
        return;
      }
      await writeFile(graphPath, stringify(graph), "utf8");
      sendJson(response, 200, { saved: true, path: graphPath });
      return;
    }
    const requestPath = request.url === "/" ? "/index.html" : request.url?.split("?")[0] || "/index.html";
    const filePath = normalize(join(viewerRoot, requestPath));
    if (!filePath.startsWith(viewerRoot)) { response.writeHead(403); response.end("Forbidden"); return; }
    if (!existsSync(filePath)) { response.writeHead(404); response.end("Not found"); return; }
    response.writeHead(200, { "content-type": contentTypes[extname(filePath)] || "application/octet-stream" });
    const stream = createReadStream(filePath);
    stream.on("error", () => { if (!response.headersSent) response.writeHead(404); response.end("Not found"); });
    stream.pipe(response);
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : "unknown viewer error" });
  }
});

server.listen(port, "127.0.0.1", () => console.log(`Agent Context Graph Viewer: http://127.0.0.1:${port}`));
