import { resolve } from "node:path";
import { Agent, CursorAgentError, type AgentOptions } from "@cursor/sdk";
import { applyProfile, loadConfigFile, resolveModel, resolveRuntime } from "../config.ts";
import { toPublicTools, type PublicResolvedTool } from "../mcp/redact.ts";
import { getPreset } from "../mcp/presets.ts";
import { inspectAll, resolveMcpServers, summarizeTools } from "../mcp/registry.ts";
import type { CloudRepoConfig, McpServerConfig, MindCursorConfig, ResolvedTool, RuntimeKind } from "../types.ts";
import { formatStartupError } from "./errors.ts";
import { writeAssistantStream } from "./run.ts";

export type MindCursorOptions = {
  apiKey?: string;
  /**
   * A config object supplied directly by the caller. Bypasses file lookup
   * entirely and is trusted by construction (the caller authored it in
   * code) — `customServers` on it always attaches, regardless of
   * `trustConfig`. Note: unlike a loaded file, this is NOT run through
   * `${VAR}` interpolation.
   */
  config?: MindCursorConfig;
  configPath?: string;
  profile?: string;
  runtime?: RuntimeKind;
  model?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  includeUnauthenticated?: boolean;
  stream?: boolean;
  /**
   * Trust `config.customServers` from a config file that was only
   * discovered (not pointed to explicitly via `configPath` or
   * `MIND_CURSOR_CONFIG`) enough to run its stdio commands / attach its
   * HTTP servers. Defaults to false. Also settable via
   * `MIND_CURSOR_TRUST_CONFIG=1`.
   */
  trustConfig?: boolean;
};

export type MindRunError = {
  message: string;
  code?: string;
};

export type MindRunStatus = "finished" | "error" | "cancelled";

export type MindRunResult = {
  agentId: string;
  runId?: string;
  status: MindRunStatus;
  result?: unknown;
  /** Terminal failure details from `run.wait()` when the SDK provides them. */
  error?: MindRunError;
  /** Catalog snapshot with secrets stripped from server configs. */
  tools: PublicResolvedTool[];
};

const CLOUD_REPO_REQUIRED =
  "Cloud runtime requires at least one repo. Set cloud.repos in mind-cursor.config.json or MIND_CURSOR_REPO_URL.";

function readApiKey(options: MindCursorOptions, env: NodeJS.ProcessEnv): string | undefined {
  const key = (options.apiKey ?? env.CURSOR_API_KEY)?.trim();
  return key || undefined;
}

export class MindCursor {
  readonly config: MindCursorConfig;
  readonly configPath: string | undefined;
  readonly trustCustomServers: boolean;
  readonly runtime: RuntimeKind;
  readonly model: string;
  readonly apiKey: string | undefined;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly includeUnauthenticated: boolean;

  constructor(options: MindCursorOptions = {}) {
    this.env = options.env ?? process.env;

    let rawConfig: MindCursorConfig;
    let configDir: string | undefined;
    let trustedBySource = true;
    if (options.config) {
      rawConfig = options.config;
      this.configPath = undefined;
    } else {
      const loaded = loadConfigFile({ path: options.configPath, env: this.env });
      rawConfig = loaded.config;
      configDir = loaded.dir;
      this.configPath = loaded.path;
      trustedBySource = loaded.source === "explicit";
    }

    this.config = applyProfile(rawConfig, options.profile);
    this.trustCustomServers =
      trustedBySource || options.trustConfig === true || this.env.MIND_CURSOR_TRUST_CONFIG === "1";
    this.runtime = resolveRuntime(this.config, options.runtime, this.env);
    this.model = options.model?.trim() || resolveModel(this.config, this.env);
    this.apiKey = readApiKey(options, this.env);
    this.cwd = resolve(configDir ?? process.cwd(), options.cwd ?? this.config.local?.cwd ?? ".");
    this.includeUnauthenticated =
      options.includeUnauthenticated ?? this.config.includeUnauthenticated ?? false;

    const skipped = this.untrustedCustomServerIds();
    if (skipped.length > 0) {
      process.stderr.write(
        `skipped untrusted custom servers from ${this.configPath ?? "(no config file)"}: ${skipped.join(", ")} (pass --trust-config)\n`,
      );
    }
  }

