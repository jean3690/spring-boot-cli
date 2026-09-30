/**
 * Runs a generated Spring Boot project via its build wrapper.
 *
 * Both standalone projects and modules of a multi-module build are supported:
 * for the latter the wrapper lives at the reactor root, so the command is
 * invoked from there with a selector that picks out the requested module.
 */
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

export type BuildTool = "maven" | "gradle";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readFileIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

const IS_WINDOWS = process.platform === "win32";

/** Detect the build tool used by a project directory, or null if none found. */
export async function detectBuildTool(dir: string): Promise<BuildTool | null> {
  if (await exists(join(dir, "pom.xml"))) return "maven";
  if (
    (await exists(join(dir, "build.gradle"))) ||
    (await exists(join(dir, "build.gradle.kts")))
  ) {
    return "gradle";
  }
  return null;
}

/**
 * Resolve the executable to run: prefer the project's wrapper (mvnw/gradlew)
 * so the pinned build-tool version is used; fall back to a globally installed
 * mvn/gradle when the wrapper is absent.
 *
 * A module of a multi-module build inherits the wrapper from the reactor root,
 * so the search walks up until it finds one.
 */
async function resolveExecutable(
  dir: string,
  tool: BuildTool,
): Promise<string> {
  const wrapper =
    tool === "maven"
      ? IS_WINDOWS
        ? "mvnw.cmd"
        : "mvnw"
      : IS_WINDOWS
        ? "gradlew.bat"
        : "gradlew";
  for (let current = resolve(dir); ; current = dirname(current)) {
    const wrapperPath = join(current, wrapper);
    if (await exists(wrapperPath)) return wrapperPath;
    const parent = dirname(current);
    if (parent === current) break;
  }
  return tool === "maven" ? "mvn" : "gradle";
}

export interface RunResult {
  tool: BuildTool;
  command: string;
  code: number;
}

/** How a module directory is reached inside a multi-module build. */
export interface LaunchTarget {
  /** Directory the build tool is invoked from. */
  cwd: string;
  /** Selector that picks out the requested module, e.g. ["-pl", "api"] or [":api:bootRun"]. */
  selector: string[];
  /** The goal or task to run for this target. */
  goal: string;
}

/**
 * A module inside a reactor cannot be run in place: the wrapper lives at the
 * root, and a nested build file that declares its own parent must be invoked
 * through that root so sibling modules are resolvable.
 */
export async function resolveLaunchTarget(dir: string, tool: BuildTool): Promise<LaunchTarget> {
  if (tool === "maven") {
    const parent = await findAggregatorPom(dir);
    if (parent) {
      return {
        cwd: parent.root,
        selector: ["-pl", parent.modulePath],
        goal: "spring-boot:run",
      };
    }
    return { cwd: resolve(dir), selector: [], goal: "spring-boot:run" };
  }
  // Gradle addresses a subproject from the build root with a task path.
  const root = await findGradleRoot(dir);
  if (root) {
    const projectPath = relative(root, resolve(dir)).split(/[\\/]/).join(":");
    return { cwd: root, selector: [], goal: `:${projectPath}:bootRun` };
  }
  return { cwd: resolve(dir), selector: [], goal: "bootRun" };
}

/** Walk up to the aggregator pom referenced by the module's own pom, if any. */
async function findAggregatorPom(
  dir: string,
): Promise<{ root: string; modulePath: string } | null> {
  const pom = await readFileIfExists(join(dir, "pom.xml"));
  const relativePath = pom?.match(/<relativePath>\s*([^<]*?)\s*<\/relativePath>/)?.[1];
  // An empty <relativePath/> means "resolve the parent from the repository",
  // which is exactly the standalone-project case.
  if (!relativePath) return null;

  const aggregatorPom = resolve(dir, ...relativePath.split("/"));
  const root = dirname(aggregatorPom);
  return { root, modulePath: relative(root, resolve(dir)).split(/[\\/]/).join("/") };
}

/** Walk up to the nearest directory holding a Gradle settings file. */
async function findGradleRoot(dir: string): Promise<string | null> {
  for (let current = resolve(dir); ; current = dirname(current)) {
    if (
      (await exists(join(current, "settings.gradle"))) ||
      (await exists(join(current, "settings.gradle.kts")))
    ) {
      // A settings file in the module itself means it is its own build root.
      return current === resolve(dir) ? null : current;
    }
    const parent = dirname(current);
    if (parent === current) return null;
  }
}

/**
 * Run the Spring Boot project in `dir`, streaming build output to the
 * current terminal. Resolves with the child process exit code.
 */
export async function runProject(
  dir: string,
  extraArgs: string[] = [],
): Promise<RunResult> {
  const tool = await detectBuildTool(dir);
  if (!tool) {
    throw new Error(
      `No Spring Boot project found in "${dir}" (missing pom.xml or build.gradle).`,
    );
  }

  const target = await resolveLaunchTarget(dir, tool);
  const cmd = await resolveExecutable(target.cwd, tool);
  const args = [...target.selector, target.goal, ...extraArgs];
  const printable = `${cmd} ${args.join(" ")}`.trim();

  const code = await new Promise<number>((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      cwd: target.cwd,
      stdio: "inherit",
      // .cmd/.bat wrappers on Windows require a shell to execute.
      shell: IS_WINDOWS,
    });
    child.on("error", reject);
    child.on("close", (exitCode) => resolvePromise(exitCode ?? 0));
  });

  return { tool, command: printable, code };
}
