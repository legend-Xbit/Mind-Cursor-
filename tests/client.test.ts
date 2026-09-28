import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { Agent, type AgentOptions } from "@cursor/sdk";
import { createMindCursor } from "../src/sdk/client.ts";
import { EXIT_OK, EXIT_RUN_FAILED, exitCodeForRunStatus } from "../src/sdk/errors.ts";

const FIXTURE_NOTION_TOKEN = "ntn_fixture_send_token_ffff";
const FIXTURE_FIGMA_SECRET = "fig_fixture_send_secret_gggg";

function fakeAgent(agentId: string, waitResult: { status: string; result?: unknown; error?: { message: string; code?: string } } = { status: "finished", result: "ok" }) {
  return {
    agentId,
    send: async () => ({
      id: "run-test",
      async *stream() {},
      wait: async () => waitResult,
    }),
    async [Symbol.asyncDispose]() {},
  };
}

function assertNoLeakedSecrets(output: string): void {
  assert.equal(output.includes("Bearer "), false, "send result must not contain Bearer credentials");
  assert.equal(output.includes(FIXTURE_NOTION_TOKEN), false, "send result must not contain fixture tokens");
  assert.equal(output.includes(FIXTURE_FIGMA_SECRET), false, "send result must not contain fixture OAuth secrets");
}

describe("MindCursor.send contracts", () => {
  let lastCreate: AgentOptions | undefined;
  let lastResume: { agentId: string; options: Partial<AgentOptions> | undefined } | undefined;
  let createMock: ReturnType<typeof mock.method>;
  let resumeMock: ReturnType<typeof mock.method>;

  beforeEach(() => {
    lastCreate = undefined;
    lastResume = undefined;
    createMock = mock.method(Agent, "create", async (options: AgentOptions) => {
      lastCreate = options;
      return fakeAgent("agent-created");
    });
    resumeMock = mock.method(Agent, "resume", async (agentId: string, options?: Partial<AgentOptions>) => {
      lastResume = { agentId, options };
      return fakeAgent(agentId);
    });
  });

  afterEach(() => {
    createMock.mock.restore();
    resumeMock.mock.restore();
  });

  function layer() {
    return createMindCursor({
      apiKey: "cursor_test_key",
      runtime: "local",
      config: {},
      env: {
        CURSOR_API_KEY: "cursor_test_key",
        NOTION_API_KEY: FIXTURE_NOTION_TOKEN,
        FIGMA_CLIENT_ID: "fig_id",
        FIGMA_CLIENT_SECRET: FIXTURE_FIGMA_SECRET,
      },
    });
  }

  it("passes mcpServers to Agent.create and returns redacted tools", async () => {
    const result = await layer().send("hello", { stream: false });
    assert.equal(createMock.mock.callCount(), 1);
    assert.equal(resumeMock.mock.callCount(), 0);
    assert.ok(lastCreate?.mcpServers);
    assert.ok(lastCreate.mcpServers.notion);
    assert.ok(lastCreate.mcpServers.figma);
    assert.equal("headers" in lastCreate.mcpServers.notion, true);
    assertNoLeakedSecrets(JSON.stringify(result));
    const notion = result.tools.find((tool) => tool.id === "notion" && tool.status === "ready");
    assert.ok(notion);
    assert.equal(notion.server && "url" in notion.server && notion.server.url, "[redacted]");
    assert.equal(notion.server && "hasHeaders" in notion.server && notion.server.hasHeaders, true);
  });

  it("passes mcpServers to Agent.resume", async () => {
    const result = await layer().send("follow up", { agentId: "agent-99", stream: false });
    assert.equal(resumeMock.mock.callCount(), 1);
    assert.equal(createMock.mock.callCount(), 0);
    assert.equal(lastResume?.agentId, "agent-99");
    assert.ok(lastResume?.options?.mcpServers);
    assert.ok(lastResume.options.mcpServers.notion);
    assert.deepEqual(lastResume.options.local, { cwd: layer().cwd });
    assert.equal(lastResume.options.cloud, undefined);
    assertNoLeakedSecrets(JSON.stringify(result));
  });

  it("infers cloud resume options from a bc- agent id without requiring repos", async () => {
    const cloud = createMindCursor({
      apiKey: "cursor_test_key",
      config: {},
      env: { CURSOR_API_KEY: "cursor_test_key" },
    });
    const result = await cloud.send("follow up", { agentId: "bc-99", stream: false });
    assert.equal(resumeMock.mock.callCount(), 1);
    assert.equal(createMock.mock.callCount(), 0);
    assert.equal(lastResume?.agentId, "bc-99");
    assert.ok(lastResume?.options?.mcpServers);
    assert.deepEqual(lastResume?.options?.cloud, {});
    assert.equal(lastResume?.options?.local, undefined);
    assert.equal(result.status, "finished");
  });

  it("forwards wait() error details and cancelled status", async () => {
    createMock.mock.restore();
    createMock = mock.method(Agent, "create", async (options: AgentOptions) => {
      lastCreate = options;
      return fakeAgent("agent-created", {
        status: "error",
        error: { message: "model overloaded", code: "unavailable" },
      });
    });
    const result = await layer().send("hello", { stream: false });
    assert.equal(result.status, "error");
    assert.deepEqual(result.error, { message: "model overloaded", code: "unavailable" });
    assert.equal(exitCodeForRunStatus(result.status), EXIT_RUN_FAILED);
  });

  it("treats cancelled runs as failures", async () => {
    createMock.mock.restore();
    createMock = mock.method(Agent, "create", async (options: AgentOptions) => {
      lastCreate = options;
      return fakeAgent("agent-created", { status: "cancelled" });
    });
    const result = await layer().send("hello", { stream: false });
    assert.equal(result.status, "cancelled");
    assert.equal(exitCodeForRunStatus(result.status), EXIT_RUN_FAILED);
    assert.equal(exitCodeForRunStatus("finished"), EXIT_OK);
  });

  it("fails startup when cloud runtime has no repos", async () => {
    const cloud = createMindCursor({
      apiKey: "cursor_test_key",
      runtime: "cloud",
      config: {},
      env: { CURSOR_API_KEY: "cursor_test_key" },
    });
    await assert.rejects(
      () => cloud.send("no repo", { stream: false }),
      /Cloud runtime requires at least one repo/,
    );
    assert.equal(createMock.mock.callCount(), 0);
    assert.equal(resumeMock.mock.callCount(), 0);
  });

  it("allows inspect-only use without CURSOR_API_KEY", () => {
    const inspect = createMindCursor({ config: {}, env: {} });
    assert.equal(inspect.apiKey, undefined);
    assert.ok(Array.isArray(inspect.tools()));
    assert.equal(typeof inspect.mcpServers(), "object");
  });

  it("still requires CURSOR_API_KEY on send", async () => {
    const inspect = createMindCursor({ config: {}, env: {}, runtime: "local" });
    await assert.rejects(() => inspect.send("hi", { stream: false }), /CURSOR_API_KEY is required/);
    assert.equal(createMock.mock.callCount(), 0);
  });
});

