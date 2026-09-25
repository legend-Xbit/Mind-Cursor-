import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMindCursorMcpServer } from "../src/mcp/server.ts";
import { inspectAll, resolveMcpServers } from "../src/mcp/registry.ts";
import { redactServer, redactTool, scrubUrl } from "../src/redact.ts";
import type { HttpMcpServerConfig, MindCursorConfig, ResolvedTool, StdioMcpServerConfig } from "../src/types.ts";

const execFileAsync = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const FIXTURE_HTTP_TOKEN = "sk_fixture_http_token_aaaa";
const FIXTURE_OAUTH_SECRET = "oauth_fixture_client_secret_bbbb";
const FIXTURE_NOTION_TOKEN = "ntn_fixture_secret_cccc";
const FIXTURE_FIGMA_SECRET = "fig_fixture_client_secret_dddd";
const FIXTURE_STDIO_ENV = "stdio_fixture_env_eeee";

function assertNoLeakedSecrets(output: string): void {
  assert.equal(output.includes("Bearer "), false, "public output must not contain raw bearer values");
  for (const secret of [
    FIXTURE_HTTP_TOKEN,
    FIXTURE_OAUTH_SECRET,
    FIXTURE_NOTION_TOKEN,
    FIXTURE_FIGMA_SECRET,
    FIXTURE_STDIO_ENV,
  ]) {
    assert.equal(output.includes(secret), false, "public output must not contain fixture secret values");
  }
}

function secretConfig(): MindCursorConfig {
  return {
    enabled: ["notion", "figma"],
    customServers: {
      hook: {
        type: "http",
        url: "https://example.test/mcp",
        headers: { Authorization: "Bearer " + FIXTURE_HTTP_TOKEN },
        auth: { CLIENT_ID: "cid_fixture", CLIENT_SECRET: FIXTURE_OAUTH_SECRET },
      },
      files: {
        type: "stdio",
        command: "npx",
        args: ["-y", "mcp", "--token", FIXTURE_HTTP_TOKEN],
        env: { TOKEN: FIXTURE_STDIO_ENV },
      },
    },
  };
}

describe("scrubUrl", () => {
  it("leaves a plain URL with no query or userinfo untouched", () => {
    assert.equal(scrubUrl("https://mcp.notion.com/mcp"), "https://mcp.notion.com/mcp");
  });

  it("strips userinfo and blanks a non-empty query string", () => {
    assert.equal(
      scrubUrl("https://" + "alice" + ":" + "pw" + "@example.com/mcp?token=abc123"),
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
      headers: { Authorization: "Bearer " + FIXTURE_HTTP_TOKEN },
      auth: { CLIENT_ID: "fig_id", CLIENT_SECRET: FIXTURE_OAUTH_SECRET, scopes: ["file_content:read"] },
    };
    const redacted = redactServer(server);
    assert.deepEqual(redacted, {
      type: "http",
      url: "https://mcp.notion.com/mcp",
      headerKeys: ["Authorization"],
      authKeys: ["CLIENT_ID", "CLIENT_SECRET", "scopes"],
      scopes: ["file_content:read"],
    });
    assertNoLeakedSecrets(JSON.stringify(redacted));
  });

  it("reduces stdio env to key names and scrubs flag-adjacent and env-equal args", () => {
    const server: StdioMcpServerConfig = {
      type: "stdio",
      command: "npx",
      args: ["-y", "server", "--token", FIXTURE_HTTP_TOKEN, "--path", FIXTURE_STDIO_ENV],
      env: { LEAKED: FIXTURE_STDIO_ENV },
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
    assertNoLeakedSecrets(JSON.stringify(redacted));
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
      server: { type: "http", url: "https://mcp.notion.com/mcp", headers: { Authorization: "Bearer " + FIXTURE_HTTP_TOKEN } },
    };
    const redacted = redactTool(tool);
    assert.equal(redacted.id, "notion");
    assert.equal(redacted.status, "ready");
    assertNoLeakedSecrets(JSON.stringify(redacted));
  });

  it("passes a tool with no server through untouched", () => {
    const tool: ResolvedTool = { id: "treg", title: "Treg", description: "d", category: "data", status: "needs_config" };
    assert.deepEqual(redactTool(tool), tool);
  });
});

