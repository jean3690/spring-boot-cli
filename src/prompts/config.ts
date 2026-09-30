import * as p from "@clack/prompts";
import {
  searchDependencies,
  isStableBootVersion,
  normalizeBootVersion,
  type ConfigFormat,
  type InitializrMetadata,
  type ProjectConfig,
  type ValueItem,
} from "../api/initializr.js";
import { isValidPropertyKey, parseProperties, parsePropertyLine } from "../properties.js";
import { derivePackageName, isValidArtifactId, isValidGroupId, isValidPackageName } from "../validate.js";
import { parseModules, type MonorepoModule, type ParentProject } from "../monorepo.js";

export interface CliFlags {
  type?: string;
  language?: string;
  boot?: string;
  java?: string;
  group?: string;
  artifact?: string;
  name?: string;
  description?: string;
  packageName?: string;
  packaging?: string;
  deps?: string;
  configFormat?: string;
  set?: string[];
  /** `--modules` spec: "api,core" or "api:web;core:jdbc,data-jpa". */
  modules?: string;
}

function toOptions(values: ValueItem[]): { value: string; label: string; hint?: string }[] {
  return values.map((v) => ({
    value: v.id,
    label: v.name || v.id,
    ...(v.description ? { hint: v.description } : {}),
  }));
}

/** Project types that produce a full archive (excluding build-file-only types). */
function projectTypes(metadata: InitializrMetadata): ValueItem[] {
  return metadata.type.values.filter((v) => v.tags?.format === "project");
}

function handleCancel<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) {
    p.cancel("Operation cancelled.");
    process.exit(0);
  }
  return value as Exclude<T, symbol>;
}

/** Map a dependency id (or name, case-insensitively) to its canonical id. */
export function resolveDependencyIds(input: string[], metadata: InitializrMetadata): {
  ids: string[];
  unknown: string[];
} {
  const byIdOrName = new Map<string, string>();
  for (const group of metadata.dependencies.values) {
    for (const dep of group.values) {
      byIdOrName.set(dep.id.toLowerCase(), dep.id);
      byIdOrName.set(dep.name.toLowerCase(), dep.id);
    }
  }
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const item of input) {
    const key = item.trim().toLowerCase();
    if (!key) continue;
    const id = byIdOrName.get(key);
    if (id && !ids.includes(id)) ids.push(id);
    else if (!id) unknown.push(item.trim());
  }
  return { ids, unknown };
}

/** Values every module in a monorepo inherits from the aggregator. */
export interface SharedConfig {
  type: string;
  language: string;
  bootVersion: string;
  javaVersion: string;
  groupId: string;
}

/**
 * Ask the questions whose answer is shared by a whole monorepo: build tool,
 * language, Boot/Java version and the group id every module inherits.
 */
export async function buildSharedConfig(
  metadata: InitializrMetadata,
  flags: CliFlags,
  nonInteractive = false,
): Promise<SharedConfig> {
  const ask = async <T>(prompt: () => Promise<T>): Promise<T | undefined> =>
    nonInteractive ? undefined : prompt();

  // --- Build tool / project type ---
  const types = projectTypes(metadata);
  const defaultType = types.some((t) => t.id === metadata.type.default)
    ? metadata.type.default
    : (types[0]?.id ?? metadata.type.default);
  const type = flags.type
    ? flags.type
    : handleCancel(
        (await ask(() =>
          p.select({
            message: "Build tool",
            initialValue: defaultType,
            options: toOptions(types),
          }),
        )) ?? defaultType,
      );

  // --- Language ---
  const language =
    flags.language ??
    handleCancel(
      (await ask(() =>
        p.select({
          message: "Language",
          initialValue: metadata.language.default,
          options: toOptions(metadata.language.values),
        }),
      )) ?? metadata.language.default,
    );

  // --- Boot version (stable versions first, snapshots last) ---
  let bootVersion = metadata.bootVersion.default;
  if (flags.boot) {
    bootVersion = flags.boot;
  } else {
    const stable = metadata.bootVersion.values.filter(isStableBootVersion);
    const unstable = metadata.bootVersion.values.filter((v) => !isStableBootVersion(v));
    bootVersion = handleCancel(
      (await ask(() =>
        p.select({
          message: "Spring Boot version",
          initialValue: metadata.bootVersion.default,
          options: [
            ...toOptions(stable),
            ...toOptions(unstable).map((o) => ({
              ...o,
              hint: o.hint ? `${o.hint} (not recommended)` : "(not recommended)",
            })),
          ],
        }),
      )) ?? metadata.bootVersion.default,
    );
  }

  // --- Java version ---
  const javaVersion = flags.java
    ? flags.java
    : handleCancel(
        (await ask(() =>
          p.select({
            message: "Java version",
            initialValue: metadata.javaVersion.default,
            options: toOptions(metadata.javaVersion.values),
          }),
        )) ?? metadata.javaVersion.default,
      );

  // --- Group id ---
  const groupId = flags.group
    ? flags.group
    : handleCancel(
        (await ask(() =>
          p.text({
            message: "Group Id",
            placeholder: "com.example",
            initialValue: "com.example",
            validate: (v) => (isValidGroupId(v ?? "") ? undefined : "Invalid group id, e.g. com.example"),
          }),
        )) ?? "com.example",
      );

  return { type, language, bootVersion, javaVersion, groupId };
}

