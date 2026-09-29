---
description: Run a Cursor SDK agent with every ready MCP adapter attached (local or cloud).
---

# Run agent

Launch one agent turn through the Mind Cursor layer. Spends Cursor usage. Cloud + `autoCreatePR` can open a pull request.

## Preflight

1. Confirm Node.js ≥ 22.13 and `npm install` has been run.
2. Confirm `CURSOR_API_KEY` is set. If missing, stop:
   > Set CURSOR_API_KEY (Cursor Dashboard → API Keys) and re-run `/run`.
3. Confirm a prompt exists (user message or `--prompt`). If missing, stop and ask for the task.
4. Resolve runtime: `--runtime local|cloud`, config `runtime`, or `MIND_CURSOR_RUNTIME` (default `local`).
5. If runtime is `cloud` and `cloud.autoCreatePR` is true (profile `cloud-pr`), **do not start** until the user explicitly says yes to opening a PR.
6. `npx tsx src/cli.ts list --json` — note which tools will attach. **Never print token values.**
7. A stderr line `skipped untrusted custom servers from …` means the config file was discovered (not pointed to explicitly) and its `customServers` were not attached. Do not pass `--trust-config` on the user's behalf; ask first.

## Plan

State the path before executing:

- **MCP-first** when `mind-cursor` is connected: `mind_run_agent` (one-shot) or `mind_resume_agent` (follow-up).
- **CLI-fallback** otherwise: `npx tsx src/cli.ts run` / `resume`.
- Log `runtime`, `model`, and attached server **ids** only.
- After `send`, log `agent=` and `run=` from stderr, then `wait()` via the CLI (the CLI already waits).

## Commands

### MCP-first

`mind_run_agent` with `prompt`, optional `profile`, `runtime`, `model`.

Resume (MCP servers must be passed again — they are not persisted):

`mind_resume_agent` with `agentId` + `prompt`.

### CLI-fallback

```bash
npx tsx src/cli.ts run "<prompt>" --runtime local --profile local-dev
npx tsx src/cli.ts run "<prompt>" --runtime cloud --profile cloud-pr --no-stream
npx tsx src/cli.ts resume <agentId> "<follow-up>"
```

Exit codes: `0` finished, `1` startup (`CursorAgentError`), `2` run executed and failed, `3` run cancelled.

⚠️ Cloud `--profile cloud-pr` sets `autoCreatePR`. Require an explicit "yes" before that command.

## Verification

- [ ] Startup did not throw (exit ≠ 1)
- [ ] `status` is `finished` | `error` | `cancelled`
- [ ] `agentId` and `runId` were logged
- [ ] Attached MCP ids match the preflight ready set
- [ ] On `error`, report exit 2 and do not pretend success
- [ ] On `cancelled`, report exit 3 — a dashboard-cancelled cloud run is not a success either

## Summary

```
## Result
- **Action**: ran Cursor agent via Mind Cursor layer
- **Status**: success | partial | failed
- **Details**: runtime, model, agentId, runId, status, attached MCP ids (no secrets)
```

## Next Steps

- Success → `/status` or `resume` with a follow-up.
- Exit 1 → fix key/config/network; honor `retryable` if present.
- Exit 2 or 3 → inspect the transcript / git state; do not blindly retry (duplicate cloud runs).
- Need tools in Cursor chat → `/serve` and reload MCP.
