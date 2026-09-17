#!/usr/bin/env node
import { applyProfile, loadConfigFile, resolveModel, resolveRuntime } from "./config.ts";
import { redactMcpServers, toPublicTools } from "./mcp/redact.ts";
import { inspectAll, resolveMcpServers, summarizeTools } from "./mcp/registry.ts";
import { EXIT_OK, EXIT_RUN_FAILED, EXIT_STARTUP_FAILED, formatStartupError } from "./sdk/errors.ts";
import type { RuntimeKind } from "./types.ts";
import { LAYER_VERSION } from "./version.ts";

type Flags = {
  command: string;
  args: string[];
  runtime?: RuntimeKind;
  profile?: string;
  model?: string;
  stream: boolean;
  includeUnauthenticated: boolean;
  json: boolean;
};

function usage(): string {
  return `mind-cursor ${LAYER_VERSION}

Usage:
  mind-cursor list [--profile name] [--json]
  mind-cursor resolve [--profile name] [--runtime local|cloud] [--include-unauthenticated]
  mind-cursor run "<prompt>" [--runtime local|cloud] [--profile name] [--model id] [--no-stream]
  mind-cursor resume <agentId> "<prompt>" [--runtime local|cloud] [--profile name]
  mind-cursor serve

Environment:
  CURSOR_API_KEY     required for run / resume
  MIND_CURSOR_CONFIG path to mind-cursor.config.json
`;
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = {
    command: argv[0] ?? "help",
    args: [],
    stream: true,
    includeUnauthenticated: false,
    json: false,
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
    } else if (token === "--no-stream") {
      flags.stream = false;
    } else if (token === "--include-unauthenticated") {
      flags.includeUnauthenticated = true;
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

  const loaded = applyProfile(loadConfigFile(), flags.profile);
  const runtime = resolveRuntime(loaded, flags.runtime);

  if (flags.command === "list") {
    const tools = inspectAll({ config: loaded, runtime });
    if (flags.json) {
      print(
        {
          version: LAYER_VERSION,
          model: resolveModel(loaded),
          runtime,
          ...summarizeTools(tools),
          tools: toPublicTools(tools),
        },
        true,
      );
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
      config: loaded,
      runtime,
      includeUnauthenticated: flags.includeUnauthenticated,
    });
    print({ runtime, model: resolveModel(loaded), servers: redactMcpServers(servers) }, true);
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
      includeUnauthenticated: flags.includeUnauthenticated,
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
    return result.status === "error" ? EXIT_RUN_FAILED : EXIT_OK;
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
