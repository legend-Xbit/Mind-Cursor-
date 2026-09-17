import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { Agent, type AgentOptions } from "@cursor/sdk";
import { createMindCursor } from "../src/sdk/client.ts";

const FIXTURE_NOTION_TOKEN = "ntn_fixture_send_token_ffff";
const FIXTURE_FIGMA_SECRET = "fig_fixture_send_secret_gggg";

function fakeAgent(agentId: string) {
  return {
    agentId,
    send: async () => ({
      id: "run-test",
      async *stream() {},
      wait: async () => ({ status: "finished", result: "ok" }),
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
    assert.ok(result.tools.some((tool) => tool.id === "notion" && tool.status === "ready"));
  });

  it("passes mcpServers to Agent.resume", async () => {
    const result = await layer().send("follow up", { agentId: "agent-99", stream: false });
    assert.equal(resumeMock.mock.callCount(), 1);
    assert.equal(createMock.mock.callCount(), 0);
    assert.equal(lastResume?.agentId, "agent-99");
    assert.ok(lastResume?.options?.mcpServers);
    assert.ok(lastResume.options.mcpServers.notion);
    assertNoLeakedSecrets(JSON.stringify(result));
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
