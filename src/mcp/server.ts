import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { applyProfile, loadConfigFile, resolveModel, resolveRuntime } from "../config.ts";
import { redactServer, redactTool } from "../redact.ts";
import type { createMindCursor as CreateMindCursorFn } from "../sdk/client.ts";
import { LAYER_VERSION } from "../version.ts";
import { TOOL_PRESETS } from "./presets.ts";
import { inspectAll, resolveMcpServers, summarizeTools } from "./registry.ts";

export type CreateMindCursorMcpServerDeps = {
  env?: NodeJS.ProcessEnv;
  configPath?: string;
  createMindCursor?: typeof CreateMindCursorFn;
};

function resolveDeps(deps: CreateMindCursorMcpServerDeps): { env: NodeJS.ProcessEnv; configPath?: string } {
  const env = deps.env ?? process.env;
  return { env, configPath: deps.configPath ?? env.MIND_CURSOR_CONFIG };
}

function loadLayer(deps: { env: NodeJS.ProcessEnv; configPath?: string }, profile?: string) {
  const loaded = loadConfigFile({ path: deps.configPath, env: deps.env });
  const config = applyProfile(loaded.config, profile);
  const runtime = resolveRuntime(config, undefined, deps.env);
  const model = resolveModel(config, deps.env);
  const trustCustomServers =
    loaded.source === "explicit" || deps.env.MIND_CURSOR_TRUST_CONFIG === "1";
  const tools = inspectAll({ env: deps.env, config, runtime, trustCustomServers, configPath: loaded.path });
  const servers = resolveMcpServers({ env: deps.env, config, runtime, trustCustomServers, configPath: loaded.path });
  return { config, runtime, model, tools, servers, configPath: loaded.path, trustCustomServers };
}

async function resolveCreateMindCursor(override?: typeof CreateMindCursorFn): Promise<typeof CreateMindCursorFn> {
  if (override) {
    return override;
  }
  const mod = await import("../sdk/client.ts");
  return mod.createMindCursor;
}

