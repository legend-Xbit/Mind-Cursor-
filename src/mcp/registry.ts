import { interpolateUnknown } from "../config.ts";
import { getPreset, TOOL_PRESETS } from "./presets.ts";
import type {
  HttpMcpServerConfig,
  McpServerConfig,
  MindCursorConfig,
  ResolveOptions,
  ResolvedTool,
  RuntimeKind,
  StdioMcpServerConfig,
  ToolPreset,
  ToolStatus,
} from "../types.ts";

function firstEnv(env: NodeJS.ProcessEnv, keys: string[] | undefined): string | undefined {
  if (!keys) {
    return undefined;
  }
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function presetUrl(preset: ToolPreset, env: NodeJS.ProcessEnv): string | undefined {
  const fromEnv = preset.urlEnv ? env[preset.urlEnv]?.trim() : undefined;
  return fromEnv || preset.defaultUrl;
}

function isSelected(
  id: string,
  config: MindCursorConfig,
  kind: "preset" | "custom" = "preset",
): boolean {
  if (config.disabled?.includes(id)) {
    return false;
  }
  // Explicit customServers entries are on unless disabled. `enabled` only
  // filters built-in presets, so adding a server under customServers works
  // without also listing its id in enabled.
  if (kind === "custom") {
    return true;
  }
  if (config.enabled && config.enabled.length > 0) {
    return config.enabled.includes(id);
  }
  return true;
}

function isEmptyBearer(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }
  return /^Bearer\s*$/i.test(trimmed);
}

type InspectedCustomServer = {
  type?: string;
  url?: string;
  command?: string;
  args?: string[];
  headers?: Record<string, string>;
  auth?: HttpMcpServerConfig["auth"];
  env?: Record<string, string>;
  cwd?: string;
};

function buildHttpServer(preset: ToolPreset, env: NodeJS.ProcessEnv): {
  server?: HttpMcpServerConfig;
  status: ToolStatus;
  reason?: string;
} {
  const url = presetUrl(preset, env);
  if (!url) {
    return {
      status: "needs_config",
      reason: `Set ${preset.urlEnv ?? "a hosted MCP URL"} to attach ${preset.title}.`,
    };
  }

  const token = firstEnv(env, preset.tokenEnv);
  const clientId = preset.oauth?.clientIdEnv ? env[preset.oauth.clientIdEnv]?.trim() : undefined;
  const clientSecret = preset.oauth?.clientSecretEnv
    ? env[preset.oauth.clientSecretEnv]?.trim()
    : undefined;

  const server: HttpMcpServerConfig = { type: "http", url };

  if (token) {
    server.headers = { Authorization: `Bearer ${token}` };
  }
  if (clientId) {
    server.auth = {
      CLIENT_ID: clientId,
      ...(clientSecret ? { CLIENT_SECRET: clientSecret } : {}),
      ...(preset.oauth?.scopes ? { scopes: preset.oauth.scopes } : {}),
    };
  }

  if (token || clientId) {
    return { server, status: "ready" };
  }

  return {
    server,
    status: "needs_auth",
    reason: `No token/OAuth for ${preset.title}. Sign in from the Cursor app or set ${[...(preset.tokenEnv ?? []), preset.oauth?.clientIdEnv].filter(Boolean).join(" / ")}.`,
  };
}

export function inspectPreset(preset: ToolPreset, env: NodeJS.ProcessEnv = process.env): ResolvedTool {
  const built = buildHttpServer(preset, env);
  return {
    id: preset.id,
    title: preset.title,
    description: preset.description,
    category: preset.category,
    docsUrl: preset.docsUrl,
    ...built,
  };
}

