import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMindCursorMcpServer } from "../src/mcp/server.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(ROOT, "src/cli.ts");

// Secret values that must never appear verbatim in any redacted output.
const SECRETS = ["ntn_test", "fig_secret", "aws_x", "tok_x", "tok_secret_789", "sk_live_abc123xyz"];

function assertNoSecrets(payload: string): void {
  for (const secret of SECRETS) {
    assert.ok(!payload.includes(secret), `output leaked secret "${secret}": ${payload}`);
  }
}

async function withTempConfig<T>(fn: (configPath: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "mind-cursor-redaction-"));
  const configPath = join(dir, "mind-cursor.config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      customServers: {
        internal: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@acme/mcp-server", "--token", "tok_x"],
          env: { LEAKED: "aws_x" },
        },
      },
    }),
  );
  try {
    return await fn(configPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const SECRET_ENV = {
  NOTION_API_KEY: "ntn_test",
  FIGMA_CLIENT_ID: "fig_id",
  FIGMA_CLIENT_SECRET: "fig_secret",
  TREG_MCP_URL: "https://treg.example.com/s/sk_live_abc123xyz/mcp?token=tok_secret_789",
};

describe("MCP tools never emit secret values", () => {
  it("mind_list_tools, mind_resolve_mcp, and mind_layer_info are all clean", async () => {
    await withTempConfig(async (configPath) => {
      const server = createMindCursorMcpServer({ env: SECRET_ENV, configPath });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "test", version: "0" });
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

      const layerInfo = await client.callTool({ name: "mind_layer_info", arguments: {} });
      assertNoSecrets(JSON.stringify(layerInfo));

      const listTools = await client.callTool({ name: "mind_list_tools", arguments: {} });
      assertNoSecrets(JSON.stringify(listTools));
      const listText = (listTools.content as Array<{ text: string }>)[0]!.text;
      assert.ok(listText.includes("\"headerKeys\""), "expected header key names, not header values");
      assert.ok(!listText.includes("\"headers\""), "raw headers field must not be present");

      const resolveMcp = await client.callTool({ name: "mind_resolve_mcp", arguments: {} });
      assertNoSecrets(JSON.stringify(resolveMcp));
      const resolveText = (resolveMcp.content as Array<{ text: string }>)[0]!.text;
      // internal is trusted here (configPath was passed explicitly), so it must
      // actually be attached — with its secrets reduced to key names.
      assert.ok(resolveText.includes("\"internal\""));
      assert.ok(resolveText.includes("\"envKeys\""));

      await client.close();
      await server.close();
    });
  });
});

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [join(ROOT, "node_modules/tsx/dist/cli.mjs"), CLI, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...SECRET_ENV },
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("CLI output is redacted by default", () => {
  it("list --json never prints the raw token", () => {
    const result = runCli(["list", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assertNoSecrets(result.stdout);
    assert.ok(result.stdout.includes("headerKeys"));
  });

  it("resolve never prints the raw token, and --reveal-secrets does (with a warning)", () => {
    const redacted = runCli(["resolve"]);
    assert.equal(redacted.status, 0, redacted.stderr);
    assertNoSecrets(redacted.stdout);

    const revealed = runCli(["resolve", "--reveal-secrets"]);
    assert.equal(revealed.status, 0, revealed.stderr);
    assert.ok(revealed.stdout.includes("ntn_test"));
    assert.match(revealed.stderr, /reveal-secrets/);
  });
});
