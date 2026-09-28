const PACKAGE_SEGMENT = /^[a-z][a-z0-9_]*$/;

export function isValidGroupId(value: string): boolean {
  return value
    .split(".")
    .every((seg) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(seg));
}

export function isValidArtifactId(value: string): boolean {
  return /^[a-zA-Z0-9]([a-zA-Z0-9_-]*[a-zA-Z0-9])?$/.test(value);
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