  /** Custom server ids present in config that were skipped because the config file is untrusted. */
  untrustedCustomServerIds(): string[] {
    if (this.trustCustomServers) {
      return [];
    }
    return Object.keys(this.config.customServers ?? {}).filter((id) => !getPreset(id));
  }

  private requireApiKey(): string {
    if (!this.apiKey) {
      throw new Error("CURSOR_API_KEY is required. Pass apiKey or set the environment variable.");
    }
    return this.apiKey;
  }

  private cloudRepos(): CloudRepoConfig[] {
    if (this.config.cloud?.repos && this.config.cloud.repos.length > 0) {
      return this.config.cloud.repos;
    }
    if (this.env.MIND_CURSOR_REPO_URL?.trim()) {
      return [
        {
          url: this.env.MIND_CURSOR_REPO_URL,
          startingRef: this.env.MIND_CURSOR_STARTING_REF ?? "main",
        },
      ];
    }
    return [];
  }

  private assertReadyToRun(kind: "create" | "resume" = "create"): string {
    const apiKey = this.requireApiKey();
    if (kind === "create" && this.runtime === "cloud" && this.cloudRepos().length === 0) {
      throw new Error(CLOUD_REPO_REQUIRED);
    }
    return apiKey;
  }

  tools(): ResolvedTool[] {
    return inspectAll({
      env: this.env,
      config: this.config,
      runtime: this.runtime,
      includeUnauthenticated: this.includeUnauthenticated,
      trustCustomServers: this.trustCustomServers,
      configPath: this.configPath,
    });
  }

  mcpServers(): Record<string, McpServerConfig> {
    return resolveMcpServers({
      env: this.env,
      config: this.config,
      runtime: this.runtime,
      includeUnauthenticated: this.includeUnauthenticated,
      trustCustomServers: this.trustCustomServers,
      configPath: this.configPath,
    });
  }

  catalog() {
    return summarizeTools(this.tools());
  }

  private agentOptions(
    mcpServers: Record<string, McpServerConfig>,
    apiKey: string,
  ): AgentOptions {
    return {
      apiKey,
      model: { id: this.model },
      mcpServers,
      ...(this.runtime === "cloud"
        ? {
            cloud: {
              repos: this.cloudRepos(),
              autoCreatePR: this.config.cloud?.autoCreatePR ?? false,
              skipReviewerRequest: this.config.cloud?.skipReviewerRequest ?? true,
            },
          }
        : {
            local: { cwd: this.cwd },
          }),
    };
  }

  private resumeOptions(
    mcpServers: Record<string, McpServerConfig>,
    apiKey: string,
  ): Partial<AgentOptions> {
    return {
      apiKey,
      model: { id: this.model },
      mcpServers,
      ...(this.runtime === "local" ? { local: { cwd: this.cwd } } : {}),
    };
  }

  async prompt(message: string): Promise<MindRunResult> {
    return this.send(message, { stream: false });
  }

  async send(message: string, options: { stream?: boolean; agentId?: string } = {}): Promise<MindRunResult> {
    const apiKey = this.assertReadyToRun(options.agentId ? "resume" : "create");
    const mcpServers = this.mcpServers();
    const createOptions = this.agentOptions(mcpServers, apiKey);
    const resumeOptions = this.resumeOptions(mcpServers, apiKey);

    try {
      const agent = options.agentId
        ? await Agent.resume(options.agentId, resumeOptions)
        : await Agent.create(createOptions);

      try {
        const run = await agent.send(message);
        process.stderr.write(`agent=${agent.agentId} run=${run.id}\n`);

        if (options.stream !== false) {
          await writeAssistantStream(run.stream());
        }

        const result = await run.wait();
        return {
          agentId: agent.agentId,
          runId: run.id,
          status: result.status,
          result: result.result,
          error: result.error,
          tools: toPublicTools(this.tools()),
        };
      } finally {
        await agent[Symbol.asyncDispose]();
      }
    } catch (error) {
      if (error instanceof CursorAgentError) {
        throw new Error(formatStartupError(error));
      }
      throw error;
    }
  }
}

export function createMindCursor(options?: MindCursorOptions): MindCursor {
  return new MindCursor(options);
}
