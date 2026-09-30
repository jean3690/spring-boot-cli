/**
 * Persistent CLI configuration (`sbc.config.json`).
 *
 * Resolution order, highest priority first:
 *   1. the `--registry` command line flag
 *   2. the `SBC_REGISTRY` environment variable
 *   3. the nearest `sbc.config.json` walking up from the target directory
 *   4. the built-in default (start.spring.io)
 *
 * Like the workspace manifest, the file is looked up by walking up the
 * directory tree so a monorepo root can pin the registry for every module.
 */
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isRegistryId, isRegistryUrl, resolveRegistry, type Registry } from "./api/registry.js";

export const CONFIG_FILE = "sbc.config.json";
const CONFIG_VERSION = 1;

export interface SbcConfig {
  version: number;
  /** Registry id ("spring" | "aliyun") or an explicit Initializr base URL. */
  registry?: string;
}

export interface LoadedConfig {
  /** Absolute path of the file the values came from, or null when none exists. */
  file: string | null;
  /** Directory the lookup started from. */
  dir: string;
  config: SbcConfig;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Walk up from `startDir` to the nearest directory containing a config file. */
export async function findConfigFile(startDir: string): Promise<string | null> {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, CONFIG_FILE);
    if (await exists(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function parseConfig(raw: string, file: string): SbcConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `${file} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${file} must contain a JSON object.`);
  }
  const obj = parsed as Partial<SbcConfig>;
  if (obj.registry !== undefined && typeof obj.registry !== "string") {
    throw new Error(`${file}: "registry" must be a string.`);
  }
  return { version: obj.version ?? CONFIG_VERSION, registry: obj.registry };
}

/** Load the nearest config file walking up from `startDir`, if any. */
export async function loadConfig(startDir: string): Promise<LoadedConfig> {
  const dir = resolve(startDir);
  const file = await findConfigFile(dir);
  if (!file) return { file: null, dir, config: { version: CONFIG_VERSION } };
  return { file, dir: dirname(file), config: parseConfig(await readFile(file, "utf8"), file) };
}

export async function writeConfig(dir: string, config: SbcConfig): Promise<string> {
  const target = resolve(dir);
  const file = join(target, CONFIG_FILE);
  const body = `${JSON.stringify({ ...config, version: CONFIG_VERSION }, null, 2)}\n`;
  await writeFile(file, body);
  return file;
}

export interface RegistrySource {
  registry: Registry;
  /** Where the choice came from, for display: flag / env / config / default. */
  origin: "flag" | "env" | "config" | "default";
  /** Config file the value was read from, when origin is "config". */
  file?: string;
}

/**
 * Resolve the registry to use. An explicit `--registry` wins, then the
 * environment, then the config file, then the built-in default.
 *
 * A flag or env value that cannot be resolved is an error; a config file with
 * a bad value warns and falls back to the default so a stale file never blocks
 * scaffolding.
 */
export async function resolveRegistryFor(
  startDir: string,
  flagValue?: string,
  env: NodeJS.ProcessEnv = process.env,
  warn: (message: string) => void = () => {},
): Promise<RegistrySource> {
  const explicit = flagValue ?? env.SBC_REGISTRY;
  if (explicit !== undefined) {
    return {
      registry: resolveRegistry(explicit),
      origin: flagValue !== undefined ? "flag" : "env",
    };
  }

  const loaded = await loadConfig(startDir);
  const configured = loaded.config.registry;
  if (configured) {
    try {
      return {
        registry: resolveRegistry(configured),
        origin: "config",
        file: loaded.file ?? undefined,
      };
    } catch (err) {
      warn(err instanceof Error ? err.message : String(err));
    }
  }

  return { registry: resolveRegistry(undefined), origin: "default" };
}

/** Validate a registry reference for `sbc config set registry <value>`. */
export function assertSettableRegistry(value: string): Registry {
  if (isRegistryId(value.trim()) || isRegistryUrl(value)) return resolveRegistry(value);
  throw new Error(
    `Unknown registry "${value}". Use ${["spring", "aliyun"].join(" or ")}, or a full Initializr URL.`,
  );
}
