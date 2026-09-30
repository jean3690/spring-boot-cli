/**
 * Assembles a multi-module reactor from Initializr responses.
 *
 * Spring Initializr returns one self-contained project per request, so the
 * reactor is stitched together here: each module is generated into its own
 * subdirectory, its build file is rewired to inherit from the aggregator, the
 * shared wrapper and dotfiles are hoisted to the root, and the aggregator build
 * file is written last so the whole tree builds with a single command.
 */
import { generateProject, type ConfigFormat, type ProjectConfig } from "./api/initializr.js";
import type { Registry } from "./api/registry.js";
import {
  centralizeGradleCoordinates,
  parentRelativePath,
  renderGradleRootBuild,
  renderGradleSettings,
  renderParentPom,
  reparentPom,
  type MonorepoModule,
  type ParentProject,
} from "./monorepo.js";
import { applyAppProperties, parsePropertyLine, type PropertyEntry } from "./properties.js";
import { join, resolve } from "node:path";
import {
  ensureExecutable,
  hoistIfPresent,
  readTextFileIfExists,
  removeIfPresent,
  unzipToDir,
  writeTextFile,
} from "./writer.js";

/** Everything the scaffolder needs, resolved by the prompt layer. */
export interface MonorepoPlan {
  parent: ParentProject;
  modules: Array<{ spec: MonorepoModule; config: ProjectConfig }>;
  configFormat: ConfigFormat;
}

export interface ScaffoldProgress {
  /** Called before each network request so the caller can drive a spinner. */
  onModuleStart?(index: number, total: number, module: MonorepoModule): void;
  onModuleDone?(index: number, total: number, module: MonorepoModule, fileCount: number): void;
}

export interface ScaffoldResult {
  /** Absolute path to the monorepo root. */
  root: string;
  /** Absolute directory of every generated module, in plan order. */
  moduleDirs: string[];
  /** Total number of files extracted from Initializr. */
  fileCount: number;
  /** Wrapper/support files hoisted to the root, as relative paths. */
  hoisted: string[];
  /** Build tool of the generated reactor. */
  tool: "maven" | "gradle";
}

export function isMavenType(type: string): boolean {
  return type.startsWith("maven");
}

function isKotlinDialect(type: string): boolean {
  return type.endsWith("-kotlin");
}

/** Files that belong to the monorepo root only, stripped out of every module. */
function moduleOnlyCleanup(maven: boolean, kotlin: boolean): string[] {
  return [
    "HELP.md",
    "mvnw",
    "mvnw.cmd",
    "gradlew",
    "gradlew.bat",
    ".gitignore",
    ".gitattributes",
    // A nested settings.gradle would make the module its own build root, and a
    // nested .mvn/gradle wrapper directory duplicates the root wrapper.
    ...(maven ? [".mvn"] : ["gradle", kotlin ? "settings.gradle.kts" : "settings.gradle"]),
  ];
}

/**
 * Generate every module and wire the aggregator.
 *
 * The root's wrapper is taken from the first module because Initializr is the
 * only source of a pinned build-tool version; the aggregator itself is
 * synthesised and carries no wrapper of its own.
 */
export async function scaffoldMonorepo(
  plan: MonorepoPlan,
  registry: Registry,
  rootDir: string,
  progress: ScaffoldProgress = {},
): Promise<ScaffoldResult> {
  const root = resolve(rootDir);
  const type = plan.modules[0]!.config.type;
  const maven = isMavenType(type);
  const kotlin = isKotlinDialect(type);
  const total = plan.modules.length;

  let fileCount = 0;
  const moduleDirs: string[] = [];

  for (const [index, { spec, config }] of plan.modules.entries()) {
    progress.onModuleStart?.(index, total, spec);
    const dir = join(root, ...spec.path.split("/"));
    const zip = await generateProject(config, registry);
    fileCount += await unzipToDir(zip, dir);
    const entries = config.properties
      .map(parsePropertyLine)
      .filter((e): e is PropertyEntry => e !== null);
    await applyAppProperties(dir, plan.configFormat, entries);
    await rewriteModuleBuild(config, dir, plan.parent, spec, maven);
    moduleDirs.push(dir);
    progress.onModuleDone?.(index, total, spec, fileCount);
  }

  const hoisted = await hoistSharedFiles(root, moduleDirs, maven, kotlin);
  await writeAggregator(root, plan, maven, kotlin);
  for (const wrapper of maven ? ["mvnw"] : ["gradlew"]) {
    await ensureExecutable(join(root, wrapper));
  }

  return { root, moduleDirs, fileCount, hoisted, tool: maven ? "maven" : "gradle" };
}

/** Point the module's build file at the aggregator instead of Initializr's parent. */
async function rewriteModuleBuild(
  config: ProjectConfig,
  dir: string,
  parent: ParentProject,
  spec: MonorepoModule,
  maven: boolean,
): Promise<void> {
  if (maven) {
    const pomPath = join(dir, "pom.xml");
    const pom = await readTextFileIfExists(pomPath);
    if (pom === null) return;
    await writeTextFile(pomPath, reparentPom(pom, parent, parentRelativePath(spec.path)));
    return;
  }

  // Gradle: a single build file, named after the DSL the user selected.
  const buildPath = join(dir, isKotlinDialect(config.type) ? "build.gradle.kts" : "build.gradle");
  const build = await readTextFileIfExists(buildPath);
  if (build === null) return;
  await writeTextFile(buildPath, centralizeGradleCoordinates(build));
}

/**
 * Move the wrapper and shared dotfiles to the root and strip the per-module
 * copies Initializr generated, so the reactor has a single entry point.
 */
async function hoistSharedFiles(
  root: string,
  moduleDirs: string[],
  maven: boolean,
  kotlin: boolean,
): Promise<string[]> {
  const [firstDir] = moduleDirs;
  const candidates = maven
    ? ["mvnw", "mvnw.cmd", ".mvn", ".gitignore", ".gitattributes"]
    : ["gradlew", "gradlew.bat", "gradle", ".gitignore", ".gitattributes"];

  const hoisted: string[] = [];
  for (const relPath of candidates) {
    if (firstDir && (await hoistIfPresent(firstDir, root, relPath))) {
      hoisted.push(relPath);
    }
  }

  for (const dir of moduleDirs) {
    for (const relPath of new Set(moduleOnlyCleanup(maven, kotlin))) {
      await removeIfPresent(join(dir, ...relPath.split("/")));
    }
  }
  return hoisted;
}

/** Write the aggregator build file that makes the tree a single reactor. */
async function writeAggregator(
  root: string,
  plan: MonorepoPlan,
  maven: boolean,
  kotlin: boolean,
): Promise<void> {
  const specs = plan.modules.map((m) => m.spec);
  if (maven) {
    await writeTextFile(join(root, "pom.xml"), renderParentPom(plan.parent, specs));
    return;
  }
  await writeTextFile(
    join(root, kotlin ? "settings.gradle.kts" : "settings.gradle"),
    renderGradleSettings(plan.parent, specs, kotlin),
  );
  await writeTextFile(
    join(root, kotlin ? "build.gradle.kts" : "build.gradle"),
    renderGradleRootBuild(plan.parent, kotlin),
  );
}