export function createMindCursorMcpServer(deps: CreateMindCursorMcpServerDeps = {}): McpServer {
  const resolved = resolveDeps(deps);
  const createMindCursorOverride = deps.createMindCursor;
  const server = new McpServer({
    name: "mind-cursor",
    version: LAYER_VERSION,
  });

  server.registerTool(
    "mind_layer_info",
    {
      title: "Mind Cursor layer info",
      description: "Return the work-layer version, default model, runtime, and connected MCP tool counts.",
      inputSchema: {
        profile: z.string().optional().describe("Optional config profile name"),
      },
    },
    async ({ profile }) => {
      const layer = loadLayer(resolved, profile);
      const summary = summarizeTools(layer.tools);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                name: "mind-cursor",
                version: LAYER_VERSION,
                model: layer.model,
                runtime: layer.runtime,
                attachedServers: Object.keys(layer.servers),
                catalog: summary,
                presets: TOOL_PRESETS.map((preset) => preset.id),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "mind_list_tools",
    {
      title: "List MCP tool adapters",
      description:
        "List Notion, Vercel, GitHub, Slack, Linear, Figma, Treg, Plain, and custom MCP adapters with ready / needs_auth / needs_config status. Server URLs and header/env/arg secrets are redacted to key names only — see mind_resolve_mcp for the shape.",
      inputSchema: {
        profile: z.string().optional(),
      },
    },
    async ({ profile }) => {
      const layer = loadLayer(resolved, profile);
      return {
        content: [{ type: "text", text: JSON.stringify(layer.tools.map(redactTool), null, 2) }],
      };
    },
  );

  server.registerTool(
    "mind_resolve_mcp",
    {
      title: "Resolve MCP servers for a Cursor SDK agent",
      description:
        "Build the mcpServers object that would be passed to Agent.create / Agent.prompt / Agent.resume, redacted for display: header/env/CLIENT_SECRET values become key-name lists (headerKeys/envKeys/authKeys), URLs have userinfo and query stripped and opaque path segments blanked, and stdio args after a --token/--key/-H style flag are blanked. Actual secret values never leave the process through this tool.",
      inputSchema: {
        profile: z.string().optional(),
        includeUnauthenticated: z
          .boolean()
          .optional()
          .describe("Include HTTP servers that have a URL but no token (OAuth reuse)."),
      },
    },
    async ({ profile, includeUnauthenticated }) => {
      const loaded = loadConfigFile({ path: resolved.configPath, env: resolved.env });
      const config = applyProfile(loaded.config, profile);
      const runtime = resolveRuntime(config, undefined, resolved.env);
      const trustCustomServers =
        loaded.source === "explicit" || resolved.env.MIND_CURSOR_TRUST_CONFIG === "1";
      const servers = resolveMcpServers({
        env: resolved.env,
        config,
        runtime,
        includeUnauthenticated,
        trustCustomServers,
        configPath: loaded.path,
      });
      const redacted = Object.fromEntries(
        Object.entries(servers).map(([id, server]) => [id, redactServer(server)]),
      );
      return {
        content: [{ type: "text", text: JSON.stringify({ runtime, servers: redacted }, null, 2) }],
      };
    },
  );

  server.registerTool(
    "mind_run_agent",
    {
      title: "Run a Cursor SDK agent with attached MCP tools",
      description:
        "Create a one-shot Cursor agent (Agent.prompt) against the local or cloud runtime, with every ready MCP adapter attached. Requires CURSOR_API_KEY.",
      inputSchema: {
        prompt: z.string().describe("Task for the Cursor agent"),
        profile: z.string().optional(),
        runtime: z.enum(["local", "cloud"]).optional(),
        model: z.string().optional(),
      },
    },
    async ({ prompt, profile, runtime, model }) => {
      const createMindCursor = await resolveCreateMindCursor(createMindCursorOverride);
      const layer = createMindCursor({
        profile,
        runtime,
        model,
        env: resolved.env,
        configPath: resolved.configPath,
      });
      const skipped = layer.untrustedCustomServerIds();
      if (skipped.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: `skipped untrusted custom servers from ${layer.configPath ?? "(no config file)"}: ${skipped.join(", ")} — set MIND_CURSOR_TRUST_CONFIG=1 to trust them`,
            },
          ],
          isError: true,
        };
      }
      const result = await layer.prompt(prompt);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                agentId: result.agentId,
                runId: result.runId,
                status: result.status,
                result: result.result,
                error: result.error,
                attached: Object.keys(layer.mcpServers()),
              },
              null,
              2,
            ),
          },
        ],
        isError: result.status !== "finished",
      };
    },
  );

  server.registerTool(
    "mind_resume_agent",
    {
      title: "Resume a Cursor SDK agent",
      description:
        "Resume an existing agent by id and send a follow-up. Re-attaches MCP servers (they are not persisted across resume).",
      inputSchema: {
        agentId: z.string().describe("Cursor agent id (e.g. agent_... or bc-... )"),
        prompt: z.string().describe("Follow-up task for that agent"),
        profile: z.string().optional(),
      },
    },
    async ({ agentId, prompt, profile }) => {
      const createMindCursor = await resolveCreateMindCursor(createMindCursorOverride);
      const layer = createMindCursor({
        profile,
        env: resolved.env,
        configPath: resolved.configPath,
      });
      const skipped = layer.untrustedCustomServerIds();
      if (skipped.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: `skipped untrusted custom servers from ${layer.configPath ?? "(no config file)"}: ${skipped.join(", ")} — set MIND_CURSOR_TRUST_CONFIG=1 to trust them`,
            },
          ],
          isError: true,
        };
      }
      const result = await layer.send(prompt, { agentId, stream: false });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                agentId: result.agentId,
                runId: result.runId,
                status: result.status,
                result: result.result,
                error: result.error,
                attached: Object.keys(layer.mcpServers()),
              },
              null,
              2,
            ),
          },
        ],
        isError: result.status !== "finished",
      };
    },
  );

  return server;
}

export async function serveMindCursorMcp(): Promise<void> {
  const server = createMindCursorMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