/** Values supplied per module in a monorepo; unset fields fall back to the shared config. */
export interface ModuleFlags {
  /** Fixed artifact id for this module. */
  artifactId?: string;
  /** Fixed dependency list; an empty array means "explicitly no dependencies". */
  deps?: string[];
  /** Fixed packaging for this module. */
  packaging?: string;
  /** Fixed base package for this module. */
  packageName?: string;
}

/**
 * Build the config for one module on top of the shared values. Anything not
 * provided by {@link moduleFlags} is asked interactively (or falls back to the
 * Initializr default in non-interactive mode).
 */
export async function buildModuleConfig(
  metadata: InitializrMetadata,
  shared: SharedConfig,
  moduleFlags: ModuleFlags = {},
  nonInteractive = false,
  configFormat?: ConfigFormat,
  properties?: string[],
): Promise<ProjectConfig> {
  const ask = async <T>(prompt: () => Promise<T>): Promise<T | undefined> =>
    nonInteractive ? undefined : prompt();

  const artifactId = moduleFlags.artifactId
    ? moduleFlags.artifactId
    : handleCancel(
        (await ask(() =>
          p.text({
            message: "Artifact Id",
            placeholder: "demo",
            initialValue: "demo",
            validate: (v) =>
              isValidArtifactId(v ?? "") ? undefined : "Invalid artifact id, e.g. demo or my-app",
          }),
        )) ?? "demo",
      );

  const suggested = derivePackageName(shared.groupId, artifactId);
  const packageName = moduleFlags.packageName
    ? moduleFlags.packageName
    : handleCancel(
        (await ask(() =>
          p.text({
            message: "Package name",
            placeholder: suggested,
            initialValue: suggested,
            validate: (v) =>
              isValidPackageName(v ?? "") ? undefined : "Invalid package name, e.g. com.example.demo",
          }),
        )) ?? suggested,
      );

  const packaging = moduleFlags.packaging
    ? moduleFlags.packaging
    : handleCancel(
        (await ask(() =>
          p.select({
            message: "Packaging",
            initialValue: metadata.packaging.default,
            options: toOptions(metadata.packaging.values),
          }),
        )) ?? metadata.packaging.default,
      );

  let dependencies: string[];
  if (moduleFlags.deps) {
    dependencies = moduleFlags.deps;
  } else {
    // Category is part of the label so it is always visible and searchable:
    // typing a category name (e.g. "sql") lists that whole category.
    const options = searchDependencies(metadata, "").map(({ group, dep }) => ({
      value: dep.id,
      label: `${group} · ${dep.name}`,
      ...(dep.description ? { hint: dep.description } : {}),
    }));
    dependencies = handleCancel(
      (await ask(() =>
        p.autocompleteMultiselect({
          message: "Dependencies (search by name or category, space to toggle, enter to confirm)",
          options,
          required: false,
          maxItems: 12,
        }),
      )) ?? [],
    );
  }

  return {
    type: shared.type,
    language: shared.language,
    bootVersion: shared.bootVersion,
    javaVersion: shared.javaVersion,
    groupId: shared.groupId,
    artifactId,
    name: artifactId,
    description: "Demo project for Spring Boot",
    packageName,
    packaging,
    version: "0.0.1-SNAPSHOT",
    dependencies,
    configFormat: configFormat ?? "properties",
    properties: properties ?? [],
  };
}

/** The aggregator plus every module, as resolved for a monorepo. */
export interface MonorepoConfig {
  parent: ParentProject;
  modules: Array<{ spec: MonorepoModule; config: ProjectConfig }>;
  configFormat: ConfigFormat;
  properties: string[];
}

