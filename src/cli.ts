#!/usr/bin/env node
import { applyProfile, loadConfigFile, resolveModel, resolveRuntime } from "./config.ts";
import { inspectAll, resolveMcpServers, summarizeTools } from "./mcp/registry.ts";
import { redactServer, redactTool } from "./redact.ts";
import { EXIT_OK, EXIT_STARTUP_FAILED, exitCodeForStatus, formatStartupError } from "./sdk/errors.ts";
import type { RuntimeKind } from "./types.ts";
import { LAYER_VERSION } from "./version.ts";

type Flags = {
  command: string;
  args: string[];
  runtime?: RuntimeKind;
  profile?: string;
  model?: string;
  configPath?: string;
  stream: boolean;
  /** Undefined unless --include-unauthenticated is passed, so it falls through to config.includeUnauthenticated instead of clobbering it with a hardcoded false. */
  includeUnauthenticated?: boolean;
  json: boolean;
  trustConfig: boolean;
  revealSecrets: boolean;
};

function usage(): string {
  return `mind-cursor ${LAYER_VERSION}

Usage:
  mind-cursor list [--profile name] [--config path] [--json] [--reveal-secrets]
  mind-cursor resolve [--profile name] [--config path] [--runtime local|cloud] [--include-unauthenticated] [--trust-config] [--reveal-secrets]
  mind-cursor run "<prompt>" [--runtime local|cloud] [--profile name] [--config path] [--model id] [--no-stream] [--trust-config]
  mind-cursor resume <agentId> "<prompt>" [--runtime local|cloud] [--profile name] [--config path] [--trust-config]
  mind-cursor serve

Flags:
  --config path              explicit mind-cursor.config.json path (also trusts its customServers)
  --trust-config              trust customServers from a config file discovered in cwd
  --reveal-secrets            print raw tokens/headers instead of redacted key names (list/resolve only)
  --include-unauthenticated   attach HTTP/SSE servers that have a URL but no token

Environment:
  CURSOR_API_KEY          required for run / resume
  MIND_CURSOR_CONFIG      path to mind-cursor.config.json (same as --config)
  MIND_CURSOR_TRUST_CONFIG=1  same as --trust-config

Exit codes (run / resume): 0 finished, 1 startup failed, 2 run failed, 3 run cancelled.
`;
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = {
    command: argv[0] ?? "help",
    args: [],
    stream: true,
    json: false,
    trustConfig: false,
    revealSecrets: false,
  };

  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (token === "--runtime") {
      const value = argv[++i];
      if (value !== "local" && value !== "cloud") {
        throw new Error("--runtime must be local or cloud");
      }
      flags.runtime = value;
    } else if (token === "--profile") {
      flags.profile = argv[++i];
    } else if (token === "--model") {
      flags.model = argv[++i];
    } else if (token === "--config") {
      flags.configPath = argv[++i];
    } else if (token === "--no-stream") {
      flags.stream = false;
    } else if (token === "--include-unauthenticated") {
      flags.includeUnauthenticated = true;
    } else if (token === "--trust-config") {
      flags.trustConfig = true;
    } else if (token === "--reveal-secrets") {
      flags.revealSecrets = true;
    } else if (token === "--json") {
      flags.json = true;
    } else if (token === "--help" || token === "-h") {
      flags.command = "help";
    } else {
      flags.args.push(token);
    }
  }
  return flags;
}

function print(value: unknown, asJson: boolean): void {
  if (asJson || typeof value !== "string") {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${value}\n`);
}

async function main(): Promise<number> {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.command === "help" || flags.command === "--help") {
    process.stdout.write(usage());
    return EXIT_OK;
  }

  if (flags.command === "serve") {
    const { serveMindCursorMcp } = await import("./mcp/server.ts");
    await serveMindCursorMcp();
    return EXIT_OK;
  }

  const loaded = loadConfigFile({ path: flags.configPath });
  const config = applyProfile(loaded.config, flags.profile);
  const runtime = resolveRuntime(config, flags.runtime);
  const trustCustomServers =
    loaded.source === "explicit" || flags.trustConfig || process.env.MIND_CURSOR_TRUST_CONFIG === "1";

  if (flags.command === "list") {
    const tools = inspectAll({ config, runtime, trustCustomServers, configPath: loaded.path });
    const view = flags.revealSecrets ? tools : tools.map(redactTool);
    if (flags.json) {
      print({ version: LAYER_VERSION, model: resolveModel(config), runtime, ...summarizeTools(tools), tools: view }, true);
    } else {
      for (const tool of tools) {
        const mark =
          tool.status === "ready"
            ? "ready"
            : tool.status === "needs_auth"
              ? "auth"
              : tool.status === "needs_config"
                ? "config"
                : "off";
        process.stdout.write(`${tool.id.padEnd(10)} ${mark.padEnd(7)} ${tool.title} — ${tool.reason ?? tool.description}\n`);
      }
    }
    return EXIT_OK;
  }

  if (flags.command === "resolve") {
    const servers = resolveMcpServers({
      config,
      runtime,
      includeUnauthenticated: flags.includeUnauthenticated,
      trustCustomServers,
      configPath: loaded.path,
    });
    const view = flags.revealSecrets
      ? servers
      : Object.fromEntries(Object.entries(servers).map(([id, server]) => [id, redactServer(server)]));
    if (flags.revealSecrets) {
      process.stderr.write("warning: printing raw tokens and headers (--reveal-secrets)\n");
    }
    print({ runtime, model: resolveModel(config), servers: view }, true);
    return EXIT_OK;
  }

  if (flags.command === "run" || flags.command === "resume") {
    const { createMindCursor } = await import("./sdk/client.ts");
    const prompt =
      flags.command === "resume" ? flags.args.slice(1).join(" ") : flags.args.join(" ");
    const agentId = flags.command === "resume" ? flags.args[0] : undefined;
    if (!prompt || (flags.command === "resume" && !agentId)) {
      process.stderr.write(usage());
      return EXIT_STARTUP_FAILED;
    }

    const layer = createMindCursor({
      profile: flags.profile,
      runtime: flags.runtime,
      model: flags.model,
      configPath: flags.configPath,
      includeUnauthenticated: flags.includeUnauthenticated,
      trustConfig: flags.trustConfig,
    });

    process.stderr.write(
      `runtime=${layer.runtime} model=${layer.model} mcp=${Object.keys(layer.mcpServers()).join(",") || "(none)"}\n`,
    );

    const result =
      flags.command === "resume"
        ? await layer.send(prompt, { agentId, stream: flags.stream })
        : flags.stream
          ? await layer.send(prompt, { stream: true })
          : await layer.prompt(prompt);

    if (!flags.stream && result.result != null) {
      print(result.result, typeof result.result !== "string");
    } else {
      process.stdout.write("\n");
    }
    process.stderr.write(`status=${result.status} agent=${result.agentId} run=${result.runId ?? ""}\n`);
    return exitCodeForStatus(result.status);
  }

  process.stderr.write(usage());
  return EXIT_STARTUP_FAILED;
}

main()
  .then((code) => {
    if (process.argv[2] === "serve") {
      return;
    }
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`${formatStartupError(error)}\n`);
    process.exitCode = EXIT_STARTUP_FAILED;
  });
