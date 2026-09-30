/**
 * Monorepo (multi-module) scaffolding.
 *
 * Spring Initializr only ever emits a standalone project, so a real reactor has
 * to be assembled here: the parent aggregator is rendered from scratch and each
 * generated module is then rewired to inherit from it. That is what turns a
 * folder of independent projects into a single build driven by one `./mvnw` /
 * `./gradlew` at the root.
 *
 * Everything in this module is pure string manipulation so it can be unit
 * tested without touching the network or the filesystem.
 */
import { isValidArtifactId } from "./validate.js";

/** A single module inside the monorepo, relative to its root. */
export interface MonorepoModule {
  /** POSIX directory path relative to the monorepo root, e.g. "services/api". */
  path: string;
  /** Build artifact id — always the last segment of {@link path}. */
  artifactId: string;
  /**
   * Dependency ids for this module. `undefined` means "not specified", so the
   * module inherits the shared `--deps` set; an empty array means "explicitly
   * no dependencies" (`api:` in a `--modules` spec).
   */
  dependencies: string[] | undefined;
}

/** The coordinates shared by the aggregator and every module below it. */
export interface ParentProject {
  groupId: string;
  artifactId: string;
  version: string;
  name: string;
  description: string;
  javaVersion: string;
  /** Boot version in the form that exists on Maven Central (no ".RELEASE" post-2.4). */
  bootVersion: string;
}

/* -------------------------------------------------------------------------- */
/* Module specification parsing                                               */
/* -------------------------------------------------------------------------- */

/** Normalise and validate a module path, rejecting anything that escapes the root. */
function normalizeModulePath(raw: string): string {
  const path = raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .split("/")
    .filter((seg) => seg && seg !== ".")
    .join("/");

  if (!path) {
    throw new Error(`Invalid module path "${raw}" — expected something like "api".`);
  }
  for (const seg of path.split("/")) {
    if (!isValidArtifactId(seg)) {
      throw new Error(
        `Invalid module path "${raw}": "${seg}" is not a valid directory name (use letters, digits, "-" and "_").`,
      );
    }
  }
  return path;
}

/**
 * Parse a `--modules` specification.
 *
 * Two forms are accepted:
 * - `api,core,web` — every module inherits the shared `--deps` set.
 * - `api:web;core:jdbc,data-jpa` — per-module dependencies, `;` separating
 *   modules and `,` separating dependencies. A trailing colon with nothing
 *   after it (`api:`) means "this module gets no dependencies".
 *
 * A `:` anywhere in the input switches the parser to the per-module form, so
 * commas are never ambiguous.
 */
export function parseModules(input: string): MonorepoModule[] {
  const trimmed = input.trim();
  if (!trimmed) return [];

  const parts = (
    trimmed.includes(":")
      ? trimmed.split(";")
      : trimmed.split(/[;,]/)
  )
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    throw new Error("No modules found in --modules.");
  }

  const modules: MonorepoModule[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const colon = part.indexOf(":");
    const path = normalizeModulePath(colon >= 0 ? part.slice(0, colon) : part);
    if (seen.has(path)) {
      throw new Error(`Duplicate module "${path}" in --modules.`);
    }
    seen.add(path);
    modules.push({
      path,
      artifactId: path.split("/").pop()!,
      dependencies:
        colon >= 0
          ? part
              .slice(colon + 1)
              .split(",")
              .map((d) => d.trim())
              .filter(Boolean)
          : undefined,
    });
  }
  return modules;
}

/* -------------------------------------------------------------------------- */
/* Build-file rendering                                                       */
/* -------------------------------------------------------------------------- */

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]!);
}

/** Path from a module directory back up to the aggregator pom, e.g. "../../pom.xml". */
export function parentRelativePath(modulePath: string): string {
  const depth = modulePath.split("/").length;
  return `${"../".repeat(depth)}pom.xml`;
}

/** The `<packaging>pom</packaging>` aggregator that turns the root into a reactor. */
export function renderParentPom(parent: ParentProject, modules: MonorepoModule[]): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '\txsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">',
    "\t<modelVersion>4.0.0</modelVersion>",
    "\t<parent>",
    "\t\t<groupId>org.springframework.boot</groupId>",
    "\t\t<artifactId>spring-boot-starter-parent</artifactId>",
    `\t\t<version>${escapeXml(parent.bootVersion)}</version>`,
    "\t\t<relativePath/> <!-- lookup parent from repository -->",
    "\t</parent>",
    `\t<groupId>${escapeXml(parent.groupId)}</groupId>`,
    `\t<artifactId>${escapeXml(parent.artifactId)}</artifactId>`,
    `\t<version>${escapeXml(parent.version)}</version>`,
    "\t<packaging>pom</packaging>",
    `\t<name>${escapeXml(parent.name)}</name>`,
  ];
  if (parent.description.trim()) {
    lines.push(`\t<description>${escapeXml(parent.description)}</description>`);
  }
  lines.push(
    "",
    "\t<modules>",
    ...modules.map((m) => `\t\t<module>${escapeXml(m.path)}</module>`),
    "\t</modules>",
    "",
    "\t<properties>",
    `\t\t<java.version>${escapeXml(parent.javaVersion)}</java.version>`,
    "\t</properties>",
    "",
    "</project>",
  );
  return `${lines.join("\n")}\n`;
}

