/**
 * Spring Initializr API client. Talks to any Initializr-compatible service;
 * see ./registry.ts for the supported registries and their quirks.
 */
import { findRegistry, type Registry } from "./registry.js";

const DEFAULT_REGISTRY = findRegistry("spring")!;

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
  /** Vendor-specific extra selectors (start.aliyun.com adds "architecture"). */
  [key: string]: unknown;
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
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "InitializrError";
    this.cause = cause;
  }
}

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REDIRECT_RETRIES = 5;

/**
 * start.aliyun.com sits behind a WAF that intermittently answers with a 302 to
 * an interstitial error page (err.taobao.com) instead of the real response —
 * in practice on roughly a third of requests. Following that redirect with the
 * default fetch policy silently yields an HTML page carrying HTTP 200, so
 * redirects are handled manually and a redirect that leaves the service origin
 * is treated as a transient failure worth retrying instead.
 */
function isCrossOriginRedirect(res: Response, url: string): boolean {
  if (res.status < 300 || res.status >= 400) return false;
  const location = res.headers.get("location");
  if (!location) return false;
  try {
    return new URL(location, url).origin !== new URL(url).origin;
  } catch {
    return true;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request(url: string, registry: Registry, init?: RequestInit): Promise<Response> {
  const headers = { "User-Agent": "spring-boot-cli", ...init?.headers };

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new InitializrError(
          `Request to ${registry.name} timed out. Check your network connection and try again.`,
          err,
        );
      }
      throw new InitializrError(
        `Cannot reach ${registry.name} (${registry.baseUrl}). Check your network connection.`,
        err,
      );
    }

    if (isCrossOriginRedirect(res, url) && attempt < MAX_REDIRECT_RETRIES) {
      await sleep(400 * (attempt + 1));
      continue;
    }
    return res;
  }
}

/** Reject responses that are not a usable JSON payload. */
async function readJson<T>(res: Response, registry: Registry, what: string): Promise<T> {
  if (res.status >= 300 && res.status < 400) {
    throw new InitializrError(
      `${registry.name} redirected the ${what} request (HTTP ${res.status}) to ${
        res.headers.get("location") ?? "another page"
      }. This usually means the service is rate-limiting or blocking this client.`,
    );
  }
  if (!res.ok) {
    throw new InitializrError(
      `Failed to fetch ${what} from ${registry.name} (HTTP ${res.status}).`,
    );
  }
  try {
    return (await res.json()) as T;
  } catch (err) {
    throw new InitializrError(
      `${registry.name} returned a malformed ${what} response (not valid JSON).`,
      err,
    );
  }
}

export async function fetchMetadata(registry: Registry = DEFAULT_REGISTRY): Promise<InitializrMetadata> {
  const res = await request(`${registry.baseUrl}/metadata/client`, registry, {
    headers: { Accept: "application/json, application/vnd.initializr.v2.1+json" },
  });
  return readJson<InitializrMetadata>(res, registry, "metadata");
}

/** Boot versions that are stable (GA): excludes SNAPSHOT, milestone (M*) and release candidates (RC*). */
export function isStableBootVersion(v: ValueItem): boolean {
  return !/(SNAPSHOT|M\d+|RC\d+)$/.test(v.id);
}

/** Add the legacy ".RELEASE" suffix if it is missing. */
function ensureReleaseSuffix(version: string): string {
  return version.endsWith(".RELEASE") ? version : `${version}.RELEASE`;
}

/**
 * Spring Boot's Maven coordinates moved to plain semver at 2.4.0: before that
 * the artifacts are published as "2.3.12.RELEASE" / "1.5.22.RELEASE" and the
 * bare form does not exist; from 2.4.0 on the suffix must be dropped because
 * neither "4.1.1.RELEASE" nor "2.6.13.RELEASE" exists. This is a property of
 * the published artifacts, so it holds for every Initializr mirror rather than
 * being a per-service convention.
 */
export function usesLegacyReleaseSuffix(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map((n) => parseInt(n, 10) || 0);
  if (major > 2) return false;
  if (major < 2) return true; // 1.x and earlier all carry the suffix
  return minor < 4;
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

/** Values offered by one metadata section, e.g. the ids of every Boot version. */
function sectionIds(section: unknown): string[] {
  const values = (section as { values?: ValueItem[] } | undefined)?.values;
  return Array.isArray(values) ? values.map((v) => v.id) : [];
}

export interface ValueCheck {
  /** Field label used in the warning, e.g. "Boot version". */
  field: string;
  /** Metadata section to validate against, e.g. metadata.bootVersion. */
  section: unknown;
  /** The value requested on the command line. */
  value: string;
}

/**
 * Report values that the registry does not advertise in its metadata.
 *
 * start.spring.io rejects unknown options with a 4xx/5xx, but start.aliyun.com
 * answers HTTP 200 and echoes the value straight into the generated build file
 * — an unknown `--boot 99.9.9` yields a project pinned to a Spring Boot BOM
 * that cannot resolve. Validating up front turns a broken build into a warning.
 */
export function findUnsupportedValues(checks: ValueCheck[]): string[] {
  const warnings: string[] = [];
  for (const { field, section, value } of checks) {
    const ids = sectionIds(section);
    if (ids.length === 0) continue; // section not advertised; nothing to check against
    if (!ids.includes(value)) {
      warnings.push(
        `${field} "${value}" is not offered by this registry${
          ids.length <= 8 ? ` (available: ${ids.join(", ")})` : ""
        }`,
      );
    }
  }
  return warnings;
}

/** ZIP local file header magic ("PK\x03\x04"). */function looksLikeZip(buf: ArrayBuffer): boolean {
  const b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  return b.length >= 2 && b[0] === 0x50 && b[1] === 0x4b;
}

export async function generateProject(
  config: ProjectConfig,
  registry: Registry = DEFAULT_REGISTRY,
): Promise<ArrayBuffer> {
  // Use whichever form of the version actually exists on Maven Central, so the
  // generated build file pins a resolvable BOM on both legacy and modern Boot.
  const bootVersion = usesLegacyReleaseSuffix(config.bootVersion)
    ? ensureReleaseSuffix(config.bootVersion)
    : config.bootVersion.replace(/\.RELEASE$/, "");
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

  const res = await request(`${registry.baseUrl}/starter.zip`, registry, {
    method: "POST",
    headers: {
      Accept: "application/zip",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (res.status >= 300 && res.status < 400) {
    throw new InitializrError(
      `${registry.name} redirected the generation request (HTTP ${res.status}) to ${
        res.headers.get("location") ?? "another page"
      }. This usually means the service is rate-limiting or blocking this client.`,
    );
  }

  if (!res.ok) {
    // Initializr returns a human-readable error body (e.g. dependency/version conflicts).
    const text = await res.text().catch(() => "");
    const message =
      text.trim() ||
      `Failed to generate project (HTTP ${res.status}). Check the provided options (e.g. dependency/version compatibility).`;
    throw new InitializrError(message);
  }

  const buf = await res.arrayBuffer();
  // start.aliyun.com answers unknown/incompatible options with an empty 200
  // instead of an error, so validate the archive before handing it to unzip.
  if (buf.byteLength === 0) {
    throw new InitializrError(
      `${registry.name} returned an empty response. It does not support this combination of options — check the Boot version, Java version and dependency ids against "sbc search" for this registry.`,
    );
  }
  if (!looksLikeZip(buf)) {
    const text = new TextDecoder().decode(buf.slice(0, 200)).trim();
    throw new InitializrError(
      `${registry.name} returned a non-zip response${text ? `: ${text}` : ""}.`,
    );
  }
  return buf;
}
