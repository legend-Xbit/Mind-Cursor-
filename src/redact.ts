/**
 * Presentation-boundary redaction for MCP server descriptors.
 *
 * `inspectAll` / `resolveMcpServers` / `ResolvedTool.server` stay untouched —
 * that is the typed, SDK-bound shape the layer feeds to `Agent.create`.
 * Everything that only *displays* a resolved tool (the `list` / `resolve`
 * CLI commands, and the `mind_list_tools` / `mind_resolve_mcp` MCP tools)
 * must go through {@link redactServer} / {@link redactTool} first.
 *
 * The guarantee: secret-bearing fields (HTTP header values, OAuth
 * `CLIENT_SECRET`, stdio `env` values) are never emitted — only their key
 * names. URLs and stdio `args` can't be reduced to key names the same way,
 * so they get best-effort structural scrubbing (strip userinfo, blank any
 * query string, redact opaque-looking path segments, redact values that
 * immediately follow a `--token` / `--key` / `-H` style flag). That second
 * layer is a defense in depth, not a guarantee — a secret pasted into a
 * config file as a literal path segment or a non-flag-adjacent argument is
 * indistinguishable from ordinary data.
 */
import type { HttpMcpServerConfig, McpServerConfig, ResolvedTool, StdioMcpServerConfig } from "./types.ts";

export type RedactedHttpServer = {
  type: "http" | "sse";
  url: string;
  headerKeys: string[];
  authKeys?: string[];
  scopes?: string[];
};

export type RedactedStdioServer = {
  type: "stdio";
  command: string;
  args?: string[];
  envKeys: string[];
  cwd?: string;
};

export type RedactedServer = RedactedHttpServer | RedactedStdioServer;

export type RedactedTool = Omit<ResolvedTool, "server"> & { server?: RedactedServer };

const REDACTED = "<redacted>";
const FLAG_PATTERN = /^-{1,2}([A-Za-z-]*)$/;
const SECRET_FLAG_WORDS = /token|key|secret|auth|password|bearer/i;
// A bare `-H` / `-h` (curl-style header flag) doesn't match SECRET_FLAG_WORDS on its own.
const HEADER_FLAG = /^-H$/;
// Path segments long enough and opaque enough to plausibly be a secret, minus a
// short list of conventional route names that would otherwise be flagged.
const OPAQUE_SEGMENT = /^[A-Za-z0-9_-]{8,}$/;
const SAFE_SEGMENTS = new Set(["mcp", "sse", "http", "https", "api", "v1", "v2", "rpc", "server", "mcp-server"]);

export function scrubUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  parsed.username = "";
  parsed.password = "";
  if (parsed.search) {
    parsed.search = "?<redacted>";
  }
  parsed.hash = "";
  const segments = parsed.pathname.split("/").map((segment) => {
    if (segment && !SAFE_SEGMENTS.has(segment.toLowerCase()) && OPAQUE_SEGMENT.test(segment)) {
      return REDACTED;
    }
    return segment;
  });
  parsed.pathname = segments.join("/");
  return parsed.toString();
}

function scrubArgs(args: string[] | undefined, envValues: string[]): string[] | undefined {
  if (!args) {
    return undefined;
  }
  const knownValues = new Set(envValues.filter((value) => value.length > 0));
  return args.map((arg, index) => {
    if (knownValues.has(arg)) {
      return REDACTED;
    }
    const previous = args[index - 1];
    if (previous) {
      const match = previous.match(FLAG_PATTERN);
      if (match && (SECRET_FLAG_WORDS.test(match[1] ?? "") || HEADER_FLAG.test(previous))) {
        return REDACTED;
      }
    }
    return arg;
  });
}

export function redactServer(server: McpServerConfig): RedactedServer {
  if ("command" in server) {
    const stdio = server as StdioMcpServerConfig;
    return {
      type: "stdio",
      command: stdio.command,
      args: scrubArgs(stdio.args, Object.values(stdio.env ?? {})),
      envKeys: Object.keys(stdio.env ?? {}),
      cwd: stdio.cwd,
    };
  }
  const http = server as HttpMcpServerConfig;
  return {
    type: http.type ?? "http",
    url: scrubUrl(http.url),
    headerKeys: Object.keys(http.headers ?? {}),
    ...(http.auth ? { authKeys: Object.keys(http.auth), scopes: http.auth.scopes } : {}),
  };
}

export function redactTool(tool: ResolvedTool): RedactedTool {
  if (!tool.server) {
    return tool as RedactedTool;
  }
  return { ...tool, server: redactServer(tool.server) };
}
