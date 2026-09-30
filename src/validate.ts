const PACKAGE_SEGMENT = /^[a-z][a-z0-9_]*$/;
const ARTIFACT_ID = /^[a-zA-Z0-9]([a-zA-Z0-9_-]*[a-zA-Z0-9])?$/;

export function isValidGroupId(value: string): boolean {
  return value
    .split(".")
    .every((seg) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(seg));
}

export function isValidArtifactId(value: string): boolean {
  return ARTIFACT_ID.test(value);
}

/**
 * Coerce an arbitrary string (typically a directory name) into a valid Maven
 * artifactId. Leading/trailing separators and unsupported characters are
 * dropped, so "my app!" becomes "myapp".
 */
export function sanitizeArtifactId(value: string): string {
  const cleaned = value
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  return ARTIFACT_ID.test(cleaned) ? cleaned : "";
}

export function isValidPackageName(value: string): boolean {
  return value.split(".").every((seg) => PACKAGE_SEGMENT.test(seg));
}

/** Derive a Java package name from groupId + artifactId, sanitizing the artifact part. */
export function derivePackageName(groupId: string, artifactId: string): string {
  const artifactPart = artifactId
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase() || "app";
  return `${groupId}.${artifactPart}`;
}
