import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyProfile,
  interpolateEnv,
  interpolateUnknown,
  mergeConfig,
  resolveModel,
  resolveRuntime,
} from "../src/config.ts";
import type { HttpMcpServerConfig } from "../src/types.ts";

function asHttp(server: unknown): HttpMcpServerConfig {
  assert.ok(server && typeof server === "object" && "url" in server, "expected an http/sse server config");
  return server as HttpMcpServerConfig;
}

describe("interpolateEnv", () => {
  it("replaces ${NAME} from the provided env", () => {
    assert.equal(interpolateEnv("Bearer ${TOKEN}", { TOKEN: "abc" }), "Bearer abc");
    assert.equal(interpolateEnv("${MISSING}", {}), "");
  });

  it("walks nested objects", () => {
    const out = interpolateUnknown(
      { headers: { Authorization: "Bearer ${KEY}" }, list: ["${KEY}"] },
      { KEY: "k" },
    );
    assert.deepEqual(out, { headers: { Authorization: "Bearer k" }, list: ["k"] });
  });
});

describe("profiles", () => {
  it("merges a named profile over the base config", () => {
    const merged = applyProfile(
      {
        model: "composer-2.5",
        runtime: "local",
        profiles: {
          "cloud-pr": {
            runtime: "cloud",
            cloud: { autoCreatePR: true },
          },
        },
      },
      "cloud-pr",
    );
    assert.equal(merged.runtime, "cloud");
    assert.equal(merged.cloud?.autoCreatePR, true);
    assert.equal(merged.model, "composer-2.5");
    assert.equal(merged.profiles, undefined);
  });

  it("throws on an unknown profile", () => {
    assert.throws(() => applyProfile({}, "missing"), /Unknown profile/);
  });
});

describe("resolve defaults", () => {
  it("prefers explicit runtime over env and config", () => {
    assert.equal(
      resolveRuntime({ runtime: "cloud" }, "local", { MIND_CURSOR_RUNTIME: "cloud" }),
      "local",
    );
    assert.equal(resolveRuntime({ runtime: "cloud" }, undefined, {}), "cloud");
    assert.equal(resolveRuntime({}, undefined, { MIND_CURSOR_RUNTIME: "cloud" }), "cloud");
    assert.equal(resolveRuntime({}, undefined, {}), "local");
  });

  it("resolves model from config then env then default", () => {
    assert.equal(resolveModel({ model: "auto" }, { MIND_CURSOR_MODEL: "other" }), "auto");
    assert.equal(resolveModel({}, { MIND_CURSOR_MODEL: "auto" }), "auto");
    assert.equal(resolveModel({}, {}), "composer-2.5");
  });

  it("merges nested local/cloud/customServers", () => {
    const merged = mergeConfig(
      { local: { cwd: "/a" }, customServers: { a: { url: "https://a" } } },
      { local: { cwd: "/b" }, customServers: { b: { url: "https://b" } } },
    );
    assert.equal(merged.local?.cwd, "/b");
    assert.equal(asHttp(merged.customServers?.a).url, "https://a");
    assert.equal(asHttp(merged.customServers?.b).url, "https://b");
  });
});