/** Resolve `--set key=value` flags into validated "key=value" strings. */
function collectSetFlags(flags: CliFlags): string[] {
  const fromFlags: string[] = [];
  for (const raw of flags.set ?? []) {
    const entry = parsePropertyLine(raw);
    if (!entry) {
      p.log.warn(`Ignoring invalid --set value "${raw}" (expected key=value).`);
      continue;
    }
    if (!isValidPropertyKey(entry.key)) {
      p.log.warn(`Ignoring --set with invalid property key "${entry.key}".`);
      continue;
    }
    fromFlags.push(`${entry.key}=${entry.value}`);
  }
  return fromFlags;
}

/** Resolve --config-format, warning once when the value is not recognised. */
function resolveConfigFormat(flag: string | undefined): ConfigFormat {
  const requested = flag?.toLowerCase();
  if (requested && requested !== "properties" && requested !== "yml") {
    p.log.warn(`Unknown --config-format "${flag}", using properties.`);
  }
  return requested === "yml" ? "yml" : "properties";
}

/** Ask which config file format the modules should use (asked once per monorepo). */
async function askConfigFormat(defaultFormat: ConfigFormat, nonInteractive: boolean): Promise<ConfigFormat> {
  if (nonInteractive) return defaultFormat;
  return handleCancel(
    await p.select<ConfigFormat>({
      message: "Config file format (applies to every module)",
      initialValue: defaultFormat,
      options: [
        { value: "properties", label: "application.properties" },
        { value: "yml", label: "application.yml" },
      ],
    }),
  );
}

/** Ask for extra application.* entries, prefilled with any --set flags. */
async function askCustomProperties(
  configFormat: ConfigFormat,
  fromFlags: string[],
  nonInteractive: boolean,
): Promise<string[]> {
  if (nonInteractive) return fromFlags;

  const fileName = configFormat === "yml" ? "application.yml" : "application.properties";
  const addCustom = handleCancel(
    await p.confirm({
      message: `Add custom ${fileName} entries? (Enter to skip)`,
      initialValue: false,
    }),
  );
  if (!addCustom) return fromFlags;

  const input = handleCancel(
    await p.multiline({
      message: `Enter ${fileName} entries (key=value per line)`,
      placeholder: "server.port=8080",
      initialValue: fromFlags.join("\n"),
      validate: (value) => {
        for (const line of (value ?? "").split("\n")) {
          if (!line.trim()) continue;
          const entry = parsePropertyLine(line);
          if (!entry) return `Invalid line "${line.trim()}" — expected key=value`;
          if (!isValidPropertyKey(entry.key)) return `Invalid property key "${entry.key}"`;
        }
        return undefined;
      },
    }),
  );
  return (input ?? "").trim() === "" ? fromFlags : parseProperties(input).map((e) => `${e.key}=${e.value}`);
}

/**
 * Collect the module list for a monorepo.
 *
 * `--modules` supplies the whole list up front; interactively each module is
 * entered one at a time and the loop continues until the user says stop.
 */
export async function collectModules(
  flags: CliFlags,
  nonInteractive: boolean,
): Promise<MonorepoModule[]> {
  if (flags.modules) {
    return parseModules(flags.modules);
  }

  if (nonInteractive) {
    throw new Error(
      "Non-interactive mode needs a module list. Pass --modules api,core (or `sbc create <dir> -d web` for a single project).",
    );
  }

  const modules: MonorepoModule[] = [];
  const seen = new Set<string>();
  let index = 1;
  for (;;) {
    const raw = handleCancel(
      await p.text({
        message: `Module ${index} path (relative to the monorepo root, e.g. api or services/user-service)`,
        placeholder: "api",
        initialValue: modules.length === 0 ? "api" : "",
        validate: (v) => {
          const value = (v ?? "").trim();
          if (!value) return "Module path is required";
          try {
            // A single entry may list several modules, so every one is checked.
            for (const spec of parseModules(value)) {
              if (seen.has(spec.path)) return `"${spec.path}" was already added`;
            }
            return undefined;
          } catch (err) {
            return err instanceof Error ? err.message : "Invalid module path";
          }
        },
      }),
    );

    // A comma/semicolon separated entry is a convenient way to add several at once.
    for (const spec of parseModules(raw.trim())) {
      if (seen.has(spec.path)) continue;
      seen.add(spec.path);
      modules.push(spec);
    }
    index += 1;

    const more = handleCancel(
      await p.confirm({ message: "Add another module?", initialValue: true }),
    );
    if (!more) break;
  }

  if (modules.length === 0) {
    throw new Error("A monorepo needs at least one module.");
  }
  return modules;
}

