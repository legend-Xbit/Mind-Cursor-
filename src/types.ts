/** Matches `@cursor/sdk` `McpServerConfig` so the layer can stay typed without importing the SDK in tests. */
export type HttpMcpServerConfig = {
  type?: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
  auth?: {
    CLIENT_ID: string;
    CLIENT_SECRET?: string;
    scopes?: string[];
  };
};

export type StdioMcpServerConfig = {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
};

export type McpServerConfig = HttpMcpServerConfig | StdioMcpServerConfig;

export type RuntimeKind = "local" | "cloud";

export type ToolStatus = "ready" | "needs_auth" | "needs_config" | "disabled";

export type ToolCategory =
  | "knowledge"
  | "deploy"
  | "data"
  | "comms"
  | "scm"
  | "support"
  | "custom";

export type CloudRepoConfig = {
  url: string;
  startingRef?: string;
};

export type MindCursorConfig = {
  model?: string;
  runtime?: RuntimeKind;
  local?: {
    cwd?: string;
  };
  cloud?: {
    repos?: CloudRepoConfig[];
    autoCreatePR?: boolean;
    skipReviewerRequest?: boolean;
  };
  /** Preset ids and custom server names to attach. Empty / omitted = every ready preset + custom server. */
  enabled?: string[];
  disabled?: string[];
  /** Attach HTTP/SSE servers even when no token is present (OAuth reuse from the Cursor app). */
  includeUnauthenticated?: boolean;
  customServers?: Record<string, McpServerConfig>;
  profiles?: Record<string, Partial<MindCursorConfig>>;
};

export type ToolPreset = {
  id: string;
  title: string;
  description: string;
  category: ToolCategory;
  docsUrl?: string;
  defaultUrl?: string;
  urlEnv?: string;
  tokenEnv?: string[];
  oauth?: {
    clientIdEnv: string;
    clientSecretEnv?: string;
    scopes?: string[];
  };
};

export type ResolvedTool = {
  id: string;
  title: string;
  description: string;
  category: ToolCategory;
  status: ToolStatus;
  reason?: string;
  docsUrl?: string;
  server?: McpServerConfig;
};

export type ResolveOptions = {
  env?: NodeJS.ProcessEnv;
  config?: MindCursorConfig;
  runtime?: RuntimeKind;
  includeUnauthenticated?: boolean;
  /**
   * Trust `config.customServers` enough to run its stdio commands / attach
   * its HTTP servers. Defaults to false. A config file discovered by
   * scanning the working directory (rather than pointed to explicitly via
   * `MIND_CURSOR_CONFIG`, `--config`, or `configPath`) is untrusted by
   * default: running `mind-cursor` inside an arbitrary cloned repo must not
   * silently execute that repo's custom MCP server commands.
   */
  trustCustomServers?: boolean;
  /** Path of the loaded config file, used only to build a helpful "untrusted" reason message. */
  configPath?: string;
};

/** How a loaded config file was located — see {@link LoadedConfig}. */
export type ConfigSource = "explicit" | "discovered" | "none";

/**
 * Result of {@link loadConfigFile}. Carries provenance alongside the parsed
 * config: `source` says whether the path was given explicitly or merely
 * discovered by scanning the working directory (used to gate untrusted
 * `customServers`), and `dir` is the anchor for resolving config-relative
 * paths such as `local.cwd`.
 */
export type LoadedConfig = {
  config: MindCursorConfig;
  /** Absolute path of the config file that was loaded, or would have been. */
  path: string;
  /** Directory containing `path`. */
  dir: string;
  source: ConfigSource;
};
