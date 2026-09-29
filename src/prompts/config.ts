import * as p from "@clack/prompts";
import {
  searchDependencies,
  isStableBootVersion,
  type ConfigFormat,
  type InitializrMetadata,
  type ProjectConfig,
  type ValueItem,
} from "../api/initializr.js";
import { isValidPropertyKey, parseProperties, parsePropertyLine } from "../properties.js";
import { derivePackageName, isValidArtifactId, isValidGroupId, isValidPackageName } from "../validate.js";

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
  const config: ProjectConfig = {
    type: "",
    language: "",
    bootVersion: "",
    javaVersion: "",
    groupId: "com.example",
    artifactId: "demo",
    name: "demo",
    description: "Demo project for Spring Boot",
    packageName: "",
    packaging: metadata.packaging.default,
    version: "0.0.1-SNAPSHOT",
    dependencies: [],
    configFormat: "properties",
    properties: [],
  };

  const ask = async <T>(prompt: () => Promise<T>): Promise<T | undefined> =>
    nonInteractive ? undefined : prompt();

  // --- Build tool / project type ---
  const types = projectTypes(metadata);
  const defaultType = types.some((t) => t.id === metadata.type.default)
    ? metadata.type.default
    : (types[0]?.id ?? metadata.type.default);
  if (flags.type) {
    config.type = flags.type;
  } else {
    config.type = handleCancel(
      (await ask(() =>
        p.select({
          message: "Build tool",
          initialValue: defaultType,
          options: toOptions(types),
        }),
      )) ?? defaultType,
    );
  }

  // --- Language ---
  config.language =
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
  if (flags.boot) {
    config.bootVersion = flags.boot;
  } else {
    const stable = metadata.bootVersion.values.filter(isStableBootVersion);
    const unstable = metadata.bootVersion.values.filter((v) => !isStableBootVersion(v));
    config.bootVersion = handleCancel(
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
  if (flags.java) {
    config.javaVersion = flags.java;
  } else {
    config.javaVersion = handleCancel(
      (await ask(() =>
        p.select({
          message: "Java version",
          initialValue: metadata.javaVersion.default,
          options: toOptions(metadata.javaVersion.values),
        }),
      )) ?? metadata.javaVersion.default,
    );
  }

  // --- Project coordinates ---
  if (flags.group) {
    config.groupId = flags.group;
  } else {
    config.groupId = handleCancel(
      (await ask(() =>
        p.text({
          message: "Group Id",
          placeholder: "com.example",
          initialValue: "com.example",
          validate: (v) => (isValidGroupId(v ?? "") ? undefined : "Invalid group id, e.g. com.example"),
        }),
      )) ?? "com.example",
    );
  }

  if (flags.artifact) {
    config.artifactId = flags.artifact;
  } else {
    config.artifactId = handleCancel(
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
  }

  config.name = flags.name ?? config.artifactId;
  if (flags.description) {
    config.description = flags.description;
  }

  if (flags.packageName) {
    config.packageName = flags.packageName;
  } else {
    const suggested = derivePackageName(config.groupId, config.artifactId);
    config.packageName = handleCancel(
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
  }

  if (flags.packaging) {
    config.packaging = flags.packaging;
  } else {
    config.packaging = handleCancel(
      (await ask(() =>
        p.select({
          message: "Packaging",
          initialValue: metadata.packaging.default,
          options: toOptions(metadata.packaging.values),
        }),
      )) ?? metadata.packaging.default,
    );
  }

  // --- Dependencies ---
  if (flags.deps) {
    const { ids, unknown } = resolveDependencyIds(
      flags.deps.split(/[\s,]+/).filter(Boolean),
      metadata,
    );
    if (unknown.length > 0) {
      p.log.warn(`Unknown dependencies ignored: ${unknown.join(", ")}`);
    }
    config.dependencies = ids;
  } else {
    // Category is part of the label so it is always visible and searchable:
    // typing a category name (e.g. "sql") lists that whole category.
    const options = searchDependencies(metadata, "").map(({ group, dep }) => ({
      value: dep.id,
      label: `${group} · ${dep.name}`,
      ...(dep.description ? { hint: dep.description } : {}),
    }));
    config.dependencies = handleCancel(
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

  // --- Config file format & custom properties ---
  const requestedFormat = flags.configFormat?.toLowerCase();
  if (requestedFormat && requestedFormat !== "properties" && requestedFormat !== "yml") {
    p.log.warn(`Unknown --config-format "${flags.configFormat}", using properties.`);
  }
  const defaultFormat: ConfigFormat = requestedFormat === "yml" ? "yml" : "properties";

  config.configFormat = nonInteractive
    ? defaultFormat
    : handleCancel(
        await p.select<ConfigFormat>({
          message: "Config file format",
          initialValue: defaultFormat,
          options: [
            { value: "properties", label: "application.properties" },
            { value: "yml", label: "application.yml" },
          ],
        }),
      );

  // Entries passed via repeated --set key=value flags.
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

  if (nonInteractive) {
    config.properties = fromFlags;
  } else {
    const fileName = config.configFormat === "yml" ? "application.yml" : "application.properties";
    const addCustom = handleCancel(
      await p.confirm({
        message: `Add custom ${fileName} entries? (Enter to skip)`,
        initialValue: false,
      }),
    );
    if (addCustom) {
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
      config.properties =
        (input ?? "").trim() === ""
          ? fromFlags
          : parseProperties(input).map((e) => `${e.key}=${e.value}`);
    } else {
      config.properties = fromFlags;
    }
  }

  return config;
}
