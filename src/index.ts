import { Command } from "commander";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  InitializrError,
  fetchMetadata,
  searchDependencies,
  generateProject,
} from "./api/initializr.js";
import { buildConfig, type CliFlags } from "./prompts/config.js";
import { unzipToDir } from "./writer.js";
import { detectBuildTool, runProject } from "./runner.js";
import {
  findModule,
  initWorkspace,
  loadWorkspace,
  moduleDir,
  registerModule,
  toModulePath,
  writeWorkspace,
} from "./workspace.js";

const BANNER = pc.cyan(`
  ╭──────────────────────────────────────╮
  │            sbc  ·  Spring Boot       │
  │   powered by start.spring.io         │
  ╰──────────────────────────────────────╯`);

interface CreateOptions extends CliFlags {
  force?: boolean;
  run?: boolean;
  module?: string;
  package?: string;
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("sbc")
    .description("Scaffold, search and run Spring Boot projects (monorepo-aware), powered by start.spring.io.")
    .enablePositionalOptions();

  program
    .command("create", { isDefault: true })
    .description("Scaffold a Spring Boot project, interactively or via flags.")
    .argument("[dir]", "target directory (default: current directory)", ".")
    .option("--type <id>", "project type: maven-project | gradle-project | gradle-project-kotlin")
    .option("--language <lang>", "language: java | kotlin | groovy")
    .option("--boot <version>", "Spring Boot version, e.g. 4.1.1")
    .option("--java <version>", "Java version, e.g. 21")
    .option("--group <id>", "group id, e.g. com.example")
    .option("--artifact <id>", "artifact id, e.g. demo")
    .option("--name <name>", "project name (defaults to artifact id)")
    .option("--description <text>", "project description")
    .option("--package <name>", "base package name, e.g. com.example.demo")
    .option("--packaging <type>", "packaging: jar | war")
    .option("-d, --deps <list>", "dependencies (comma separated id or name). Providing this enables non-interactive mode")
    .option("-f, --force", "allow generating into a non-empty directory without confirmation")
    .option("--module <name>", "workspace module name to register (defaults to artifact id)")
    .option("--run", "run the project immediately after generating")
    .action(createCmd);

  program
    .command("run")
    .description("Run a Spring Boot project (a workspace module by name, or the current directory).")
    .argument("[module]", "workspace module name/path; omit to run the current directory")
    .argument("[buildArgs...]", "extra arguments forwarded to mvnw/gradlew")
    .passThroughOptions()
    .allowUnknownOption()
    .action(runCmd);

  program
    .command("search")
    .description("Search available Spring Boot dependencies by id, name or description.")
    .argument("<query...>", "search terms")
    .action(searchCmd);

  program
    .command("list")
    .description("List the Spring Boot modules registered in the enclosing workspace.")
    .action(listCmd);

  const workspace = program
    .command("workspace")
    .description("Manage the monorepo workspace.");
  workspace
    .command("init")
    .description("Create an sbc.workspace.json manifest so modules can be tracked.")
    .argument("[dir]", "workspace root (default: current directory)", ".")
    .action(workspaceInitCmd);
  workspace
    .command("list")
    .description("List the modules registered in the enclosing workspace.")
    .action(listCmd);

  await program.parseAsync();
}

