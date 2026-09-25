---
description: Health check for the Mind Cursor work layer — install, config, auth names, and attached MCP servers.
---

# Mind Cursor status

Read-only doctor for the work layer. Does not launch an agent.

## Preflight

1. Confirm Node.js ≥ 22.13.
2. Confirm `package.json` and `node_modules/@cursor/sdk` exist. If missing: `npm install`.
3. Confirm `mind-cursor.config.json` exists (or report "using defaults").
4. Confirm whether `CURSOR_API_KEY` is set. Print only `set` / `missing` — **never the value**.
5. `git status --short` — note a dirty tree; do not stash or commit unless the user asked.
6. `.vercel/project.json` is optional. If absent, say "Vercel project not linked" and continue. Do not stop the layer check.

## Plan

1. MCP-first: `mind_layer_info` + `mind_resolve_mcp` when the server is connected.
2. CLI-fallback: `list --json` and `resolve`.
3. Typecheck/tests only if the user asked for a full doctor; default is catalog + auth names.

No destructive operations.

## Commands

### MCP-first

`mind_layer_info` and `mind_resolve_mcp` (redacted: `headerKeys` / `authKeys` / `envKeys` only, never values).

### CLI-fallback

```bash
node -v
npx tsx src/cli.ts list --json
npx tsx src/cli.ts resolve
```

Optional deeper check (not required for a passing status):

```bash
npm run typecheck
npm test
```

## Verification

- [ ] Node version ≥ 22.13
- [ ] CLI `list` returned
- [ ] `CURSOR_API_KEY` reported as set or missing (name only)
- [ ] Attached server ids match ready tools (unless `--include-unauthenticated`)
- [ ] No secret values in the report

## Summary

```
## Result
- **Action**: layer health check
- **Status**: success | partial | failed
- **Details**: runtime, model, CURSOR_API_KEY=set|missing, ready tool count, attached server ids
```

## Next Steps

- `CURSOR_API_KEY` missing → create a key at Cursor Dashboard → API Keys, then `/run`.
- Tools `needs_auth` → `/list` and set the named tokens.
- Ready to execute → `/run` or `/serve`.
- Vercel deploys needed and unlinked → `vercel link`, then attach the Vercel MCP token.
