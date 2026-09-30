import { Command } from "commander";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { access, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  InitializrError,
  fetchMetadata,
  searchDependencies,
  generateProject,
  findUnsupportedValues,
} from "./api/initializr.js";
import {
  REGISTRIES,
  UnknownRegistryError,
  resolveRegistry,
  type Registry,
} from "./api/registry.js";
import { buildConfig, type CliFlags } from "./prompts/config.js";
import { applyAppProperties, parsePropertyLine, type PropertyEntry } from "./properties.js";
import { unzipToDir } from "./writer.js";
import { detectBuildTool, runProject } from "./runner.js";
import { assertSettableRegistry, loadConfig, resolveRegistryFor, writeConfig } from "./config.js";
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
  │   start.spring.io / start.aliyun.com │
  ╰──────────────────────────────────────╯`);

interface CreateOptions extends CliFlags {
  force?: boolean;
  run?: boolean;
  module?: string;
  package?: string;
  registry?: string;
}

interface RegistryOptions {
  registry?: string;
}

/** Commander reducer for repeatable options (--set a=1 --set b=2). */
function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
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
    .argument("[dir]", "target directory (default: current directory)")
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
    .option("--config-format <fmt>", "config file format: properties | yml (default: properties)")
    .option("--set <key=value>", "set an entry in the config file (repeatable)", collect, [])
    .option("-f, --force", "allow generating into a non-empty directory without confirmation")
    .option("--module <name>", "workspace module name to register (defaults to artifact id)")
    .option("--registry <id>", "Initializr registry: spring | aliyun, or a full URL (default: spring)")
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
    .option("--registry <id>", "Initializr registry: spring | aliyun, or a full URL (default: spring)")
    .action(searchCmd);

  program
    .command("list")
    .description("List the Spring Boot modules registered in the enclosing workspace.")
    .action(listCmd);

  const config = program
    .command("config")
    .description("Show or edit the sbc configuration (sbc.config.json).");
  config
    .command("show", { isDefault: true })
    .description("Print the resolved configuration and the file it came from.")
    .action(configShowCmd);
  config
    .command("set")
    .description("Set a configuration value, e.g. `sbc config set registry aliyun`.")
    .argument("<key>", "configuration key (registry)")
    .argument("<value>", "value to store")
    .action(configSetCmd);
  config
    .command("path")
    .description("Print the path of the nearest sbc.config.json.")
    .action(configPathCmd);

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

async function createCmd(dir: string | undefined, options: CreateOptions): Promise<void> {
  console.log(BANNER);
  p.intro(pc.cyan("Let's create a Spring Boot project"));

  const nonInteractive = Boolean(options.deps);

  // Resolve the target directory: CLI arg wins, otherwise ask interactively
  // (or fall back to the current directory in non-interactive mode).
  let targetDirInput = dir;
  if (!targetDirInput) {
    if (nonInteractive) {
      targetDirInput = ".";
    } else if (process.stdin.isTTY) {
      const name = await p.text({
        message: "Project directory (new folder for the project)",
        placeholder: "my-app",
        validate: (v) => {
          const value = (v ?? "").trim();
          if (!value) return "Directory name is required";
          if (value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value)) {
            return "Use a relative path (e.g. my-app or services/user-service)";
          }
          return undefined;
        },
      });
      if (p.isCancel(name)) {
        p.cancel("Operation cancelled.");
        process.exit(0);
      }
      targetDirInput = name.trim();
    } else {
      p.outro(
        pc.red(
          "Interactive mode requires a TTY. Pass a directory and -d/--deps (e.g. `sbc create my-app -d web`) to run non-interactively.",
        ),
      );
      process.exit(1);
    }
  }

  const targetDir = resolve(process.cwd(), targetDirInput);

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

  const registry = await pickRegistry(options.registry, targetDir, nonInteractive);

  const spinner = p.spinner();
  spinner.start(`Fetching available versions and dependencies from ${registry.name}...`);
  let metadata;
  try {
    metadata = await fetchMetadata(registry);
    spinner.stop("Metadata loaded.");
  } catch (err) {
    spinner.stop(pc.red("Failed to load metadata."));
    fail(err);
  }

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
    configFormat: options.configFormat,
    set: options.set,
  };
  const config = await buildConfig(metadata, flags, nonInteractive);

  // start.aliyun.com accepts values it does not support and echoes them into the
  // generated build file, so surface mismatches against its metadata early.
  for (const warning of findUnsupportedValues([
    { field: "Project type", section: metadata.type, value: config.type },
    { field: "Language", section: metadata.language, value: config.language },
    { field: "Boot version", section: metadata.bootVersion, value: config.bootVersion },
    { field: "Java version", section: metadata.javaVersion, value: config.javaVersion },
    { field: "Packaging", section: metadata.packaging, value: config.packaging },
  ])) {
    p.log.warn(`${warning} — the generated project may not build.`);
  }

  const summary = [
    `Registry:     ${registry.name}`,
    `Build tool:   ${config.type}`,
    `Language:     ${config.language}`,
    `Boot version: ${config.bootVersion}`,
    `Java:         ${config.javaVersion}`,
    `Group:        ${config.groupId}`,
    `Artifact:     ${config.artifactId}`,
    `Package:      ${config.packageName}`,
    `Packaging:    ${config.packaging}`,
    `Dependencies: ${config.dependencies.length ? config.dependencies.join(", ") : "(none)"}`,
    `Config:       ${config.configFormat === "yml" ? "application.yml" : "application.properties"}${
      config.properties.length ? ` (+${config.properties.length} entries)` : ""
    }`,
  ].join("\n");
  p.note(summary, "Project configuration");

  spinner.start(`Generating project from ${registry.name}...`);
  try {
    const zip = await generateProject(config, registry);
    const fileCount = await unzipToDir(zip, targetDir);
    const entries = config.properties
      .map(parsePropertyLine)
      .filter((e): e is PropertyEntry => e !== null);
    await applyAppProperties(targetDir, config.configFormat, entries);
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

  // Not every registry ships a build wrapper (start.aliyun.com has no mvnw),
  // so only suggest the wrapper when it is actually present.
  const isMaven = config.type.startsWith("maven");
  const hasWrapper = await access(join(targetDir, isMaven ? "mvnw" : "gradlew")).then(
    () => true,
    () => false,
  );
  const wrapperCmd = isMaven ? "./mvnw" : "./gradlew";
  const globalCmd = isMaven ? "mvn" : "gradle";
  const runHint = `${hasWrapper ? wrapperCmd : globalCmd} ${isMaven ? "spring-boot:run" : "bootRun"}`;

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
      `  ${pc.cyan(`cd ${targetDirInput}`)}`,
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

async function searchCmd(query: string[], options: RegistryOptions): Promise<void> {
  let registry: Registry;
  try {
    registry = await pickRegistry(options.registry, process.cwd(), true);
  } catch (err) {
    fail(err);
  }

  let metadata;
  try {
    metadata = await fetchMetadata(registry);
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
  console.log(
    pc.dim(
      `\nUse them with: sbc create -d ${matches[0]!.dep.id}${
        registry.id !== "spring" ? ` --registry ${registry.id}` : ""
      }`,
    ),
  );
}

/**
 * Resolve the Initializr registry to scaffold from.
 *
 * `--registry` / `SBC_REGISTRY` / `sbc.config.json` are honoured; when nothing
 * is configured an interactive picker is offered so the choice is discoverable
 * rather than something you have to already know about.
 */
async function pickRegistry(
  flagValue: string | undefined,
  fromDir: string,
  nonInteractive: boolean,
): Promise<Registry> {
  const source = await resolveRegistryFor(fromDir, flagValue, process.env, (message) =>
    p.log.warn(message),
  );

  if (source.origin !== "default") {
    const origin =
      source.origin === "config" && source.file
        ? pc.dim(` (from ${source.file})`)
        : source.origin === "env"
          ? pc.dim(" (from SBC_REGISTRY)")
          : pc.dim(" (from --registry)");
    p.log.info(`Registry: ${pc.cyan(source.registry.name)}${origin}`);
    return source.registry;
  }

  if (nonInteractive || !process.stdin.isTTY) return source.registry;

  const picked = await p.select({
    message: "Initializr registry",
    initialValue: source.registry.id,
    options: REGISTRIES.map((r) => ({
      value: r.id,
      label: r.name,
      hint:
        r.id === "aliyun"
          ? "Alibaba Cloud mirror — includes Spring Cloud Alibaba starters, best from mainland China"
          : "Official Spring service — newest Boot versions",
    })),
  });
  return resolveRegistry(p.isCancel(picked) ? undefined : picked);
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

async function configShowCmd(): Promise<void> {
  const loaded = await loadConfig(process.cwd());
  console.log(pc.dim(`Config file: ${loaded.file ?? "(none found)"}`));
  console.log(pc.dim(`Searched from: ${loaded.dir}`));
  console.log(
    `registry:    ${loaded.config.registry ?? pc.dim(`(unset — defaults to spring)`)}`,
  );

  const source = await resolveRegistryFor(process.cwd(), undefined, process.env, () => {});
  console.log(pc.dim(`\nEffective registry: ${source.registry.name} (${source.origin})`));
}

async function configSetCmd(key: string, value: string): Promise<void> {
  if (key !== "registry") {
    fail(new Error(`Unknown config key "${key}". Supported keys: registry`));
  }
  const registry = assertSettableRegistry(value);
  const loaded = await loadConfig(process.cwd());
  // Write next to the existing file so an inherited config is not duplicated
  // in a child directory.
  const dir = loaded.file ? dirname(loaded.file) : process.cwd();
  const file = await writeConfig(dir, { ...loaded.config, registry: registry.id });
  console.log(pc.green(`registry = ${registry.id}  (${registry.name})`));
  console.log(pc.dim(`Written to ${file}`));
}

async function configPathCmd(): Promise<void> {
  const loaded = await loadConfig(process.cwd());
  console.log(loaded.file ?? pc.dim("No sbc.config.json found in this directory or any parent."));
}

function fail(err: unknown): never {
  const known =
    err instanceof InitializrError ||
    err instanceof UnknownRegistryError ||
    (err instanceof Error && err.name === "UnknownRegistryError");
  const message = known
    ? `Error: ${err instanceof Error ? err.message : String(err)}`
    : `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
  // Use plain stderr for non-interactive commands (search/run/list).
  process.stderr.write(`${pc.red(message)}\n`);
  process.exit(1);
}

main().catch(fail);
