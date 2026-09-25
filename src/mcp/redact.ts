import type { McpServerConfig, ResolvedTool } from "../types.ts";

export type RedactedHttpMcpServer = {
  type: "http" | "sse";
  url: string;
  hasHeaders: boolean;
  hasAuth: boolean;
};

export type RedactedStdioMcpServer = {
  type: "stdio";
  command: string;
  args?: string[];
  hasEnv: boolean;
};

export type RedactedMcpServer = RedactedHttpMcpServer | RedactedStdioMcpServer;

export type PublicResolvedTool = Omit<ResolvedTool, "server"> & {
  server?: RedactedMcpServer;
};

/** Strip header/auth/env values so inspect output cannot leak secrets. */
export function redactMcpServer(server: McpServerConfig): RedactedMcpServer {
  if ("url" in server) {
    return {
      type: server.type ?? "http",
      url: server.url,
      hasHeaders: Boolean(server.headers && Object.keys(server.headers).length > 0),
      hasAuth: Boolean(server.auth),
    };
  }
  return {
    type: "stdio",
    command: server.command,
    args: server.args,
    hasEnv: Boolean(server.env && Object.keys(server.env).length > 0),
  };
}

export function redactMcpServers(
  servers: Record<string, McpServerConfig>,
): Record<string, RedactedMcpServer> {
  return Object.fromEntries(
    Object.entries(servers).map(([id, server]) => [id, redactMcpServer(server)]),
  );
}

export function toPublicTool(tool: ResolvedTool): PublicResolvedTool {
  if (!tool.server) {
    const { server: _server, ...rest } = tool;
    return rest;
  }
  return {
    ...tool,
    server: redactMcpServer(tool.server),
  };
}

export function toPublicTools(tools: ResolvedTool[]): PublicResolvedTool[] {
  return tools.map(toPublicTool);
}
