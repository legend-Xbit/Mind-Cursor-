import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactServer, redactTool, scrubUrl } from "../src/redact.ts";
import type { HttpMcpServerConfig, ResolvedTool, StdioMcpServerConfig } from "../src/types.ts";

describe("scrubUrl", () => {
  it("leaves a plain URL with no query or userinfo untouched", () => {
    assert.equal(scrubUrl("https://mcp.notion.com/mcp"), "https://mcp.notion.com/mcp");
  });

  it("strips userinfo and blanks a non-empty query string", () => {
    assert.equal(
      scrubUrl("https://user:pass@example.com/mcp?token=abc123"),
      "https://example.com/mcp?%3Credacted%3E",
    );
  });

  it("redacts an opaque secret-shaped path segment while keeping route names", () => {
    const scrubbed = scrubUrl("https://treg.example.com/s/sk_live_abc123xyz/mcp");
    assert.equal(scrubbed, "https://treg.example.com/s/%3Credacted%3E/mcp");
  });

  it("returns non-URL strings unchanged instead of throwing", () => {
    assert.equal(scrubUrl("not a url"), "not a url");
  });
});

describe("redactServer", () => {
  it("reduces http headers and CLIENT_SECRET to key names only", () => {
    const server: HttpMcpServerConfig = {
      type: "http",
      url: "https://mcp.notion.com/mcp",
      headers: { Authorization: "Bearer ntn_test" },
      auth: { CLIENT_ID: "fig_id", CLIENT_SECRET: "fig_secret", scopes: ["file_content:read"] },
    };
    const redacted = redactServer(server);
    assert.deepEqual(redacted, {
      type: "http",
      url: "https://mcp.notion.com/mcp",
      headerKeys: ["Authorization"],
      authKeys: ["CLIENT_ID", "CLIENT_SECRET", "scopes"],
      scopes: ["file_content:read"],
    });
    assert.ok(!JSON.stringify(redacted).includes("ntn_test"));
    assert.ok(!JSON.stringify(redacted).includes("fig_secret"));
  });

  it("reduces stdio env to key names and scrubs flag-adjacent and env-equal args", () => {
    const server: StdioMcpServerConfig = {
      type: "stdio",
      command: "npx",
      args: ["-y", "server", "--token", "tok_x", "--path", "aws_x"],
      env: { LEAKED: "aws_x" },
      cwd: "/repo",
    };
    const redacted = redactServer(server);
    assert.deepEqual(redacted, {
      type: "stdio",
      command: "npx",
      args: ["-y", "server", "--token", "<redacted>", "--path", "<redacted>"],
      envKeys: ["LEAKED"],
      cwd: "/repo",
    });
    assert.ok(!JSON.stringify(redacted).includes("tok_x"));
    assert.ok(!JSON.stringify(redacted).includes("aws_x"));
  });
});

describe("redactTool", () => {
  it("redacts the nested server and leaves everything else untouched", () => {
    const tool: ResolvedTool = {
      id: "notion",
      title: "Notion",
      description: "d",
      category: "knowledge",
      status: "ready",
      server: { type: "http", url: "https://mcp.notion.com/mcp", headers: { Authorization: "Bearer ntn_test" } },
    };
    const redacted = redactTool(tool);
    assert.equal(redacted.id, "notion");
    assert.equal(redacted.status, "ready");
    assert.ok(!JSON.stringify(redacted).includes("ntn_test"));
  });

  it("passes a tool with no server through untouched", () => {
    const tool: ResolvedTool = { id: "treg", title: "Treg", description: "d", category: "data", status: "needs_config" };
    assert.deepEqual(redactTool(tool), tool);
  });
});