/** `settings.gradle` / `settings.gradle.kts` that pulls every module into the reactor. */
export function renderGradleSettings(
  parent: ParentProject,
  modules: MonorepoModule[],
  kotlin: boolean,
): string {
  if (kotlin) {
    return [
      `rootProject.name = ${JSON.stringify(parent.name)}`,
      "",
      ...modules.map((m) => `include(${JSON.stringify(m.path)})`),
      "",
    ].join("\n");
  }
  return [
    `rootProject.name = '${parent.name.replace(/'/g, "\\'")}'`,
    "",
    ...modules.map((m) => `include '${m.path.replace(/'/g, "\\'")}'`),
    "",
  ].join("\n");
}

/**
 * Root `build.gradle`. Only carries the coordinates the modules inherit; the
 * Spring Boot plugin stays declared in each module so a single Initializr
 * response per module keeps working unchanged.
 */
export function renderGradleRootBuild(parent: ParentProject, kotlin: boolean): string {
  const wrap = (v: string) => (kotlin ? JSON.stringify(v) : `'${v.replace(/'/g, "\\'")}'`);
  return [
    "// Shared coordinates for every module in this monorepo.",
    "// The Spring Boot plugin is applied per module — see each module's build file.",
    "allprojects {",
    `\tgroup = ${wrap(parent.groupId)}`,
    `\tversion = ${wrap(parent.version)}`,
    "\trepositories {",
    "\t\tmavenCentral()",
    "\t}",
    "}",
    "",
  ].join("\n");
}

/* -------------------------------------------------------------------------- */
/* Child build-file rewrites                                                  */
/* -------------------------------------------------------------------------- */

// Leading indentation is part of the match so the replacement re-indents the
// block exactly once, whatever the generated file used.
const PARENT_BLOCK = /^[ \t]*<parent>[\s\S]*?<\/parent>/m;
const COORDINATE_HEAD =
  /(<parent>[\s\S]*?<\/parent>)([\s\S]*?)(?=<packaging>|<properties>|<dependencyManagement>|<dependencies>|<build>|<profiles>|<modules>)/;

/**
 * Point a generated module's pom at the aggregator and drop the coordinates it
 * now inherits. The head region between `</parent>` and the first structural
 * element only ever holds the module's own scalar coordinates, so stripping
 * `<groupId>`/`<version>` there cannot reach into nested metadata.
 */
export function reparentPom(
  xml: string,
  parent: ParentProject,
  relativePath: string,
): string {
  const block = [
    "\t<parent>",
    `\t\t<groupId>${escapeXml(parent.groupId)}</groupId>`,
    `\t\t<artifactId>${escapeXml(parent.artifactId)}</artifactId>`,
    `\t\t<version>${escapeXml(parent.version)}</version>`,
    `\t\t<relativePath>${escapeXml(relativePath)}</relativePath>`,
    "\t</parent>",
  ].join("\n");

  const replaced = PARENT_BLOCK.test(xml)
    ? xml.replace(PARENT_BLOCK, () => block)
    : xml.replace(
        /(<modelVersion>4\.0\.0<\/modelVersion>)/,
        (_m, tag: string) => `${tag}\n${block}`,
      );

  return replaced.replace(
    COORDINATE_HEAD,
    (_m, parentTag: string, head: string) =>
      parentTag +
      head
        .replace(/^[ \t]*<groupId>[^<]*<\/groupId>\r?\n?/m, "")
        .replace(/^[ \t]*<version>[^<]*<\/version>\r?\n?/m, ""),
  );
}

/** Make a module's build file read its coordinates from the root project. */
export function centralizeGradleCoordinates(buildFile: string): string {
  return buildFile
    .replace(/^([ \t]*)group\s*=.*$/m, (_m, indent: string) => `${indent}group = rootProject.group`)
    .replace(
      /^([ \t]*)version\s*=.*$/m,
      (_m, indent: string) => `${indent}version = rootProject.version`,
    );
}
