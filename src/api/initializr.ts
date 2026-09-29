/**
 * Spring Initializr API client (https://start.spring.io).
 */

const DEFAULT_BASE_URL = "https://start.spring.io";

export interface ValueItem {
  id: string;
  name: string;
  description?: string;
  default?: boolean;
  /** e.g. { build: "maven" | "gradle", format: "project" | "build" } */
  tags?: Record<string, string>;
}

export interface Dependency {
  id: string;
  name: string;
  description?: string;
  versionRange?: string;
}

export interface DependencyGroup {
  name: string;
  values: Dependency[];
}

export interface InitializrMetadata {
  type: { default: string; values: ValueItem[] };
  bootVersion: { default: string; values: ValueItem[] };
  javaVersion: { default: string; values: ValueItem[] };
  packaging: { default: string; values: ValueItem[] };
  language: { default: string; values: ValueItem[] };
  dependencies: { values: DependencyGroup[] };
}

export type ConfigFormat = "properties" | "yml";

export interface ProjectConfig {
  type: string;
  language: string;
  bootVersion: string;
  javaVersion: string;
  groupId: string;
  artifactId: string;
  name: string;
  description: string;
  packageName: string;
  packaging: string;
  version: string;
  dependencies: string[];
  /** Format of the generated application config file. */
  configFormat: ConfigFormat;
  /** Extra entries applied to the config file, as "key=value" strings. */
  properties: string[];
}

export class InitializrError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "InitializrError";
  }
}

async function request(url: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "User-Agent": "spring-boot-cli", ...init?.headers },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new InitializrError(
        "Request to Spring Initializr timed out. Check your network connection and try again.",
        err,
      );
    }
    throw new InitializrError(
      "Cannot reach Spring Initializr (https://start.spring.io). Check your network connection.",
      err,
    );
  }
  return res;
}

export async function fetchMetadata(baseUrl = DEFAULT_BASE_URL): Promise<InitializrMetadata> {
  const res = await request(`${baseUrl}/metadata/client`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new InitializrError(`Failed to fetch Initializr metadata (HTTP ${res.status}).`);
  }
  return (await res.json()) as InitializrMetadata;
}

/** Boot versions that are stable (GA): excludes SNAPSHOT, milestone (M*) and release candidates (RC*). */
export function isStableBootVersion(v: ValueItem): boolean {
  return !/(SNAPSHOT|M\d+|RC\d+)$/.test(v.id);
}

export interface DependencyMatch {
  group: string;
  dep: Dependency;
}

/**
 * Case-insensitive substring search over dependency id, name, description and
 * group name. An empty query returns every dependency (useful for listing).
 */
export function searchDependencies(
  metadata: InitializrMetadata,
  query: string,
): DependencyMatch[] {
  const q = query.trim().toLowerCase();
  const matches: DependencyMatch[] = [];
  for (const group of metadata.dependencies.values) {
    for (const dep of group.values) {
      const haystack =
        `${dep.id} ${dep.name} ${dep.description ?? ""} ${group.name}`.toLowerCase();
      if (!q || haystack.includes(q)) matches.push({ group: group.name, dep });
    }
  }
  return matches;
}

export async function generateProject(
  config: ProjectConfig,
  baseUrl = DEFAULT_BASE_URL,
): Promise<ArrayBuffer> {
  // The metadata endpoint reports versions like "4.1.1.RELEASE", but the
  // generation endpoint rejects the ".RELEASE" suffix (HTTP 500) — strip it.
  const bootVersion = config.bootVersion.replace(/\.RELEASE$/, "");
  const body = new URLSearchParams({
    type: config.type,
    dependencies: config.dependencies.join(","),
    groupId: config.groupId,
    artifactId: config.artifactId,
    version: config.version,
    bootVersion,
    packaging: config.packaging,
    javaVersion: config.javaVersion,
    language: config.language,
    name: config.name,
    description: config.description,
    packageName: config.packageName,
  });

  const res = await request(`${baseUrl}/starter.zip`, {
    method: "POST",
    headers: {
      Accept: "application/zip",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    // Initializr returns a human-readable error body (e.g. dependency/version conflicts).
    const text = await res.text().catch(() => "");
    const message =
      text.trim() ||
      `Failed to generate project (HTTP ${res.status}). Check the provided options (e.g. dependency/version compatibility).`;
    throw new InitializrError(message);
  }
  return res.arrayBuffer();
}
