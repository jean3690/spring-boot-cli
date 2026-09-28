/**
 * Monorepo workspace support. A workspace is any directory containing an
 * `sbc.workspace.json` manifest that tracks the Spring Boot modules scaffolded
 * under it, so `sbc list` / `sbc run <module>` can operate across them.
 */
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export const WORKSPACE_FILE = "sbc.workspace.json";
const MANIFEST_VERSION = 1;

export interface WorkspaceModule {
  /** Unique, human-facing module name (defaults to the artifact id). */
  name: string;
  /** Module directory, relative to the workspace root, POSIX-separated. */
  path: string;
  /** Initializr project type id, e.g. "maven-project". */
  type: string;
  language: string;
  bootVersion: string;
}

export interface WorkspaceManifest {
  version: number;
  modules: WorkspaceModule[];
}

export interface Workspace {
  /** Absolute path to the directory holding the manifest. */
  root: string;
  manifest: WorkspaceManifest;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Walk up from `startDir` to the nearest directory containing a manifest. */
export async function findWorkspaceRoot(startDir: string): Promise<string | null> {
  let dir = resolve(startDir);
  for (;;) {
    if (await exists(join(dir, WORKSPACE_FILE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function readWorkspace(root: string): Promise<Workspace> {
  const raw = await readFile(join(root, WORKSPACE_FILE), "utf8");
  const parsed = JSON.parse(raw) as Partial<WorkspaceManifest>;
  const manifest: WorkspaceManifest = {
    version: parsed.version ?? MANIFEST_VERSION,
    modules: Array.isArray(parsed.modules) ? parsed.modules : [],
  };
  return { root: resolve(root), manifest };
}

export async function writeWorkspace(ws: Workspace): Promise<void> {
  const body = `${JSON.stringify(ws.manifest, null, 2)}\n`;
  await writeFile(join(ws.root, WORKSPACE_FILE), body);
}

/** Load the workspace enclosing `startDir`, or null if there is none. */
export async function loadWorkspace(startDir: string): Promise<Workspace | null> {
  const root = await findWorkspaceRoot(startDir);
  return root ? readWorkspace(root) : null;
}

/**
 * Create a manifest at `root` (idempotent: an existing manifest is returned
 * untouched). Returns the workspace and whether it was newly created.
 */
export async function initWorkspace(
  root: string,
): Promise<{ workspace: Workspace; created: boolean }> {
  const target = resolve(root);
  if (await exists(join(target, WORKSPACE_FILE))) {
    return { workspace: await readWorkspace(target), created: false };
  }
  const workspace: Workspace = {
    root: target,
    manifest: { version: MANIFEST_VERSION, modules: [] },
  };
  await writeWorkspace(workspace);
  return { workspace, created: true };
}

/** POSIX-separated path from the workspace root to `dir`. */
export function toModulePath(root: string, dir: string): string {
  return relative(resolve(root), resolve(dir)).split(/[\\/]/).join("/");
}

export function findModule(ws: Workspace, nameOrPath: string): WorkspaceModule | undefined {
  return ws.manifest.modules.find(
    (m) => m.name === nameOrPath || m.path === nameOrPath,
  );
}

export function moduleDir(ws: Workspace, module: WorkspaceModule): string {
  return isAbsolute(module.path) ? module.path : join(ws.root, module.path);
}

/** Add or replace a module entry (keyed by path) and keep the list sorted. */
export function registerModule(ws: Workspace, module: WorkspaceModule): void {
  const idx = ws.manifest.modules.findIndex((m) => m.path === module.path);
  if (idx >= 0) ws.manifest.modules[idx] = module;
  else ws.manifest.modules.push(module);
  ws.manifest.modules.sort((a, b) => a.name.localeCompare(b.name));
}
