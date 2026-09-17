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
  /**
   * Built-in preset ids to attach. Empty / omitted = every preset.
   * Custom servers under `customServers` are always attached unless listed in `disabled`.
   */
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
};

export type LayerInfo = {
  name: string;
  version: string;
  model: string;
  runtime: RuntimeKind;
};
