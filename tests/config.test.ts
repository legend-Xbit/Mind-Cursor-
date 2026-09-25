import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { describe, it } from "node:test";
import {
  applyProfile,
  interpolateEnv,
  interpolateUnknown,
  loadConfigFile,
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
    assert.equal(interpolateEnv("token=${TOKEN}", { TOKEN: "abc" }), "token=abc");
    assert.equal(interpolateEnv("${MISSING}", {}), "");
  });

  it("walks nested objects", () => {
    const out = interpolateUnknown(
      { headers: { Authorization: "token ${TOKEN}" }, list: ["prefix-${KEY}-suffix"] },
      { TOKEN: "abc", KEY: "k" },
    );
    assert.deepEqual(out, { headers: { Authorization: "token abc" }, list: ["prefix-k-suffix"] });
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
    assert.equal(resolveModel({ model: "  " }, { MIND_CURSOR_MODEL: "auto" }), "auto");
    assert.equal(resolveModel({ model: "" }, {}), "composer-2.5");
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

describe("loadConfigFile", () => {
  async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), "mind-cursor-config-"));
    try {
      return await fn(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("reports source 'none' and an empty config when the discovered path is missing", async () => {
    await withTempDir(async (dir) => {
      const previousCwd = process.cwd();
      process.chdir(dir);
      try {
        const loaded = loadConfigFile({ env: {} });
        assert.equal(loaded.source, "none");
        assert.deepEqual(loaded.config, {});
        assert.equal(loaded.path, resolvePath(dir, "mind-cursor.config.json"));
      } finally {
        process.chdir(previousCwd);
      }
    });
  });

  it("throws with the absolute path when an explicit path is missing", async () => {
    await withTempDir(async (dir) => {
      const missing = join(dir, "nope.json");
      assert.throws(
        () => loadConfigFile({ path: missing }),
        new RegExp(`config file not found: ${missing.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      );
    });
  });

  it("throws with the path on malformed JSON", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "mind-cursor.config.json");
      await writeFile(path, "{ not json");
      assert.throws(() => loadConfigFile({ path }), (error: Error) => error.message.startsWith(`${resolvePath(path)}:`));
    });
  });

  it("loads an explicit path, interpolates it, and reports source 'explicit'", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "mind-cursor.config.json");
      await writeFile(path, JSON.stringify({ customServers: { a: { type: "http", url: "${BASE}/mcp" } } }));
      const loaded = loadConfigFile({ path, env: { BASE: "https://example.com" } });
      assert.equal(loaded.source, "explicit");
      assert.equal(loaded.path, resolvePath(path));
      assert.equal(loaded.dir, dir);
      assert.equal(asHttp(loaded.config.customServers?.a).url, "https://example.com/mcp");
    });
  });

  it("reads the path named by the injected env, not process.env", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "mind-cursor.config.json");
      await writeFile(path, JSON.stringify({ model: "from-tmp" }));
      const previous = process.env.MIND_CURSOR_CONFIG;
      delete process.env.MIND_CURSOR_CONFIG;
      try {
        const loaded = loadConfigFile({ env: { MIND_CURSOR_CONFIG: path } });
        assert.equal(loaded.config.model, "from-tmp");
        assert.equal(loaded.source, "explicit");
      } finally {
        if (previous !== undefined) {
          process.env.MIND_CURSOR_CONFIG = previous;
        }
      }
    });
  });
});