/**
 * Build the full monorepo plan: one aggregator plus the config for every
 * module, all sharing a single build tool, language, Boot/Java version and
 * group id.
 */
export async function buildMonorepoConfig(
  metadata: InitializrMetadata,
  flags: CliFlags,
  nonInteractive = false,
): Promise<MonorepoConfig> {
  const shared = await buildSharedConfig(metadata, flags, nonInteractive);
  const specs = await collectModules(flags, nonInteractive);

  const defaultFormat = resolveConfigFormat(flags.configFormat);
  const configFormat = await askConfigFormat(defaultFormat, nonInteractive);
  const setFlags = collectSetFlags(flags);
  const properties = await askCustomProperties(configFormat, setFlags, nonInteractive);

  // --deps is the default for modules that do not declare their own list.
  const sharedDeps = flags.deps
    ? resolveDependencyIds(flags.deps.split(/[\s,]+/).filter(Boolean), metadata).ids
    : undefined;
  if (flags.deps) {
    const { unknown } = resolveDependencyIds(flags.deps.split(/[\s,]+/).filter(Boolean), metadata);
    if (unknown.length > 0) {
      p.log.warn(`Unknown dependencies ignored: ${unknown.join(", ")}`);
    }
  }

  const artifactId = flags.artifact
    ? flags.artifact
    : nonInteractive
      ? "monorepo"
      : handleCancel(
          await p.text({
            message: "Root artifact Id",
            placeholder: "my-monorepo",
            initialValue: "my-monorepo",
            validate: (v) =>
              isValidArtifactId(v ?? "") ? undefined : "Invalid artifact id, e.g. my-monorepo",
          }),
        );

  const modules: MonorepoConfig["modules"] = [];
  for (const spec of specs) {
    // A module's own list wins over --deps, and is validated against the
    // registry's metadata exactly like --deps is.
    let deps = sharedDeps;
    if (spec.dependencies !== undefined) {
      const resolved = resolveDependencyIds(spec.dependencies, metadata);
      if (resolved.unknown.length > 0) {
        p.log.warn(
          `Unknown dependencies ignored for module "${spec.path}": ${resolved.unknown.join(", ")}`,
        );
      }
      deps = resolved.ids;
    }

    const config = await buildModuleConfig(
      metadata,
      shared,
      { artifactId: spec.artifactId, ...(deps ? { deps } : {}) },
      nonInteractive,
      configFormat,
      properties,
    );
    modules.push({ spec, config });
  }

  const parent: ParentProject = {
    groupId: shared.groupId,
    artifactId,
    version: "0.0.1-SNAPSHOT",
    name: flags.name ?? artifactId,
    description: flags.description ?? `Monorepo aggregating ${modules.length} module(s)`,
    javaVersion: shared.javaVersion,
    // The aggregator pins spring-boot-starter-parent itself, so its version has
    // to be a coordinate that exists — not the registry's display form.
    bootVersion: normalizeBootVersion(shared.bootVersion),
  };

  return { parent, modules, configFormat, properties };
}

/**
 * Build the project config. Flags act as prefills: values already provided
 * via CLI flags are not asked again interactively. In non-interactive mode
 * every remaining value falls back to the Initializr default.
 */
export async function buildConfig(
  metadata: InitializrMetadata,
  flags: CliFlags,
  nonInteractive = false,
): Promise<ProjectConfig> {
  const shared = await buildSharedConfig(metadata, flags, nonInteractive);
  const config = await buildModuleConfig(
    metadata,
    shared,
    {
      ...(flags.artifact ? { artifactId: flags.artifact } : {}),
      ...(flags.packaging ? { packaging: flags.packaging } : {}),
      ...(flags.packageName ? { packageName: flags.packageName } : {}),
    },
    nonInteractive,
  );
  if (flags.deps) {
    const { ids, unknown } = resolveDependencyIds(
      flags.deps.split(/[\s,]+/).filter(Boolean),
      metadata,
    );
    if (unknown.length > 0) {
      p.log.warn(`Unknown dependencies ignored: ${unknown.join(", ")}`);
    }
    config.dependencies = ids;
  }

  const defaultFormat = resolveConfigFormat(flags.configFormat);
  config.configFormat = await askConfigFormat(defaultFormat, nonInteractive);
  config.properties = await askCustomProperties(config.configFormat, collectSetFlags(flags), nonInteractive);

  if (flags.name) {
    config.name = flags.name;
  }
  if (flags.description) {
    config.description = flags.description;
  }

  return config;
}
