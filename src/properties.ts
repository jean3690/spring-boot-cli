import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ConfigFormat } from "./api/initializr.js";

const RESOURCES_DIR = join("src", "main", "resources");

export interface PropertyEntry {
  key: string;
  value: string;
}

/** Parse a "key=value" line. Returns null for blank lines and comments. */
export function parsePropertyLine(line: string): PropertyEntry | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) return null;
  const sep = trimmed.indexOf("=");
  if (sep <= 0) return null;
  const key = trimmed.slice(0, sep).trim();
  const value = trimmed.slice(sep + 1).trim();
  if (!key) return null;
  return { key, value };
}

export function parseProperties(input: string): PropertyEntry[] {
  return input
    .split(/\r?\n/)
    .map(parsePropertyLine)
    .filter((e): e is PropertyEntry => e !== null);
}

/** Keys must look like `server.port` / `spring.datasource.url`. */
export function isValidPropertyKey(key: string): boolean {
  return /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(key);
}

interface YamlNode {
  children: Map<string, YamlNode>;
  value?: string;
}

function insertYamlPath(root: YamlNode, key: string, value: string): void {
  const parts = key.split(".").filter(Boolean);
  let node = root;
  for (const part of parts.slice(0, -1)) {
    const existing = node.children.get(part);
    if (existing && existing.value !== undefined && existing.children.size === 0) {
      // A scalar already occupies this path; a nested value takes precedence.
      existing.value = undefined;
    }
    const child = existing ?? { children: new Map<string, YamlNode>() };
    node.children.set(part, child);
    node = child;
  }
  const leaf = parts[parts.length - 1]!;
  node.children.set(leaf, { children: new Map(), value });
}

/** Quote a YAML scalar when it could be misparsed as a number/boolean/special value. */
function formatYamlValue(value: string): string {
  const needsQuotes =
    value === "" ||
    /^\s|\s$/.test(value) ||
    /[:#{}[\],&*?|>%@`"']/.test(value) ||
    /^(true|false|null|yes|no|on|off|~)$/i.test(value) ||
    /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(value);
  if (!needsQuotes) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function serializeYaml(node: YamlNode, indent: number): string[] {
  const pad = " ".repeat(indent);
  const lines: string[] = [];
  for (const [key, child] of node.children) {
    if (child.value !== undefined && child.children.size === 0) {
      lines.push(`${pad}${key}: ${formatYamlValue(child.value)}`);
    } else {
      lines.push(`${pad}${key}:`);
      lines.push(...serializeYaml(child, indent + 2));
    }
  }
  return lines;
}

export function toYaml(entries: PropertyEntry[]): string {
  const root: YamlNode = { children: new Map() };
  for (const { key, value } of entries) {
    insertYamlPath(root, key, value);
  }
  return serializeYaml(root, 0).join("\n") + "\n";
}

export interface ApplyResult {
  file: string;
  written: number;
}

/**
 * Apply the user's properties to the generated project.
 * - properties: append the entries to `application.properties`
 * - yml: convert any existing `application.properties` (Initializr writes the
 *   app name there) plus the entries into `application.yml`, then remove the
 *   properties file so the project does not carry two config files.
 */
export async function applyAppProperties(
  targetDir: string,
  format: ConfigFormat,
  entries: PropertyEntry[],
): Promise<ApplyResult> {
  const resourcesDir = join(targetDir, RESOURCES_DIR);
  const propsFile = join(resourcesDir, "application.properties");
  const ymlFile = join(resourcesDir, "application.yml");
  await mkdir(resourcesDir, { recursive: true });

  if (format === "properties") {
    let existing = "";
    try {
      existing = await readFile(propsFile, "utf8");
    } catch {
      existing = "";
    }
    const prefix = existing.length > 0 && !existing.endsWith("\n") ? existing + "\n" : existing;
    const body = entries.map((e) => `${e.key}=${e.value}`).join("\n");
    await writeFile(propsFile, entries.length > 0 ? `${prefix}${body}\n` : prefix);
    return { file: propsFile, written: entries.length };
  }

  let base: PropertyEntry[] = [];
  try {
    base = parseProperties(await readFile(propsFile, "utf8"));
  } catch {
    base = [];
  }
  // User entries win over the Initializr-generated ones (same key).
  const merged = new Map(base.map((e) => [e.key, e.value]));
  for (const e of entries) merged.set(e.key, e.value);
  const yamlEntries = [...merged].map(([key, value]) => ({ key, value }));

  await writeFile(ymlFile, yamlEntries.length > 0 ? toYaml(yamlEntries) : "");
  await rm(propsFile, { force: true });
  return { file: ymlFile, written: entries.length };
}
