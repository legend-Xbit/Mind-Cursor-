---
description: Start the Mind Cursor stdio MCP server so Cursor and other hosts can call the work layer.
---

# Serve MCP

Expose `mind_list_tools`, `mind_resolve_mcp`, `mind_layer_info`, `mind_run_agent`, and `mind_resume_agent` over stdio.

## Preflight

1. Confirm Node.js ≥ 22.13 and dependencies are installed.
2. Confirm `src/cli.ts` and `.cursor/mcp.json` exist.
3. Confirm `CURSOR_API_KEY` only if the user intends to call `mind_run_agent`. Listing tools does not need it.
4. Stdio MCP uses stdout for JSON-RPC — do not print banners on stdout. Logs go to stderr.
5. If a serve process is already bound in this workspace, report it instead of starting a duplicate.

## Plan

Read-only until a client calls `mind_run_agent`. Starting the server is not a deploy.

1. Prefer the project MCP entry in `.cursor/mcp.json` (`npx tsx src/cli.ts serve`) when the user is inside Cursor.
2. Otherwise start the CLI serve command in the foreground or a dedicated terminal.
3. Verify with `mind_layer_info` or `list --json`.

## Commands

`.cursor/mcp.json` already registers:

```json
{
  "mcpServers": {
    "mind-cursor": {
      "command": "npx",
      "args": ["tsx", "src/cli.ts", "serve"]
    }
  }
}
```

Manual start:

```bash
npx tsx src/cli.ts serve
```

Equivalent npm script:

```bash
npm run serve
```

## Verification

- [ ] Process stays up (stdio connected) or Cursor shows `mind-cursor` under MCP
- [ ] `mind_layer_info` or `npx tsx src/cli.ts list --json` returns a catalog
- [ ] No API keys printed on stderr/stdout

## Summary

```
## Result
- **Action**: started or confirmed Mind Cursor MCP server
- **Status**: success | partial | failed
- **Details**: transport=stdio, tools=mind_layer_info,mind_list_tools,mind_resolve_mcp,mind_run_agent,mind_resume_agent
```

## Next Steps

- In Cursor: reload MCP, then `/list` or ask the agent to call `mind_list_tools`.
- To execute work: `/run` (still requires `CURSOR_API_KEY`).
- To attach vendor tools in the IDE: keep the sibling entries in `.cursor/mcp.json` (Notion, Vercel, GitHub, Slack) and sign in via OAuth.
