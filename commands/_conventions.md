---
description: Meta-document for Mind Cursor slash commands. Not user-invocable. Required sections, MCP-first ops, and validation rules.
---

# Command Conventions

Every slash command in this repo follows a consistent structure so the agent produces reliable, verifiable results. When authoring or updating a command file, include **all** of the sections below.

`scripts/validate-commands.ts` enforces these conventions. Every non-underscore command file is checked for frontmatter `description` and the required sections: Preflight, Plan, Commands, Verification, Summary, Next Steps.

## Required Sections

### 1. Preflight

Check prerequisites before doing any work:

- **Node** — `node -v` must be 22.13 or later (`@cursor/sdk` requirement).
- **Install** — `package.json` and `node_modules/@cursor/sdk` exist. If missing, run `npm install`.
- **Config** — `mind-cursor.config.json` (or `MIND_CURSOR_CONFIG`) is present or defaults apply.
- **Auth names only** — Confirm `CURSOR_API_KEY` (and tool tokens) are *set*. Never print values.
- **Repo state** — Note uncommitted changes, dirty working tree, or detached HEAD when relevant.
- **Scope** — This repo is a single package (not a monorepo). Do not invent a workspace package.
- **Vercel link** — Optional. `.vercel/project.json` is not required for the work layer. If the user asked for Vercel deploys and the project is unlinked, guide them through `vercel link` instead of skipping silently.

Preflight failures should produce clear, actionable guidance — never silently skip.

### 2. Plan

Before executing, state what will happen:

- List the MCP calls or CLI commands that will run.
- Flag destructive or production-impacting operations (cloud `autoCreatePR`, `mind_run_agent` spend) and require explicit user confirmation.
- If multiple strategies exist (MCP-first vs CLI-fallback), state which path was chosen and why.

### 3. Commands

The operational core. Follow these conventions:

- **MCP-first, CLI-fallback** — Prefer the `mind-cursor` MCP server (`mind_list_tools`, `mind_resolve_mcp`, `mind_layer_info`, `mind_run_agent`, `mind_resume_agent`) and the other attached MCP tools (Notion, Vercel, GitHub, Slack, …). Use `npx tsx src/cli.ts …` when MCP is not connected.
- **Structured output** — Prefer `--json` / JSON MCP payloads; parse and present a readable summary.
- **No secrets in output** — Never echo environment variable values. `list`, `resolve`, `mind_list_tools`, and `mind_resolve_mcp` redact by construction (header/env/`CLIENT_SECRET` values become key-name lists); never rerun with `--reveal-secrets` inside an automated command flow.
- **Untrusted config is not an error** — A discovered `mind-cursor.config.json`'s `customServers` showing `needs_config` with an "untrusted" reason is expected, not a bug: it only attaches with `--trust-config`, `MIND_CURSOR_TRUST_CONFIG=1`, or an explicit `--config`/`MIND_CURSOR_CONFIG` path. Do not pass `--trust-config` on the caller's behalf without their say-so.
- **Confirmation for destructive ops** — Cloud runs with `autoCreatePR`, production deploys, env removal, and anything that opens a PR require an explicit "yes" from the user.

### 4. Verification

After execution, confirm the outcome:

- Re-read state (`list`, `resolve`, or `mind_layer_info`) to confirm the operation took effect.
- Compare before/after where possible (ready tool count, attached server names, run status).
- Surface errors or warnings from command output. Distinguish startup failures (exit 1) from run failures (exit 2).

### 5. Summary

Present a concise result block:

```
## Result
- **Action**: what was done
- **Status**: success | partial | failed
- **Details**: key output (agent id, run id, attached MCP servers — no secrets)
```

### 6. Next Steps

Suggest logical follow-ups:

- After `list` → set missing tokens, or `run` a prompt.
- After `run` → `resume` with a follow-up, or inspect `status`.
- After `serve` → attach `.cursor/mcp.json` in Cursor and call `mind_list_tools`.

## File Naming

- Command files live in `commands/` and end in `.md`.
- Files prefixed with `_` (like this one) are meta-documents, not slash commands. They are excluded from validation of required sections and are not presented as user-invocable commands.

## Frontmatter

Every command file must include YAML frontmatter with at least a `description` field:

```yaml
---
description: One-line summary of what the command does.
---
```
