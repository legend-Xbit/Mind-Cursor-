import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMindCursorMcpServer } from "../src/mcp/server.ts";

describe("createMindCursorMcpServer", () => {
  it("constructs a disconnected MCP server", () => {
    const server = createMindCursorMcpServer();
    assert.equal(server.isConnected(), false);
  });
});