export function inspectCustom(
  id: string,
  server: McpServerConfig,
  selected: boolean,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedTool {
  const base = {
    id,
    title: id,
    description: "Custom MCP server from mind-cursor.config.json",
    category: "custom" as const,
  };

  if (!selected) {
    return {
      ...base,
      status: "disabled",
      reason: "Listed in disabled.",
    };
  }

  const interpolated = interpolateUnknown(server, env) as InspectedCustomServer;
  const looksHttp =
    interpolated.type === "http" || interpolated.type === "sse" || interpolated.url !== undefined;
  const looksStdio = interpolated.type === "stdio" || interpolated.command !== undefined;

  if (looksHttp) {
    const url = interpolated.url?.trim() ?? "";
    if (!url) {
      return {
        ...base,
        status: "needs_config",
        reason: `Set a URL for custom server "${id}" (empty after env expansion).`,
      };
    }

    const headers = interpolated.headers ? { ...interpolated.headers } : undefined;
    const authorization = headers?.Authorization;
    if (headers && authorization !== undefined && isEmptyBearer(authorization)) {
      delete headers.Authorization;
      const cleaned: HttpMcpServerConfig = {
        type: interpolated.type === "sse" ? "sse" : "http",
        url,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        ...(interpolated.auth ? { auth: interpolated.auth } : {}),
      };
      return {
        ...base,
        status: "needs_auth",
        reason: `Authorization bearer for "${id}" is empty after env expansion.`,
        server: cleaned,
      };
    }

    const readyHttp: HttpMcpServerConfig = {
      type: interpolated.type === "sse" ? "sse" : "http",
      url,
      ...(headers ? { headers } : {}),
      ...(interpolated.auth ? { auth: interpolated.auth } : {}),
    };
    return {
      ...base,
      status: "ready",
      server: readyHttp,
    };
  }

  if (looksStdio) {
    const command = interpolated.command?.trim() ?? "";
    if (!command) {
      return {
        ...base,
        status: "needs_config",
        reason: `Set a command for custom stdio server "${id}" (empty after env expansion).`,
      };
    }
    const readyStdio: StdioMcpServerConfig = {
      type: "stdio",
      command,
      ...(interpolated.args ? { args: interpolated.args } : {}),
      ...(interpolated.env ? { env: interpolated.env } : {}),
      ...(interpolated.cwd ? { cwd: interpolated.cwd } : {}),
    };
    return {
      ...base,
      status: "ready",
      server: readyStdio,
    };
  }

  return {
    ...base,
    status: "needs_config",
    reason: `Custom server "${id}" needs an HTTP url or a stdio command.`,
  };
}

function stripStdioCwd(server: McpServerConfig, runtime: RuntimeKind): McpServerConfig {
  if (runtime === "cloud" && "command" in server) {
    const { cwd: _cwd, ...rest } = server as StdioMcpServerConfig;
    return rest;
  }
  return server;
}

export function inspectAll(options: ResolveOptions = {}): ResolvedTool[] {
  const env = options.env ?? process.env;
  const config = options.config ?? {};
  const tools: ResolvedTool[] = [];

  for (const preset of TOOL_PRESETS) {
    const selected = isSelected(preset.id, config);
    if (!selected) {
      tools.push({
        ...inspectPreset(preset, env),
        status: "disabled",
        reason: "Disabled by config.enabled / config.disabled.",
        server: undefined,
      });
      continue;
    }
    tools.push(inspectPreset(preset, env));
  }

  for (const [id, server] of Object.entries(config.customServers ?? {})) {
    if (getPreset(id)) {
      continue;
    }
    tools.push(inspectCustom(id, server, isSelected(id, config, "custom"), env));
  }

  return tools;
}

export function resolveMcpServers(options: ResolveOptions = {}): Record<string, McpServerConfig> {
  const runtime = options.runtime ?? "local";
  const includeUnauthenticated =
    options.includeUnauthenticated ?? options.config?.includeUnauthenticated ?? false;
  const servers: Record<string, McpServerConfig> = {};

  for (const tool of inspectAll(options)) {
    if (!tool.server) {
      continue;
    }
    if (tool.status === "disabled") {
      continue;
    }
    if (tool.status === "needs_config") {
      continue;
    }
    if (tool.status === "needs_auth" && !includeUnauthenticated) {
      continue;
    }
    servers[tool.id] = stripStdioCwd(tool.server, runtime);
  }

  return servers;
}

export function summarizeTools(tools: ResolvedTool[]): {
  ready: string[];
  needsAuth: string[];
  needsConfig: string[];
  disabled: string[];
} {
  return {
    ready: tools.filter((tool) => tool.status === "ready").map((tool) => tool.id),
    needsAuth: tools.filter((tool) => tool.status === "needs_auth").map((tool) => tool.id),
    needsConfig: tools.filter((tool) => tool.status === "needs_config").map((tool) => tool.id),
    disabled: tools.filter((tool) => tool.status === "disabled").map((tool) => tool.id),
  };
}
