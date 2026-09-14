import { createMindCursor } from "../src/index.ts";

const layer = createMindCursor({ runtime: "local" });
console.error("attached MCP servers:", Object.keys(layer.mcpServers()));

const result = await layer.send("Summarize this repository and list the MCP tools you can reach.");
if (result.status === "error") {
  process.exitCode = 2;
}
