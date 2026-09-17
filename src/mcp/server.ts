import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { applyProfile, loadConfigFile, resolveModel, resolveRuntime } from "../config.ts";
import { redactMcpServers, toPublicTools } from "./redact.ts";
import { inspectAll, resolveMcpServers, summarizeTools } from "./registry.ts";
import { TOOL_PRESETS } from "./presets.ts";
import { LAYER_VERSION } from "../version.ts";

function loadLayer(profile?: string) {
  const config = applyProfile(loadConfigFile(), profile);
  const runtime = resolveRuntime(config);
  const model = resolveModel(config);
  const tools = inspectAll({ config, runtime });
  const servers = resolveMcpServers({ config, runtime });
  return { config, runtime, model, tools, servers };
}

export function createMindCursorMcpServer(): McpServer {
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
      const layer = loadLayer(profile);
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
        "List Notion, Vercel, GitHub, Slack, Linear, Figma, Treg, Plain, and custom MCP adapters with ready / needs_auth / needs_config status.",
      inputSchema: {
        profile: z.string().optional(),
      },
    },
    async ({ profile }) => {
      const layer = loadLayer(profile);
      return {
        content: [{ type: "text", text: JSON.stringify(toPublicTools(layer.tools), null, 2) }],
      };
    },
  );

  server.registerTool(
    "mind_resolve_mcp",
    {
      title: "Resolve MCP servers for a Cursor SDK agent",
      description:
        "Build the mcpServers object to pass to Agent.create / Agent.prompt / Agent.resume. Secrets stay in env; this returns redacted URLs and header keys.",
      inputSchema: {
        profile: z.string().optional(),
        includeUnauthenticated: z
          .boolean()
          .optional()
          .describe("Include HTTP servers that have a URL but no token (OAuth reuse)."),
      },
    },
    async ({ profile, includeUnauthenticated }) => {
      const config = applyProfile(loadConfigFile(), profile);
      const runtime = resolveRuntime(config);
      const servers = redactMcpServers(
        resolveMcpServers({
          config,
          runtime,
          includeUnauthenticated,
        }),
      );
      return {
        content: [{ type: "text", text: JSON.stringify({ runtime, servers }, null, 2) }],
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
      const { createMindCursor } = await import("../sdk/client.ts");
      const layer = createMindCursor({
        profile,
        runtime,
        model,
      });
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
                attached: Object.keys(layer.mcpServers()),
              },
              null,
              2,
            ),
          },
        ],
        isError: result.status === "error",
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
        agentId: z.string().describe("Local agent-* id or cloud bc-* id"),
        prompt: z.string(),
        profile: z.string().optional(),
        runtime: z.enum(["local", "cloud"]).optional(),
      },
    },
    async ({ agentId, prompt, profile, runtime }) => {
      const { createMindCursor } = await import("../sdk/client.ts");
      const layer = createMindCursor({ profile, runtime });
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
              },
              null,
              2,
            ),
          },
        ],
        isError: result.status === "error",
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