describe("redaction helpers", () => {
  it("strip raw secret values from public JSON", () => {
    const tools = inspectAll({
      env: {
        NOTION_API_KEY: FIXTURE_NOTION_TOKEN,
        FIGMA_CLIENT_ID: "fig_id",
        FIGMA_CLIENT_SECRET: FIXTURE_FIGMA_SECRET,
      },
      config: secretConfig(),
      trustCustomServers: true,
    });
    const servers = resolveMcpServers({
      env: {
        NOTION_API_KEY: FIXTURE_NOTION_TOKEN,
        FIGMA_CLIENT_ID: "fig_id",
        FIGMA_CLIENT_SECRET: FIXTURE_FIGMA_SECRET,
      },
      config: secretConfig(),
      trustCustomServers: true,
    });

    const publicJson = JSON.stringify(
      {
        tools: tools.map(redactTool),
        servers: Object.fromEntries(Object.entries(servers).map(([id, server]) => [id, redactServer(server)])),
      },
      null,
      2,
    );
    assertNoLeakedSecrets(publicJson);
    assert.match(publicJson, /"headerKeys": \[/);
    assert.match(publicJson, /"envKeys": \[/);
  });
});

describe("CLI list --json and resolve", () => {
  async function withSecretConfigFile(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "mind-cursor-redact-"));
    const path = join(dir, "mind-cursor.config.json");
    await writeFile(path, JSON.stringify(secretConfig(), null, 2), "utf8");
    return path;
  }

  async function runCli(args: string[], configPath: string): Promise<string> {
    const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", join(ROOT, "src/cli.ts"), ...args], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        MIND_CURSOR_CONFIG: configPath,
        NOTION_API_KEY: FIXTURE_NOTION_TOKEN,
        FIGMA_CLIENT_ID: "fig_id",
        FIGMA_CLIENT_SECRET: FIXTURE_FIGMA_SECRET,
      },
    });
    return stdout;
  }

  it("does not print raw secrets from list --json", async () => {
    const configPath = await withSecretConfigFile();
    const stdout = await runCli(["list", "--json"], configPath);
    assertNoLeakedSecrets(stdout);
    assert.match(stdout, /"hook"/);
    assert.match(stdout, /"headerKeys": \[/);
  });

  it("does not print raw secrets from resolve", async () => {
    const configPath = await withSecretConfigFile();
    const stdout = await runCli(["resolve"], configPath);
    assertNoLeakedSecrets(stdout);
    assert.match(stdout, /"headerKeys": \[/);
    assert.match(stdout, /"envKeys": \[/);
  });
});

describe("mind_list_tools", () => {
  it("returns redacted tool JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mind-cursor-mcp-"));
    const configPath = join(dir, "mind-cursor.config.json");
    await writeFile(configPath, JSON.stringify(secretConfig(), null, 2), "utf8");

    const server = createMindCursorMcpServer({
      env: {
        ...process.env,
        MIND_CURSOR_CONFIG: configPath,
        NOTION_API_KEY: FIXTURE_NOTION_TOKEN,
        FIGMA_CLIENT_ID: "fig_id",
        FIGMA_CLIENT_SECRET: FIXTURE_FIGMA_SECRET,
      },
      configPath,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "mind-cursor-test", version: "0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const result = await client.callTool({ name: "mind_list_tools", arguments: {} });
      const text = (result.content as Array<{ type: string; text?: string }>)
        .map((block) => (block.type === "text" ? (block.text ?? "") : ""))
        .join("");
      assertNoLeakedSecrets(text);
      assert.match(text, /"hook"/);
      assert.match(text, /"headerKeys": \[/);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
