#!/usr/bin/env npx tsx
/**
 * Enforce commands/_conventions.md on every non-underscore command file.
 *
 * Usage: npx tsx scripts/validate-commands.ts [--format pretty|json]
 * Exits 0 on success, 1 on failure.
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_SECTIONS = [
  "Preflight",
  "Plan",
  "Commands",
  "Verification",
  "Summary",
  "Next Steps",
] as const;

export type CommandIssue = {
  file: string;
  code: string;
  message: string;
};

export type CommandValidation = {
  files: string[];
  issues: CommandIssue[];
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function extractFrontmatter(content: string): { description?: string } | null {
  if (!content.startsWith("---")) {
    return null;
  }
  const end = content.indexOf("\n---", 3);
  if (end === -1) {
    return null;
  }
  const yaml = content.slice(4, end);
  const match = yaml.match(/^description:\s*(.+)$/m);
  return { description: match?.[1]?.trim().replace(/^["']|["']$/g, "") };
}

function hasHeading(content: string, title: string): boolean {
  const escaped = title.replace(/\s+/g, "\\s+");
  return new RegExp(`^#{2,3}\\s+.*${escaped}`, "im").test(content);
}

export async function validateCommands(commandsDir = join(ROOT, "commands")): Promise<CommandValidation> {
  const names = (await readdir(commandsDir))
    .filter((name) => name.endsWith(".md") && !name.startsWith("_"))
    .sort();
  const issues: CommandIssue[] = [];

  for (const name of names) {
    const file = `commands/${name}`;
    const content = await readFile(join(commandsDir, name), "utf8");
    const frontmatter = extractFrontmatter(content);

    if (!frontmatter) {
      issues.push({ file, code: "CMD_NO_FRONTMATTER", message: "missing YAML frontmatter" });
    } else if (!frontmatter.description) {
      issues.push({ file, code: "CMD_NO_DESCRIPTION", message: "frontmatter missing description" });
    }

    for (const section of REQUIRED_SECTIONS) {
      if (!hasHeading(content, section)) {
        issues.push({
          file,
          code: "CMD_MISSING_SECTION",
          message: `missing section: ${section}`,
        });
      }
    }

    const fences = [...content.matchAll(/```[\w-]*\n([\s\S]*?)```/g)].map((match) => match[1] ?? "");
    const hasCli = fences.some((block) => /tsx src\/cli\.ts|npm run serve|mind-cursor/.test(block));
    if (!hasCli) {
      issues.push({
        file,
        code: "CMD_NO_CLI_EXAMPLE",
        message: "no fenced CLI example (tsx src/cli.ts or npm run serve)",
      });
    }
  }

  return { files: names.map((name) => `commands/${name}`), issues };
}

async function main(): Promise<number> {
  const format = process.argv.includes("--format=json") ? "json" : "pretty";
  const result = await validateCommands();

  if (format === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`Mind Cursor — command conventions\n`);
    for (const file of result.files) {
      const fileIssues = result.issues.filter((issue) => issue.file === file);
      if (fileIssues.length === 0) {
        process.stdout.write(`  ok  ${file}\n`);
      } else {
        for (const issue of fileIssues) {
          process.stderr.write(`  err ${issue.file} — ${issue.message}\n`);
        }
      }
    }
    process.stdout.write(
      result.issues.length === 0
        ? `\nPASSED — ${result.files.length} command(s)\n`
        : `\nFAILED — ${result.issues.length} issue(s)\n`,
    );
  }

  return result.issues.length > 0 ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => {
    process.exitCode = code;
  });
}
