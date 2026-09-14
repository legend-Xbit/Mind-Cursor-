import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { REQUIRED_SECTIONS, validateCommands } from "../scripts/validate-commands.ts";

const VALID_BODY = [
  "---",
  "description: Example command.",
  "---",
  "",
  "# Example",
  "",
  ...REQUIRED_SECTIONS.flatMap((section) => [`## ${section}`, "", "Notes.", ""]),
  "```bash",
  "npx tsx src/cli.ts list --json",
  "```",
  "",
].join("\n");

describe("validateCommands", () => {
  it("accepts the repo command files", async () => {
    const result = await validateCommands();
    assert.deepEqual(result.files, [
      "commands/list.md",
      "commands/run.md",
      "commands/serve.md",
      "commands/status.md",
    ]);
    assert.deepEqual(result.issues, []);
  });

  it("skips underscore meta-documents", async () => {
    const result = await validateCommands();
    assert.ok(!result.files.includes("commands/_conventions.md"));
  });

  it("reports missing sections and frontmatter", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mind-cursor-commands-"));
    await writeFile(join(dir, "broken.md"), "# Broken\n\nNo sections.\n", "utf8");
    await writeFile(join(dir, "_skip.md"), "# Meta\n", "utf8");
    const result = await validateCommands(dir);
    assert.deepEqual(result.files, ["commands/broken.md"]);
    const codes = result.issues.map((issue) => issue.code);
    assert.ok(codes.includes("CMD_NO_FRONTMATTER"));
    assert.ok(codes.includes("CMD_MISSING_SECTION"));
    assert.ok(codes.includes("CMD_NO_CLI_EXAMPLE"));
  });

  it("accepts a minimal valid command file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mind-cursor-commands-"));
    await writeFile(join(dir, "ok.md"), VALID_BODY, "utf8");
    const result = await validateCommands(dir);
    assert.deepEqual(result.issues, []);
  });
});
