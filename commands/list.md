---
description: List Mind Cursor MCP adapters and their ready / needs_auth / needs_config status.
---

# List MCP tools

Read-only catalog of Notion, Vercel, GitHub, Slack, Linear, Figma, Treg, Plain, and custom servers.

## Preflight

1. Confirm Node.js ≥ 22.13 (`node -v`). If older, stop and ask the user to upgrade.
2. Confirm `package.json` exists and `node_modules` is installed. If not: `npm install`.
3. Confirm `mind-cursor.config.json` or accept defaults.
4. Check whether tool token *names* are set (`NOTION_API_KEY`, `VERCEL_TOKEN`, …). **Never print values.**
5. Note dirty git state only if it changes which config file is on disk.

## Plan

Read-only. No agent run, no deploy, no PR.

1. Prefer MCP `mind_list_tools` (and `mind_layer_info`) if the `mind-cursor` server is connected.
2. Otherwise fall back to the CLI with `--json`.
3. Summarize counts; do not dump secrets or Authorization headers.

## Commands

### MCP-first

Call `mind_list_tools` and `mind_layer_info` on the `mind-cursor` MCP server.

### CLI-fallback

```bash
npx tsx src/cli.ts list --json
npx tsx src/cli.ts resolve
```

`resolve` returns the `mcpServers` object that would be passed to `Agent.create`, **redacted by default**: header/env/`CLIENT_SECRET` values become key-name lists (`headerKeys`, `envKeys`, `authKeys`), not values. `--reveal-secrets` prints the raw values (with a stderr warning) — only use it when the caller genuinely needs the value, never in an automated flow. `mind_list_tools` / `mind_resolve_mcp` over MCP are always redacted with no reveal escape hatch.

## Verification

- [ ] Catalog returned (or a clear preflight error)
- [ ] Each preset has status `ready` | `needs_auth` | `needs_config` | `disabled`
- [ ] Ready count matches `resolve` server keys
- [ ] No secret values appear in the summary

## Summary

```
## Result
- **Action**: listed MCP adapters
- **Status**: success | failed
- **Details**: ready=[…] auth=[…] config=[…] disabled=[…]
```

## Next Steps

- Missing tokens → set the named env vars from `.env.example`, then re-run `/list`.
- Ready tools → `/run` a prompt against the local tree, or `/serve` to expose the layer in Cursor.
- Treg/Plain `needs_config` → set `TREG_MCP_URL` / `PLAIN_MCP_URL`.
