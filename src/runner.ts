/**
 * Runs a generated Spring Boot project via its build wrapper.
 */
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";

export type BuildTool = "maven" | "gradle";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
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
  const wrapperPath = join(dir, wrapper);
  if (await exists(wrapperPath)) return wrapperPath;
  return tool === "maven" ? "mvn" : "gradle";
}

export interface RunResult {
  tool: BuildTool;
  command: string;
  code: number;
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

  const cmd = await resolveExecutable(dir, tool);
  const runTask = tool === "maven" ? ["spring-boot:run"] : ["bootRun"];
  const args = [...runTask, ...extraArgs];
  const printable = `${cmd} ${args.join(" ")}`.trim();

  const code = await new Promise<number>((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      cwd: dir,
      stdio: "inherit",
      // .cmd/.bat wrappers on Windows require a shell to execute.
      shell: IS_WINDOWS,
    });
    child.on("error", reject);
    child.on("close", (exitCode) => resolvePromise(exitCode ?? 0));
  });

  return { tool, command: printable, code };
}
