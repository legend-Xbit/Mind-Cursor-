import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ConfigSource, LoadedConfig, MindCursorConfig, RuntimeKind } from "./types.ts";

const ENV_PATTERN = /\$\{([A-Z0-9_]+)\}/g;

export function interpolateEnv(value: string, env: NodeJS.ProcessEnv = process.env): string {
  return value.replace(ENV_PATTERN, (_, name: string) => env[name] ?? "");
}

export function interpolateUnknown(value: unknown, env: NodeJS.ProcessEnv = process.env): unknown {
  if (typeof value === "string") {
    return interpolateEnv(value, env);
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateUnknown(item, env));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = interpolateUnknown(nested, env);
    }
    return out;
  }
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseConfig(raw: unknown): MindCursorConfig {
  if (!isRecord(raw)) {
    throw new Error("mind-cursor config must be a JSON object");
  }
  return raw as MindCursorConfig;
}

export type LoadConfigOptions = {
  /** Explicit config path (from `--config`, `configPath`, or similar). Takes priority over `env.MIND_CURSOR_CONFIG`. */
  path?: string;
  env?: NodeJS.ProcessEnv;
};

/**
 * Load and interpolate the mind-cursor config file, reporting provenance.
 *
 * The path is resolved as: `options.path` (explicit) → `env.MIND_CURSOR_CONFIG`
 * (explicit) → `./mind-cursor.config.json` (discovered by scanning the
 * working directory). When the path was given explicitly and the file is
 * missing, this throws — a typo'd `MIND_CURSOR_CONFIG` should fail loudly,
 * not silently fall back to defaults. When the path was only discovered and
 * is missing, an empty config with `source: "none"` is returned.
 *
 * `source` distinguishes "explicit" from "discovered": callers use it to
 * decide whether `config.customServers` is trustworthy enough to run (see
 * `ResolveOptions.trustCustomServers`).
 */
export function loadConfigFile(options: LoadConfigOptions = {}): LoadedConfig {
  const env = options.env ?? process.env;
  const explicit = options.path ?? env.MIND_CURSOR_CONFIG;
  const source: ConfigSource = explicit ? "explicit" : "discovered";
  const absolute = resolve(explicit ?? "mind-cursor.config.json");
  const dir = dirname(absolute);
  let text: string;
  try {
    text = readFileSync(absolute, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      if (source === "explicit") {
        throw new Error(`config file not found: ${absolute}`);
      }
      return { config: {}, path: absolute, dir, source: "none" };
    }
    throw error;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${absolute}: ${message}`);
  }
  const parsed = parseConfig(raw);
  const config = interpolateUnknown(parsed, env) as MindCursorConfig;
  return { config, path: absolute, dir, source };
}

export function mergeConfig(
  base: MindCursorConfig,
  overlay: Partial<MindCursorConfig> | undefined,
): MindCursorConfig {
  if (!overlay) {
    return { ...base };
  }
  return {
    ...base,
    ...overlay,
    local: { ...base.local, ...overlay.local },
    cloud: { ...base.cloud, ...overlay.cloud },
    customServers: { ...base.customServers, ...overlay.customServers },
    enabled: overlay.enabled ?? base.enabled,
    disabled: overlay.disabled ?? base.disabled,
  };
}

export function applyProfile(config: MindCursorConfig, profile?: string): MindCursorConfig {
  if (!profile) {
    return config;
  }
  const overlay = config.profiles?.[profile];
  if (!overlay) {
    throw new Error(`Unknown profile "${profile}". Defined: ${Object.keys(config.profiles ?? {}).join(", ") || "(none)"}`);
  }
  const { profiles: _profiles, ...withoutProfiles } = config;
  return mergeConfig(withoutProfiles, overlay);
}

function nonempty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveModel(config: MindCursorConfig, env: NodeJS.ProcessEnv = process.env): string {
  return nonempty(config.model) ?? nonempty(env.MIND_CURSOR_MODEL) ?? "composer-2.5";
}

export function resolveRuntime(
  config: MindCursorConfig,
  override?: RuntimeKind,
  env: NodeJS.ProcessEnv = process.env,
): RuntimeKind {
  if (override) {
    return override;
  }
  if (config.runtime) {
    return config.runtime;
  }
  if (env.MIND_CURSOR_RUNTIME === "cloud" || env.MIND_CURSOR_RUNTIME === "local") {
    return env.MIND_CURSOR_RUNTIME;
  }
  return "local";
}