describe("MindCursor cwd and untrusted custom servers", () => {
  it("resolves an explicit relative cwd against the caller, and local.cwd against the config file", async () => {
    const root = await mkdtemp(join(tmpdir(), "mind-cursor-cwd-"));
    const configDir = join(root, "configs");
    const caller = join(root, "caller");
    await mkdir(configDir, { recursive: true });
    await mkdir(caller, { recursive: true });
    const configPath = join(configDir, "mind-cursor.config.json");
    await writeFile(configPath, JSON.stringify({ local: { cwd: "from-config" } }));
    const previous = process.cwd();
    process.chdir(caller);
    try {
      const explicit = createMindCursor({ configPath, cwd: "relative-work", env: {} });
      assert.equal(explicit.cwd, resolve(caller, "relative-work"));
      const fromFile = createMindCursor({ configPath, env: {} });
      assert.equal(fromFile.cwd, resolve(configDir, "from-config"));
      const absolute = createMindCursor({ configPath, cwd: caller, env: {} });
      assert.equal(absolute.cwd, caller);
    } finally {
      process.chdir(previous);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not count a disabled custom server as untrusted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mind-cursor-untrusted-"));
    await writeFile(
      join(dir, "mind-cursor.config.json"),
      JSON.stringify({
        disabled: ["exfil"],
        customServers: {
          exfil: { type: "stdio", command: "sh", args: ["-c", "echo hi"] },
          live: { type: "stdio", command: "npx", args: ["-y", "mcp"] },
        },
      }),
    );
    const previous = process.cwd();
    const previousConfig = process.env.MIND_CURSOR_CONFIG;
    delete process.env.MIND_CURSOR_CONFIG;
    process.chdir(dir);
    try {
      const layer = createMindCursor({ env: {}, trustConfig: false });
      assert.deepEqual(layer.untrustedCustomServerIds(), ["live"]);

      await writeFile(
        join(dir, "mind-cursor.config.json"),
        JSON.stringify({
          disabled: ["exfil"],
          customServers: {
            exfil: { type: "stdio", command: "sh", args: ["-c", "echo hi"] },
          },
        }),
      );
      const onlyDisabled = createMindCursor({ env: {}, trustConfig: false });
      assert.deepEqual(onlyDisabled.untrustedCustomServerIds(), []);
    } finally {
      process.chdir(previous);
      if (previousConfig === undefined) {
        delete process.env.MIND_CURSOR_CONFIG;
      } else {
        process.env.MIND_CURSOR_CONFIG = previousConfig;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });
});
