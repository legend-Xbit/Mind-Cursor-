import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MindCursorConfig, RuntimeKind } from "./types.ts";

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

export function loadConfigFile(
  path = process.env.MIND_CURSOR_CONFIG ?? "mind-cursor.config.json",
  env: NodeJS.ProcessEnv = process.env,
): MindCursorConfig {
  const absolute = resolve(path);
  let text: string;
  try {
    text = readFileSync(absolute, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {};
    }
    throw error;
  }
  const parsed = parseConfig(JSON.parse(text));
  return interpolateUnknown(parsed, env) as MindCursorConfig;
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

export function resolveModel(config: MindCursorConfig, env: NodeJS.ProcessEnv = process.env): string {
  return config.model ?? env.MIND_CURSOR_MODEL ?? "composer-2.5";
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
