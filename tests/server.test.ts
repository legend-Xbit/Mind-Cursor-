import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMindCursorMcpServer } from "../src/mcp/server.ts";
import type { MindCursor, MindCursorOptions, MindRunResult } from "../src/sdk/client.ts";

async function withTempConfig<T>(content: unknown, fn: (configPath: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "mind-cursor-server-"));
  const configPath = join(dir, "mind-cursor.config.json");
  await writeFile(configPath, JSON.stringify(content));
  try {
    return await fn(configPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function connected(env: NodeJS.ProcessEnv, configPath: string, createMindCursor?: (options?: MindCursorOptions) => MindCursor) {
  const server = createMindCursorMcpServer({ env, configPath, createMindCursor });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    async [Symbol.asyncDispose]() {
      await client.close();
      await server.close();
    },
  };
}

function textOf(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  return content[0]!.text;
}

describe("createMindCursorMcpServer", () => {
  it("constructs a disconnected MCP server", () => {
    const server = createMindCursorMcpServer();
    assert.equal(server.isConnected(), false);
  });

  it("advertises all five tools", async () => {
    await withTempConfig({}, async (configPath) => {
      await using ctx = await connected({}, configPath);
      const tools = await ctx.client.listTools();
      assert.deepEqual(
        tools.tools.map((t) => t.name).sort(),
        ["mind_layer_info", "mind_list_tools", "mind_resolve_mcp", "mind_resume_agent", "mind_run_agent"],
      );
    });
  });

  it("mind_layer_info reports version, model, runtime, and catalog counts", async () => {
    await withTempConfig({}, async (configPath) => {
      await using ctx = await connected({ NOTION_API_KEY: "n" }, configPath);
      const result = await ctx.client.callTool({ name: "mind_layer_info", arguments: {} });
      const body = JSON.parse(textOf(result));
      assert.equal(body.name, "mind-cursor");
      assert.equal(body.runtime, "local");
      assert.deepEqual(body.attachedServers, ["notion"]);
      assert.ok(body.presets.includes("notion"));
      assert.ok(body.catalog.ready.includes("notion"));
    });
  });

  it("mind_layer_info fails with a clear message for an unknown profile", async () => {
    await withTempConfig({ profiles: { ci: {} } }, async (configPath) => {
      await using ctx = await connected({}, configPath);
      const result = await ctx.client.callTool({ name: "mind_layer_info", arguments: { profile: "nope" } });
      assert.equal(result.isError, true);
      assert.match(textOf(result), /Unknown profile "nope"/);
    });
  });

  it("mind_list_tools reflects ready / needs_auth / needs_config status", async () => {
    await withTempConfig({}, async (configPath) => {
      await using ctx = await connected({ NOTION_API_KEY: "n" }, configPath);
      const result = await ctx.client.callTool({ name: "mind_list_tools", arguments: {} });
      const tools = JSON.parse(textOf(result));
      const notion = tools.find((t: { id: string }) => t.id === "notion");
      const vercel = tools.find((t: { id: string }) => t.id === "vercel");
      const treg = tools.find((t: { id: string }) => t.id === "treg");
      assert.equal(notion.status, "ready");
      assert.equal(vercel.status, "needs_auth");
      assert.equal(treg.status, "needs_config");
    });
  });

  it("mind_resolve_mcp resolves an http server and strips stdio cwd on cloud", async () => {
    await withTempConfig(
      {
        runtime: "cloud",
        customServers: {
          files: { type: "stdio", command: "npx", args: ["-y", "server"], cwd: "/tmp/workspace" },
        },
      },
      async (configPath) => {
        await using ctx = await connected({ NOTION_API_KEY: "n" }, configPath);
        const result = await ctx.client.callTool({ name: "mind_resolve_mcp", arguments: {} });
        const body = JSON.parse(textOf(result));
        assert.equal(body.runtime, "cloud");
        assert.equal(body.servers.notion.type, "http");
        assert.deepEqual(body.servers.notion.headerKeys, ["Authorization"]);
        assert.equal(body.servers.files.type, "stdio");
        assert.equal(body.servers.files.cwd, undefined);
      },
    );
  });

  it("mind_resolve_mcp includeUnauthenticated attaches a token-less preset", async () => {
    await withTempConfig({}, async (configPath) => {
      await using ctx = await connected({}, configPath);
      const withoutFlag = await ctx.client.callTool({ name: "mind_resolve_mcp", arguments: {} });
      assert.ok(!JSON.parse(textOf(withoutFlag)).servers.notion);

      const withFlag = await ctx.client.callTool({
        name: "mind_resolve_mcp",
        arguments: { includeUnauthenticated: true },
      });
      assert.ok(JSON.parse(textOf(withFlag)).servers.notion);
    });
  });

  it("mind_run_agent rejects a missing prompt and an invalid runtime enum", async () => {
    await withTempConfig({}, async (configPath) => {
      await using ctx = await connected({}, configPath);

      const missingPrompt = await ctx.client.callTool({ name: "mind_run_agent", arguments: { profile: undefined } });
      assert.equal(missingPrompt.isError, true);
      assert.match(textOf(missingPrompt), /prompt/i);

      const badRuntime = await ctx.client.callTool({
        name: "mind_run_agent",
        arguments: { prompt: "hi", runtime: "mars" },
      });
      assert.equal(badRuntime.isError, true);
      assert.match(textOf(badRuntime), /runtime/i);
    });
  });

  it("mind_run_agent surfaces the real CURSOR_API_KEY error as isError, not a crash", async () => {
    await withTempConfig({}, async (configPath) => {
      await using ctx = await connected({}, configPath);
      const result = await ctx.client.callTool({ name: "mind_run_agent", arguments: { prompt: "hi" } });
      assert.equal(result.isError, true);
      assert.match(textOf(result), /CURSOR_API_KEY/);
    });
  });

  it("mind_run_agent refuses to run with untrusted custom servers present", async () => {
    await withTempConfig({ customServers: { exfil: { type: "stdio", command: "sh", args: ["-c", "echo hi"] } } }, async (
      configPath,
    ) => {
      // Discovered, not explicit: simulate by not passing configPath through
      // resolveDeps' explicit slot — instead exercise the same behavior via
      // client.ts, whose own tests cover the trust boundary directly. Here we
      // confirm the server-level short-circuit fires for a fake layer that
      // reports skipped ids, without spending a real agent run.
      const fakeLayer = {
        configPath,
        untrustedCustomServerIds: () => ["exfil"],
        prompt: () => {
          throw new Error("must not run");
        },
        mcpServers: () => ({}),
      } as unknown as MindCursor;
      const fakeCreate = () => fakeLayer;
      const server = createMindCursorMcpServer({ env: {}, configPath, createMindCursor: fakeCreate });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "test", version: "0" });
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const result = await client.callTool({ name: "mind_run_agent", arguments: { prompt: "hi" } });
      assert.equal(result.isError, true);
      assert.match(textOf(result), /untrusted custom servers/);
      assert.match(textOf(result), /exfil/);
      await client.close();
      await server.close();
    });
  });

  it("mind_run_agent and mind_resume_agent report a fake agent's error status as isError", async () => {
    await withTempConfig({}, async (configPath) => {
      let sendArgs: unknown;
      const fakeResult: MindRunResult = { status: "error", agentId: "agent-1", runId: "r1", tools: [] };
      const fakeLayer = {
        configPath,
        untrustedCustomServerIds: () => [],
        mcpServers: () => ({ notion: { type: "http", url: "https://mcp.notion.com/mcp" } }),
        prompt: async () => fakeResult,
        send: async (prompt: string, options: unknown) => {
          sendArgs = { prompt, options };
          return fakeResult;
        },
      } as unknown as MindCursor;
      const fakeCreate = () => fakeLayer;

      const runServer = createMindCursorMcpServer({ env: {}, configPath, createMindCursor: fakeCreate });
      const runPair = InMemoryTransport.createLinkedPair();
      const runClient = new Client({ name: "test", version: "0" });
      await Promise.all([runServer.connect(runPair[1]), runClient.connect(runPair[0])]);
      const runResult = await runClient.callTool({ name: "mind_run_agent", arguments: { prompt: "hi" } });
      assert.equal(runResult.isError, true);
      const runBody = JSON.parse(textOf(runResult));
      assert.deepEqual(runBody.attached, ["notion"]);
      await runClient.close();
      await runServer.close();

      const resumeServer = createMindCursorMcpServer({ env: {}, configPath, createMindCursor: fakeCreate });
      const resumePair = InMemoryTransport.createLinkedPair();
      const resumeClient = new Client({ name: "test", version: "0" });
      await Promise.all([resumeServer.connect(resumePair[1]), resumeClient.connect(resumePair[0])]);
      const resumeResult = await resumeClient.callTool({
        name: "mind_resume_agent",
        arguments: { agentId: "agent-x", prompt: "follow up" },
      });
      assert.equal(resumeResult.isError, true);
      assert.deepEqual(sendArgs, { prompt: "follow up", options: { agentId: "agent-x", stream: false } });
      await resumeClient.close();
      await resumeServer.close();
    });
  });
});
