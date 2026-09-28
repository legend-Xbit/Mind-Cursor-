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
import { redactMcpServer, redactMcpServers, toPublicTools } from "../src/mcp/redact.ts";
import { inspectAll, resolveMcpServers } from "../src/mcp/registry.ts";
import type { MindCursorConfig } from "../src/types.ts";

const execFileAsync = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const FIXTURE_HTTP_TOKEN = "sk_fixture_http_token_aaaa";
const FIXTURE_OAUTH_SECRET = "oauth_fixture_client_secret_bbbb";
const FIXTURE_NOTION_TOKEN = "ntn_fixture_secret_cccc";
const FIXTURE_FIGMA_SECRET = "fig_fixture_client_secret_dddd";
const FIXTURE_STDIO_ENV = "stdio_fixture_env_eeee";
const FIXTURE_STDIO_COMMAND = "stdio_fixture_command_ffff";
const FIXTURE_INLINE_TOKEN = "tok_inline_secret_gggg";
const FIXTURE_API_KEY = "api_key_secret_hhhh";
const FIXTURE_PUNCT_PATH = "token=sk_live_punct_iiii";

function assertNoLeakedSecrets(output: string): void {
  assert.equal(output.includes("Bearer "), false, "public output must not contain Bearer credentials");
  for (const secret of [
    FIXTURE_HTTP_TOKEN,
    FIXTURE_OAUTH_SECRET,
    FIXTURE_NOTION_TOKEN,
    FIXTURE_FIGMA_SECRET,
    FIXTURE_STDIO_ENV,
    FIXTURE_STDIO_COMMAND,
    FIXTURE_INLINE_TOKEN,
    FIXTURE_API_KEY,
    FIXTURE_PUNCT_PATH,
    "sk_live_punct_iiii",
  ]) {
    assert.equal(output.includes(secret), false, `public output must not contain fixture secret ${secret}`);
  }
}

function secretConfig(): MindCursorConfig {
  return {
    enabled: ["notion", "figma"],
    customServers: {
      hook: {
        type: "http",
        url: `https://user:${FIXTURE_OAUTH_SECRET}@example.test/api/${FIXTURE_PUNCT_PATH}?key=${FIXTURE_HTTP_TOKEN}`,
        headers: { Authorization: `Bearer ${FIXTURE_HTTP_TOKEN}` },
        auth: { CLIENT_ID: "cid_fixture", CLIENT_SECRET: FIXTURE_OAUTH_SECRET },
      },
      files: {
        type: "stdio",
        command: `/tmp/${FIXTURE_STDIO_COMMAND}/npx`,
        args: [
          "-y",
          "mcp",
          `--token=${FIXTURE_INLINE_TOKEN}`,
          `--api_key=${FIXTURE_API_KEY}`,
          "--api-key",
          FIXTURE_API_KEY,
          "--api_key",
          FIXTURE_STDIO_ENV,
        ],
        env: { TOKEN: FIXTURE_STDIO_ENV },
      },
    },
  };
}

const SECRET_ENV = {
  NOTION_API_KEY: FIXTURE_NOTION_TOKEN,
  FIGMA_CLIENT_ID: "fig_id",
  FIGMA_CLIENT_SECRET: FIXTURE_FIGMA_SECRET,
};

describe("redact helpers", () => {
  it("redacts inline secret flags and punctuated URL path segments entirely", () => {
    const http = redactMcpServer({
      type: "http",
      url: `https://example.test/api/${FIXTURE_PUNCT_PATH}`,
      headers: { Authorization: `Bearer ${FIXTURE_HTTP_TOKEN}` },
    });
    if (!("url" in http)) {
      throw new Error("expected an http redaction");
    }
    assert.equal(http.url, "[redacted]");
    assert.equal(http.hasHeaders, true);

    const stdio = redactMcpServer({
      type: "stdio",
      command: `/tmp/${FIXTURE_STDIO_COMMAND}/npx`,
      args: [`--token=${FIXTURE_INLINE_TOKEN}`, `--api_key=${FIXTURE_API_KEY}`, "--api-key", FIXTURE_API_KEY],
      env: { TOKEN: FIXTURE_STDIO_ENV },
    });
    if (!("command" in stdio)) {
      throw new Error("expected a stdio redaction");
    }
    assert.equal(stdio.command, "[redacted]");
    assert.deepEqual(stdio.args, ["[redacted]", "[redacted]", "[redacted]", "[redacted]"]);
    assert.equal(stdio.hasEnv, true);
    assertNoLeakedSecrets(JSON.stringify({ http, stdio }));
  });

  it("strips credentials from all MCP connection fields in public JSON", () => {
    const tools = inspectAll({
      env: SECRET_ENV,
      config: secretConfig(),
      trustCustomServers: true,
    });
    const servers = resolveMcpServers({
      env: SECRET_ENV,
      config: secretConfig(),
      trustCustomServers: true,
    });

    const publicTools = toPublicTools(tools);
    const publicServers = redactMcpServers(servers);
    const publicJson = JSON.stringify({ tools: publicTools, servers: publicServers }, null, 2);
    assert.ok(servers.hook && "url" in servers.hook);
    assert.match(servers.hook.url, /sk_fixture_http_token_aaaa/);
    assert.match(servers.hook.url, /token=sk_live_punct_iiii/);
    assert.ok(servers.files && "command" in servers.files);
    assert.match(servers.files.command, /stdio_fixture_command_ffff/);
    assert.match(servers.files.args?.join(" ") ?? "", /--token=tok_inline_secret_gggg/);
    assert.match(servers.files.args?.join(" ") ?? "", /--api_key=api_key_secret_hhhh/);
    assert.equal(publicServers.hook && "url" in publicServers.hook && publicServers.hook.url, "[redacted]");
    assert.equal(publicServers.files && "command" in publicServers.files && publicServers.files.command, "[redacted]");
    assert.ok(publicServers.files && "args" in publicServers.files && publicServers.files.args?.every((arg) => arg === "[redacted]"));
    assertNoLeakedSecrets(publicJson);
    assert.match(publicJson, /"hasHeaders": true/);
    assert.match(publicJson, /"hasAuth": true/);
    assert.match(publicJson, /"hasEnv": true/);
  });

  it("redacts secrets expanded from environment variables in URLs and stdio commands", () => {
    const config = {
      customServers: {
        hook: { type: "http" as const, url: "https://example.test/mcp/${MCP_URL_SECRET}" },
        files: {
          type: "stdio" as const,
          command: "${MCP_COMMAND_SECRET}",
          args: ["--token=${MCP_ARG_SECRET}", "--api_key=${MCP_ARG_SECRET}"],
        },
      },
    };
    const env = {
      MCP_URL_SECRET: FIXTURE_HTTP_TOKEN,
      MCP_COMMAND_SECRET: FIXTURE_STDIO_COMMAND,
      MCP_ARG_SECRET: FIXTURE_STDIO_ENV,
    };
    const tools = inspectAll({ config, env, trustCustomServers: true });
    const servers = resolveMcpServers({ config, env, trustCustomServers: true });
    assert.ok(servers.hook && "url" in servers.hook);
    assert.equal(servers.hook.url, `https://example.test/mcp/${FIXTURE_HTTP_TOKEN}`);
    assert.ok(servers.files && "command" in servers.files);
    assert.equal(servers.files.command, FIXTURE_STDIO_COMMAND);
    assert.equal(servers.files.args?.[0], `--token=${FIXTURE_STDIO_ENV}`);
    assertNoLeakedSecrets(JSON.stringify({ tools: toPublicTools(tools), servers: redactMcpServers(servers) }));
  });
});

