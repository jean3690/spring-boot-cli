import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { detectBuildTool, resolveLaunchTarget } from "../src/runner.ts";
import {
  findModule,
  initWorkspace,
  loadWorkspace,
  moduleDir,
  readWorkspace,
  registerModule,
  toModulePath,
  writeWorkspace,
  WORKSPACE_FILE,
} from "../src/workspace.ts";

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "sbc-runner-"));
}

function write(path: string, content = ""): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

/* -------------------------------------------------------------------------- */
/* resolveLaunchTarget                                                        */
/* -------------------------------------------------------------------------- */

test("a standalone Maven project runs in place", async () => {
  const root = sandbox();
  try {
    const dir = join(root, "app");
    write(join(dir, "pom.xml"), '<project><relativePath/></project>');
    const target = await resolveLaunchTarget(dir, "maven");
    assert.equal(target.cwd, resolve(dir));
    assert.deepEqual(target.selector, []);
    assert.equal(target.goal, "spring-boot:run");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a Maven module runs through the reactor root with -pl", async () => {
  const root = sandbox();
  try {
    write(join(root, "pom.xml"), "<project/>");
    write(join(root, "mvnw"), "#!/bin/sh");
    const dir = join(root, "api");
    write(
      join(dir, "pom.xml"),
      '<project><parent><relativePath>../pom.xml</relativePath></parent></project>',
    );

    const target = await resolveLaunchTarget(dir, "maven");
    assert.equal(target.cwd, resolve(root));
    assert.deepEqual(target.selector, ["-pl", "api"]);
    assert.equal(target.goal, "spring-boot:run");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a nested Maven module keeps its full path in -pl", async () => {
  const root = sandbox();
  try {
    write(join(root, "pom.xml"), "<project/>");
    const dir = join(root, "services", "gateway");
    write(
      join(dir, "pom.xml"),
      '<project><parent><relativePath>../../pom.xml</relativePath></parent></project>',
    );

    const target = await resolveLaunchTarget(dir, "maven");
    assert.equal(target.cwd, resolve(root));
    assert.deepEqual(target.selector, ["-pl", "services/gateway"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a Gradle module runs through the build root with a task path", async () => {
  const root = sandbox();
  try {
    write(join(root, "settings.gradle"), "include 'api'");
    const dir = join(root, "api");
    write(join(dir, "build.gradle"), "");

    const target = await resolveLaunchTarget(dir, "gradle");
    assert.equal(target.cwd, resolve(root));
    assert.deepEqual(target.selector, []);
    assert.equal(target.goal, ":api:bootRun");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a nested Gradle module uses a colon separated task path", async () => {
  const root = sandbox();
  try {
    write(join(root, "settings.gradle.kts"), "");
    const dir = join(root, "services", "gateway");
    write(join(dir, "build.gradle.kts"), "");

    const target = await resolveLaunchTarget(dir, "gradle");
    assert.equal(target.cwd, resolve(root));
    assert.equal(target.goal, ":services:gateway:bootRun");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a standalone Gradle project runs in place", async () => {
  const root = sandbox();
  try {
    const dir = join(root, "app");
    write(join(dir, "settings.gradle"), "rootProject.name = 'app'");
    write(join(dir, "build.gradle"), "");

    const target = await resolveLaunchTarget(dir, "gradle");
    assert.equal(target.cwd, resolve(dir));
    assert.equal(target.goal, "bootRun");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("detectBuildTool recognises both build file dialects", async () => {
  const root = sandbox();
  try {
    const maven = join(root, "m");
    write(join(maven, "pom.xml"), "<project/>");
    assert.equal(await detectBuildTool(maven), "maven");

    const gradle = join(root, "g");
    write(join(gradle, "build.gradle.kts"), "");
    assert.equal(await detectBuildTool(gradle), "gradle");

    assert.equal(await detectBuildTool(join(root, "empty")), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* -------------------------------------------------------------------------- */
/* workspace manifest                                                         */
/* -------------------------------------------------------------------------- */

test("initWorkspace creates a v2 manifest and is idempotent", async () => {
  const root = sandbox();
  try {
    const first = await initWorkspace(root);
    assert.equal(first.created, true);
    assert.equal(first.workspace.manifest.version, 2);
    assert.deepEqual(first.workspace.manifest.modules, []);

    const second = await initWorkspace(root);
    assert.equal(second.created, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a v2 manifest round-trips the aggregator and module parents", async () => {
  const root = sandbox();
  try {
    const { workspace } = await initWorkspace(root);
    workspace.manifest.root = {
      artifactId: "shop",
      type: "maven-project",
      bootVersion: "4.1.1",
    };
    registerModule(workspace, {
      name: "api",
      path: "api",
      type: "maven-project",
      language: "java",
      bootVersion: "4.1.1",
      parent: "shop",
    });
    await writeWorkspace(workspace);

    const reloaded = await readWorkspace(root);
    assert.equal(reloaded.manifest.version, 2);
    assert.equal(reloaded.manifest.root?.artifactId, "shop");
    assert.equal(reloaded.manifest.modules[0]?.parent, "shop");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a legacy v1 manifest without an aggregator still loads", async () => {
  const root = sandbox();
  try {
    write(
      join(root, WORKSPACE_FILE),
      JSON.stringify({
        version: 1,
        modules: [
          { name: "api", path: "api", type: "maven-project", language: "java", bootVersion: "3.5.0" },
        ],
      }),
    );
    const workspace = await readWorkspace(root);
    assert.equal(workspace.manifest.version, 1);
    assert.equal(workspace.manifest.root, undefined);
    assert.equal(workspace.manifest.modules[0]?.name, "api");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("registerModule replaces by path and keeps the list sorted", async () => {
  const root = sandbox();
  try {
    const { workspace } = await initWorkspace(root);
    registerModule(workspace, {
      name: "zeta",
      path: "zeta",
      type: "maven-project",
      language: "java",
      bootVersion: "4.1.1",
    });
    registerModule(workspace, {
      name: "alpha",
      path: "alpha",
      type: "maven-project",
      language: "java",
      bootVersion: "4.1.1",
    });
    assert.deepEqual(
      workspace.manifest.modules.map((m) => m.name),
      ["alpha", "zeta"],
    );

    // Re-registering the same path updates in place rather than duplicating.
    registerModule(workspace, {
      name: "alpha-renamed",
      path: "alpha",
      type: "maven-project",
      language: "java",
      bootVersion: "4.1.1",
    });
    assert.equal(workspace.manifest.modules.length, 2);
    assert.deepEqual(
      workspace.manifest.modules.map((m) => m.name),
      ["alpha-renamed", "zeta"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("findModule matches on name or path, and moduleDir resolves the root", async () => {
  const root = sandbox();
  try {
    const { workspace } = await initWorkspace(root);
    registerModule(workspace, {
      name: "gateway",
      path: "services/gateway",
      type: "maven-project",
      language: "java",
      bootVersion: "4.1.1",
    });

    assert.equal(findModule(workspace, "gateway")?.path, "services/gateway");
    assert.equal(findModule(workspace, "services/gateway")?.name, "gateway");
    assert.equal(findModule(workspace, "nope"), undefined);
    assert.equal(moduleDir(workspace, workspace.manifest.modules[0]!), resolve(root, "services/gateway"));
    assert.equal(toModulePath(root, resolve(root, "services/gateway")), "services/gateway");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadWorkspace walks up to the manifest from a nested module", async () => {
  const root = sandbox();
  try {
    await initWorkspace(root);
    const nested = await loadWorkspace(join(root, "services", "gateway"));
    assert.equal(nested?.root, resolve(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
