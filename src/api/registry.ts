/**
 * Initializr registries. A registry is a Spring Initializr-compatible service
 * that `sbc` can scaffold from. Beyond the base URL they differ in quirks that
 * the API layer has to accommodate, so they are described declaratively here
 * rather than hard-coded at the call sites.
 */

export interface Registry {
  /** Short id used on the CLI and in sbc.config.json, e.g. "aliyun". */
  id: string;
  /** Human-facing label shown in prompts and summaries. */
  name: string;
  /** Base URL of the Initializr service, without a trailing slash. */
  baseUrl: string;
}

export const REGISTRIES: readonly Registry[] = [
  { id: "spring", name: "start.spring.io", baseUrl: "https://start.spring.io" },
  { id: "aliyun", name: "start.aliyun.com", baseUrl: "https://start.aliyun.com" },
] as const;

export const DEFAULT_REGISTRY_ID = "spring";

export class UnknownRegistryError extends Error {
  readonly requested: string;

  constructor(requested: string) {
    super(
      `Unknown registry "${requested}". Available: ${REGISTRIES.map((r) => r.id).join(", ")}`,
    );
    this.name = "UnknownRegistryError";
    this.requested = requested;
  }
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function isRegistryId(value: string): boolean {
  return REGISTRIES.some((r) => r.id === value);
}

export function findRegistry(id: string): Registry | undefined {
  return REGISTRIES.find((r) => r.id === id);
}

/** True when the registry is one of the built-ins, whose quirks are known. */
export function isKnownRegistry(registry: Registry): boolean {
  return REGISTRIES.some((r) => r.id === registry.id);
}

/** True when the value looks like an explicit base URL rather than a registry id. */
export function isRegistryUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

/**
 * Resolve a user-supplied registry reference: either a built-in id
 * ("spring" / "aliyun") or an explicit Initializr base URL for self-hosted
 * services.
 */
export function resolveRegistry(ref: string | undefined): Registry {
  const value = (ref ?? "").trim();
  if (!value) return findRegistry(DEFAULT_REGISTRY_ID)!;

  const known = findRegistry(value);
  if (known) return known;

  if (isRegistryUrl(value)) {
    return { id: value, name: value, baseUrl: normalizeBaseUrl(value) };
  }
  throw new UnknownRegistryError(value);
}
