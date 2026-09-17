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
import { redactMcpServers, toPublicTools } from "../src/mcp/redact.ts";
import { inspectAll, resolveMcpServers } from "../src/mcp/registry.ts";

const execFileAsync = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const FIXTURE_HTTP_TOKEN = "sk_fixture_http_token_aaaa";
const FIXTURE_OAUTH_SECRET = "oauth_fixture_client_secret_bbbb";
const FIXTURE_NOTION_TOKEN = "ntn_fixture_secret_cccc";
const FIXTURE_FIGMA_SECRET = "fig_fixture_client_secret_dddd";
const FIXTURE_STDIO_ENV = "stdio_fixture_env_eeee";

function assertNoLeakedSecrets(output: string): void {
  assert.equal(output.includes("Bearer "), false, "public output must not contain Bearer credentials");
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

function secretConfig() {
  return {
    enabled: ["notion", "figma"],
    customServers: {
      hook: {
        type: "http",
        url: "https://example.test/mcp",
        headers: { Authorization: `Bearer ${FIXTURE_HTTP_TOKEN}` },
        auth: { CLIENT_ID: "cid_fixture", CLIENT_SECRET: FIXTURE_OAUTH_SECRET },
      },
      files: {
        type: "stdio",
        command: "npx",
        args: ["-y", "mcp"],
        env: { TOKEN: FIXTURE_STDIO_ENV },
      },
    },
  };
}

describe("redact helpers", () => {
  it("strips Authorization and CLIENT_SECRET from public JSON", () => {
    const tools = inspectAll({
      env: {
        NOTION_API_KEY: FIXTURE_NOTION_TOKEN,
        FIGMA_CLIENT_ID: "fig_id",
        FIGMA_CLIENT_SECRET: FIXTURE_FIGMA_SECRET,
      },
      config: secretConfig(),
    });
    const servers = resolveMcpServers({
      env: {
        NOTION_API_KEY: FIXTURE_NOTION_TOKEN,
        FIGMA_CLIENT_ID: "fig_id",
        FIGMA_CLIENT_SECRET: FIXTURE_FIGMA_SECRET,
      },
      config: secretConfig(),
    });

    const publicJson = JSON.stringify(
      { tools: toPublicTools(tools), servers: redactMcpServers(servers) },
      null,
      2,
    );
    assertNoLeakedSecrets(publicJson);
    assert.match(publicJson, /"hasHeaders": true/);
    assert.match(publicJson, /"hasAuth": true/);
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

  it("does not print Bearer or OAuth secrets from list --json", async () => {
    const configPath = await withSecretConfigFile();
    const stdout = await runCli(["list", "--json"], configPath);
    assertNoLeakedSecrets(stdout);
    assert.match(stdout, /"hook"/);
  });

  it("does not print Bearer or OAuth secrets from resolve", async () => {
    const configPath = await withSecretConfigFile();
    const stdout = await runCli(["resolve"], configPath);
    assertNoLeakedSecrets(stdout);
    assert.match(stdout, /"hasHeaders": true/);
  });
});

describe("mind_list_tools", () => {
  it("returns redacted tool JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mind-cursor-mcp-"));
    const configPath = join(dir, "mind-cursor.config.json");
    await writeFile(configPath, JSON.stringify(secretConfig(), null, 2), "utf8");

    const previousConfig = process.env.MIND_CURSOR_CONFIG;
    const previousNotion = process.env.NOTION_API_KEY;
    const previousFigmaId = process.env.FIGMA_CLIENT_ID;
    const previousFigmaSecret = process.env.FIGMA_CLIENT_SECRET;
    process.env.MIND_CURSOR_CONFIG = configPath;
    process.env.NOTION_API_KEY = FIXTURE_NOTION_TOKEN;
    process.env.FIGMA_CLIENT_ID = "fig_id";
    process.env.FIGMA_CLIENT_SECRET = FIXTURE_FIGMA_SECRET;

    const server = createMindCursorMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "mind-cursor-test", version: "0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const result = await client.callTool({ name: "mind_list_tools", arguments: {} });
      const text = result.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("");
      assertNoLeakedSecrets(text);
      assert.match(text, /"hook"/);
    } finally {
      await client.close();
      await server.close();
      if (previousConfig === undefined) {
        delete process.env.MIND_CURSOR_CONFIG;
      } else {
        process.env.MIND_CURSOR_CONFIG = previousConfig;
      }
      if (previousNotion === undefined) {
        delete process.env.NOTION_API_KEY;
      } else {
        process.env.NOTION_API_KEY = previousNotion;
      }
      if (previousFigmaId === undefined) {
        delete process.env.FIGMA_CLIENT_ID;
      } else {
        process.env.FIGMA_CLIENT_ID = previousFigmaId;
      }
      if (previousFigmaSecret === undefined) {
        delete process.env.FIGMA_CLIENT_SECRET;
      } else {
        process.env.FIGMA_CLIENT_SECRET = previousFigmaSecret;
      }
    }
  });
});