async function createCmd(dir: string, options: CreateOptions): Promise<void> {
  console.log(BANNER);
  p.intro(pc.cyan("Let's create a Spring Boot project"));

  const targetDir = resolve(process.cwd(), dir);

  // Directory check.
  let existing: string[];
  try {
    existing = await readdir(targetDir);
  } catch {
    existing = [];
  }
  if (existing.length > 0 && options.force !== true) {
    if (!process.stdin.isTTY) {
      p.outro(pc.red(`Directory "${targetDir}" is not empty. Use --force to write into it.`));
      process.exit(1);
    }
    const proceed = await p.confirm({
      message: `Directory "${targetDir}" is not empty. Continue anyway?`,
    });
    if (p.isCancel(proceed) || !proceed) {
      p.cancel("Operation cancelled.");
      process.exit(0);
    }
  }

  const spinner = p.spinner();
  spinner.start("Fetching available versions and dependencies from start.spring.io...");
  let metadata;
  try {
    metadata = await fetchMetadata();
    spinner.stop("Metadata loaded.");
  } catch (err) {
    spinner.stop(pc.red("Failed to load metadata."));
    fail(err);
  }

  const nonInteractive = Boolean(options.deps);
  if (nonInteractive) {
    p.log.info("Dependencies provided via --deps, running non-interactively.");
  } else if (!process.stdin.isTTY) {
    p.outro(
      pc.red(
        "Interactive mode requires a TTY. Pass -d/--deps (e.g. -d web,data-jpa) to run non-interactively.",
      ),
    );
    process.exit(1);
  }

  const flags: CliFlags = {
    type: options.type,
    language: options.language,
    boot: options.boot,
    java: options.java,
    group: options.group,
    artifact: options.artifact,
    name: options.name,
    description: options.description,
    packageName: options.package,
    packaging: options.packaging,
    deps: options.deps,
  };
  const config = await buildConfig(metadata, flags, nonInteractive);

  const summary = [
    `Build tool:   ${config.type}`,
    `Language:     ${config.language}`,
    `Boot version: ${config.bootVersion}`,
    `Java:         ${config.javaVersion}`,
    `Group:        ${config.groupId}`,
    `Artifact:     ${config.artifactId}`,
    `Package:      ${config.packageName}`,
    `Packaging:    ${config.packaging}`,
    `Dependencies: ${config.dependencies.length ? config.dependencies.join(", ") : "(none)"}`,
  ].join("\n");
  p.note(summary, "Project configuration");

  spinner.start("Generating project...");
  try {
    const zip = await generateProject(config);
    const fileCount = await unzipToDir(zip, targetDir);
    spinner.stop(pc.green(`Done! ${fileCount} files written to ${targetDir}`));
  } catch (err) {
    spinner.stop(pc.red("Generation failed."));
    fail(err);
  }

  // Register the module if we generated inside a monorepo workspace.
  const workspace = await loadWorkspace(targetDir);
  if (workspace) {
    const relPath = toModulePath(workspace.root, targetDir) || ".";
    const moduleName = options.module ?? config.artifactId;
    registerModule(workspace, {
      name: moduleName,
      path: relPath,
      type: config.type,
      language: config.language,
      bootVersion: config.bootVersion,
    });
    await writeWorkspace(workspace);
    p.log.info(`Registered module ${pc.cyan(moduleName)} in workspace ${workspace.root}`);
  }

  const isMaven = config.type.startsWith("maven");
  const runHint = isMaven ? "./mvnw spring-boot:run" : "./gradlew bootRun";

  if (options.run) {
    p.outro(pc.green("Project created — starting it now."));
    await runAndExit(targetDir);
    return;
  }

  p.outro(
    [
      pc.green("Project created successfully!"),
      "",
      "Next steps:",
      `  ${pc.cyan(`cd ${dir}`)}`,
      `  ${pc.cyan(runHint)}`,
      workspace ? `  ${pc.cyan(`sbc run ${options.module ?? config.artifactId}`)}  ${pc.dim("(from anywhere in the workspace)")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function runCmd(
  module: string | undefined,
  buildArgs: string[],
): Promise<void> {
  // Strip a leading "--" separator, e.g. `sbc run app -- --debug`.
  const extraArgs = buildArgs[0] === "--" ? buildArgs.slice(1) : buildArgs;

  let dir = process.cwd();
  if (module && module !== ".") {
    const workspace = await loadWorkspace(process.cwd());
    if (!workspace) {
      fail(
        new Error(
          `No workspace found. Run "sbc workspace init" at the monorepo root, or omit the module to run the current directory.`,
        ),
      );
    }
    const mod = findModule(workspace, module);
    if (!mod) {
      const names = workspace.manifest.modules.map((m) => m.name).join(", ") || "(none)";
      fail(new Error(`Unknown module "${module}". Available: ${names}`));
    }
    dir = moduleDir(workspace, mod);
  }

  await runAndExit(dir, extraArgs);
}

/** Run a project directory, printing the command, then exit with its code. */
async function runAndExit(dir: string, extraArgs: string[] = []): Promise<void> {
  try {
    const result = await runProject(dir, extraArgs);
    process.exit(result.code);
  } catch (err) {
    fail(err);
  }
}

async function searchCmd(query: string[]): Promise<void> {
  let metadata;
  try {
    metadata = await fetchMetadata();
  } catch (err) {
    fail(err);
  }

  const term = query.join(" ");
  const matches = searchDependencies(metadata, term);
  if (matches.length === 0) {
    console.log(pc.yellow(`No dependencies match "${term}".`));
    return;
  }

  const idWidth = Math.min(
    30,
    matches.reduce((w, m) => Math.max(w, m.dep.id.length), 0),
  );
  console.log(pc.dim(`${matches.length} dependencies matching "${term}":\n`));
  for (const { group, dep } of matches) {
    const id = pc.green(dep.id.padEnd(idWidth));
    const name = pc.bold(dep.name);
    console.log(`  ${id}  ${name} ${pc.dim(`· ${group}`)}`);
    if (dep.description) console.log(`  ${" ".repeat(idWidth)}  ${pc.dim(dep.description)}`);
  }
  console.log(pc.dim(`\nUse them with: sbc create -d ${matches[0]!.dep.id}`));
}

async function listCmd(): Promise<void> {
  const workspace = await loadWorkspace(process.cwd());
  if (!workspace) {
    console.log(
      pc.yellow('No workspace found. Run "sbc workspace init" at your monorepo root.'),
    );
    return;
  }

  const { modules } = workspace.manifest;
  console.log(pc.dim(`Workspace: ${workspace.root}`));
  if (modules.length === 0) {
    console.log(pc.yellow("No modules registered yet. Create one with: sbc create <dir>"));
    return;
  }

  const nameWidth = modules.reduce((w, m) => Math.max(w, m.name.length), 0);
  console.log(pc.dim(`${modules.length} module(s):\n`));
  for (const m of modules) {
    const built = (await detectBuildTool(moduleDir(workspace, m))) ?? "?";
    console.log(
      `  ${pc.green(m.name.padEnd(nameWidth))}  ${pc.cyan(m.path)} ${pc.dim(
        `· ${built} · Boot ${m.bootVersion} · ${m.language}`,
      )}`,
    );
  }
  console.log(pc.dim("\nRun one with: sbc run <name>"));
}

async function workspaceInitCmd(dir: string): Promise<void> {
  const root = resolve(process.cwd(), dir);
  const { workspace, created } = await initWorkspace(root);
  if (created) {
    console.log(pc.green(`Initialized workspace at ${workspace.root}`));
    console.log(pc.dim("Projects created under this directory will be tracked automatically."));
  } else {
    console.log(pc.yellow(`Workspace already exists at ${workspace.root}`));
  }
}

function fail(err: unknown): never {
  const message =
    err instanceof InitializrError
      ? `Error: ${err.message}`
      : `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
  // Use plain stderr for non-interactive commands (search/run/list).
  process.stderr.write(`${pc.red(message)}\n`);
  process.exit(1);
}

main().catch(fail);
