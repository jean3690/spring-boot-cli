import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, resolveRegistryFor, writeConfig, findConfigFile } from "../src/config.js";

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "sbc-config-"));
}

test("resolveRegistryFor falls back to spring when nothing is configured", async () => {
  const dir = sandbox();
  const warnings: string[] = [];
  const res = await resolveRegistryFor(dir, undefined, {}, (m) => warnings.push(m));
  assert.equal(res.registry.id, "spring");
  assert.equal(res.origin, "default");
  assert.deepEqual(warnings, []);
  rmSync(dir, { recursive: true, force: true });
});

test("resolveRegistryFor prefers the flag over the env var and config", async () => {
  const dir = sandbox();
  writeFileSync(join(dir, "sbc.config.json"), JSON.stringify({ version: 1, registry: "aliyun" }));
  const res = await resolveRegistryFor(dir, "spring", { SBC_REGISTRY: "aliyun" });
  assert.equal(res.registry.id, "spring");
  assert.equal(res.origin, "flag");
  rmSync(dir, { recursive: true, force: true });
});

test("resolveRegistryFor prefers the env var over the config file", async () => {
  const dir = sandbox();
  writeFileSync(join(dir, "sbc.config.json"), JSON.stringify({ version: 1, registry: "spring" }));
  const res = await resolveRegistryFor(dir, undefined, { SBC_REGISTRY: "aliyun" });
  assert.equal(res.registry.id, "aliyun");
  assert.equal(res.origin, "env");
  rmSync(dir, { recursive: true, force: true });
});

test("resolveRegistryFor reads the config file last", async () => {
  const dir = sandbox();
  writeFileSync(join(dir, "sbc.config.json"), JSON.stringify({ version: 1, registry: "aliyun" }));
  const res = await resolveRegistryFor(dir, undefined, {});
  assert.equal(res.registry.id, "aliyun");
  assert.equal(res.origin, "config");
  assert.equal(res.file, join(dir, "sbc.config.json"));
  rmSync(dir, { recursive: true, force: true });
});

test("resolveRegistryFor finds a config file in a parent directory", async () => {
  const dir = sandbox();
  writeFileSync(join(dir, "sbc.config.json"), JSON.stringify({ version: 1, registry: "aliyun" }));
  const nested = join(dir, "services", "api");
  mkdirSync(nested, { recursive: true });

  const res = await resolveRegistryFor(nested, undefined, {});
  assert.equal(res.registry.id, "aliyun");
  assert.equal(res.origin, "config");

  assert.equal(await findConfigFile(nested), join(dir, "sbc.config.json"));
  rmSync(dir, { recursive: true, force: true });
});

test("resolveRegistryFor errors on a bad flag but warns on a bad config value", async () => {
  const dir = sandbox();
  // A typo in the config file must not block scaffolding; the default is used.
  writeFileSync(join(dir, "sbc.config.json"), JSON.stringify({ version: 1, registry: "alayun" }));
  const warnings: string[] = [];
  const res = await resolveRegistryFor(dir, undefined, {}, (m) => warnings.push(m));
  assert.equal(res.registry.id, "spring");
  assert.equal(res.origin, "default");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /Unknown registry "alayun"/);

  // An explicit flag is a mistake worth failing on.
  await assert.rejects(() => resolveRegistryFor(dir, "alayun", {}), /Unknown registry "alayun"/);
  rmSync(dir, { recursive: true, force: true });
});

test("loadConfig returns an empty config when no file exists", async () => {
  const dir = sandbox();
  const loaded = await loadConfig(dir);
  assert.equal(loaded.file, null);
  assert.equal(loaded.config.registry, undefined);
  rmSync(dir, { recursive: true, force: true });
});

test("loadConfig surfaces a JSON syntax error with the file path", async () => {
  const dir = sandbox();
  const file = join(dir, "sbc.config.json");
  writeFileSync(file, "{ oops");
  await assert.rejects(() => loadConfig(dir), new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  rmSync(dir, { recursive: true, force: true });
});

test("writeConfig round-trips through loadConfig", async () => {
  const dir = sandbox();
  const file = await writeConfig(dir, { version: 1, registry: "aliyun" });
  const loaded = await loadConfig(dir);
  assert.equal(file, join(dir, "sbc.config.json"));
  assert.equal(loaded.config.registry, "aliyun");
  rmSync(dir, { recursive: true, force: true });
});