describe("CLI list --json and resolve", () => {
  async function withSecretConfigFile(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "mind-cursor-redact-"));
    const path = join(dir, "mind-cursor.config.json");
    await writeFile(path, JSON.stringify(secretConfig(), null, 2), "utf8");
    return path;
  }

  async function runCli(
    args: string[],
    configPath: string,
  ): Promise<{ stdout: string; stderr: string }> {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", join(ROOT, "src/cli.ts"), ...args],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          MIND_CURSOR_CONFIG: configPath,
          ...SECRET_ENV,
        },
      },
    );
    return { stdout, stderr };
  }

  it("does not print Bearer or OAuth secrets from list --json", async () => {
    const configPath = await withSecretConfigFile();
    const { stdout } = await runCli(["list", "--json"], configPath);
    const servers = resolveMcpServers({
      env: { ...process.env, ...SECRET_ENV },
      config: secretConfig(),
      trustCustomServers: true,
    });
    const expected = toPublicTools(
      inspectAll({
        env: { ...process.env, ...SECRET_ENV },
        config: secretConfig(),
        trustCustomServers: true,
      }),
    );
    const parsed = JSON.parse(stdout) as { tools: unknown };
    assert.deepEqual(parsed.tools, JSON.parse(JSON.stringify(expected)));
    assert.equal(JSON.stringify(redactMcpServers(servers)).includes(FIXTURE_INLINE_TOKEN), false);
    assertNoLeakedSecrets(stdout);
    assert.match(stdout, /"hook"/);
    assert.match(stdout, /\[redacted\]/);
  });

  it("does not print Bearer or OAuth secrets from resolve, matching redactMcpServers", async () => {
    const configPath = await withSecretConfigFile();
    const { stdout } = await runCli(["resolve"], configPath);
    const expected = redactMcpServers(
      resolveMcpServers({
        env: { ...process.env, ...SECRET_ENV },
        config: secretConfig(),
        trustCustomServers: true,
      }),
    );
    const parsed = JSON.parse(stdout) as { servers: unknown };
    assert.deepEqual(parsed.servers, JSON.parse(JSON.stringify(expected)));
    assertNoLeakedSecrets(stdout);
    assert.match(stdout, /"hasHeaders": true/);
    assert.match(stdout, /"hasEnv": true/);
  });

  it("list --json --reveal-secrets warns on stderr before printing raw values", async () => {
    const configPath = await withSecretConfigFile();
    const revealed = await runCli(["list", "--json", "--reveal-secrets"], configPath);
    assert.match(revealed.stderr, /warning: printing raw tokens and headers \(--reveal-secrets\)/);
    assert.match(revealed.stdout, new RegExp(FIXTURE_INLINE_TOKEN));
    assert.match(revealed.stdout, new RegExp(FIXTURE_PUNCT_PATH));

    const resolved = await runCli(["resolve", "--reveal-secrets"], configPath);
    assert.match(resolved.stderr, /warning: printing raw tokens and headers \(--reveal-secrets\)/);
    assert.match(resolved.stdout, new RegExp(FIXTURE_API_KEY));
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
        ...SECRET_ENV,
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
      const expected = toPublicTools(
        inspectAll({
          env: { ...process.env, ...SECRET_ENV },
          config: secretConfig(),
          trustCustomServers: true,
          configPath,
        }),
      );
      assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(expected)));
      assertNoLeakedSecrets(text);
      assert.match(text, /"hook"/);
      assert.match(text, /\[redacted\]/);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
