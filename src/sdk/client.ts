import { Agent, CursorAgentError, type AgentOptions } from "@cursor/sdk";
import { applyProfile, loadConfigFile, resolveModel, resolveRuntime } from "../config.ts";
import { inspectAll, resolveMcpServers, summarizeTools } from "../mcp/registry.ts";
import type { McpServerConfig, MindCursorConfig, ResolvedTool, RuntimeKind } from "../types.ts";
import { formatStartupError } from "./errors.ts";
import { writeAssistantStream } from "./run.ts";

export type MindCursorOptions = {
  apiKey?: string;
  config?: MindCursorConfig;
  configPath?: string;
  profile?: string;
  runtime?: RuntimeKind;
  model?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  includeUnauthenticated?: boolean;
  stream?: boolean;
};

export type MindRunResult = {
  agentId: string;
  runId?: string;
  status: string;
  result?: unknown;
  tools: ResolvedTool[];
};

function requireApiKey(options: MindCursorOptions, env: NodeJS.ProcessEnv): string {
  const key = (options.apiKey ?? env.CURSOR_API_KEY)?.trim();
  if (!key) {
    throw new Error("CURSOR_API_KEY is required. Pass apiKey or set the environment variable.");
  }
  return key;
}

export class MindCursor {
  readonly config: MindCursorConfig;
  readonly runtime: RuntimeKind;
  readonly model: string;
  readonly apiKey: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly includeUnauthenticated: boolean;

  constructor(options: MindCursorOptions = {}) {
    this.env = options.env ?? process.env;
    const loaded = options.config ?? loadConfigFile(options.configPath, this.env);
    this.config = applyProfile(loaded, options.profile);
    this.runtime = resolveRuntime(this.config, options.runtime, this.env);
    this.model = options.model ?? resolveModel(this.config, this.env);
    this.apiKey = requireApiKey(options, this.env);
    this.cwd = options.cwd ?? this.config.local?.cwd ?? process.cwd();
    this.includeUnauthenticated =
      options.includeUnauthenticated ?? this.config.includeUnauthenticated ?? false;
  }

  tools(): ResolvedTool[] {
    return inspectAll({
      env: this.env,
      config: this.config,
      runtime: this.runtime,
      includeUnauthenticated: this.includeUnauthenticated,
    });
  }

  mcpServers(): Record<string, McpServerConfig> {
    return resolveMcpServers({
      env: this.env,
      config: this.config,
      runtime: this.runtime,
      includeUnauthenticated: this.includeUnauthenticated,
    });
  }

  catalog() {
    return summarizeTools(this.tools());
  }

  private agentOptions(mcpServers: Record<string, McpServerConfig>): AgentOptions {
    const cloudRepos =
      this.config.cloud?.repos ??
      (this.env.MIND_CURSOR_REPO_URL
        ? [
            {
              url: this.env.MIND_CURSOR_REPO_URL,
              startingRef: this.env.MIND_CURSOR_STARTING_REF ?? "main",
            },
          ]
        : []);

    return {
      apiKey: this.apiKey,
      model: { id: this.model },
      mcpServers,
      ...(this.runtime === "cloud"
        ? {
            cloud: {
              repos: cloudRepos,
              autoCreatePR: this.config.cloud?.autoCreatePR ?? false,
              skipReviewerRequest: this.config.cloud?.skipReviewerRequest ?? true,
            },
          }
        : {
            local: { cwd: this.cwd },
          }),
    };
  }

  async prompt(message: string): Promise<MindRunResult> {
    return this.send(message, { stream: false });
  }

  async send(message: string, options: { stream?: boolean; agentId?: string } = {}): Promise<MindRunResult> {
    const mcpServers = this.mcpServers();
    const agentOptions = this.agentOptions(mcpServers);

    try {
      const agent = options.agentId
        ? await Agent.resume(options.agentId, {
            apiKey: this.apiKey,
            model: { id: this.model },
            mcpServers,
            ...(this.runtime === "local" ? { local: { cwd: this.cwd } } : {}),
          })
        : await Agent.create(agentOptions);

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
          tools: this.tools(),
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
