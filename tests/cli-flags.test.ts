import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(ROOT, "src/cli.ts");
const TSX = join(ROOT, "node_modules/tsx/dist/cli.mjs");

function runCli(args: string[], env: NodeJS.ProcessEnv): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [TSX, CLI, ...args], { cwd: ROOT, env, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("--include-unauthenticated CLI flag", () => {
  it("config.includeUnauthenticated: true is no longer clobbered by a hardcoded false", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mind-cursor-cli-flags-"));
    const configPath = join(dir, "mind-cursor.config.json");
    await writeFile(configPath, JSON.stringify({ includeUnauthenticated: true, enabled: ["notion"] }));
    try {
      // No --include-unauthenticated flag at all: config's own setting must apply.
      const env = { ...process.env };
      delete env.NOTION_API_KEY;
      const result = runCli(["resolve", "--config", configPath], env);
      assert.equal(result.status, 0, result.stderr);
      const body = JSON.parse(result.stdout);
      assert.ok(body.servers.notion, "expected notion to attach via config.includeUnauthenticated alone");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("still omits an unauthenticated server when neither the flag nor config opts in", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mind-cursor-cli-flags-"));
    const configPath = join(dir, "mind-cursor.config.json");
    await writeFile(configPath, JSON.stringify({ enabled: ["notion"] }));
    try {
      const env = { ...process.env };
      delete env.NOTION_API_KEY;
      const result = runCli(["resolve", "--config", configPath], env);
      assert.equal(result.status, 0, result.stderr);
      const body = JSON.parse(result.stdout);
      assert.ok(!body.servers.notion);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
