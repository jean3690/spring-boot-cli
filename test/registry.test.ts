import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findUnsupportedValues,
  isStableBootVersion,
  searchDependencies,
  usesLegacyReleaseSuffix,
  type InitializrMetadata,
} from "../src/api/initializr.js";
import { resolveRegistry, isRegistryUrl, REGISTRIES } from "../src/api/registry.js";
import { parseConfig } from "../src/config.js";
import { assertSettableRegistry } from "../src/config.js";

test("usesLegacyReleaseSuffix matches Maven Central coordinates", () => {
  // Verified against repo1.maven.org: 2.3.12.RELEASE and 1.5.22.RELEASE exist,
  // while 2.3.12 / 1.5.22 / 4.1.1.RELEASE do not.
  assert.equal(usesLegacyReleaseSuffix("1.5.22"), true);
  assert.equal(usesLegacyReleaseSuffix("1.5.22.RELEASE"), true);
  assert.equal(usesLegacyReleaseSuffix("2.3.12"), true);
  assert.equal(usesLegacyReleaseSuffix("2.3.12.RELEASE"), true);
  assert.equal(usesLegacyReleaseSuffix("2.4.0"), false);
  assert.equal(usesLegacyReleaseSuffix("2.6.13"), false);
  assert.equal(usesLegacyReleaseSuffix("3.0.2"), false);
  assert.equal(usesLegacyReleaseSuffix("4.1.1"), false);
  assert.equal(usesLegacyReleaseSuffix("4.1.1.RELEASE"), false);
  assert.equal(usesLegacyReleaseSuffix("4.2.0.BUILD-SNAPSHOT"), false);
});

test("isStableBootVersion excludes snapshots, milestones and RCs", () => {
  const v = (id: string) => ({ id, name: id });
  assert.equal(isStableBootVersion(v("3.0.2")), true);
  assert.equal(isStableBootVersion(v("4.1.1.RELEASE")), true);
  assert.equal(isStableBootVersion(v("4.2.0.BUILD-SNAPSHOT")), false);
  assert.equal(isStableBootVersion(v("4.2.0.M2")), false);
  assert.equal(isStableBootVersion(v("3.0.0-RC1")), false);
});

const METADATA: InitializrMetadata = {
  type: { default: "maven-project", values: [{ id: "maven-project", name: "Maven" }] },
  bootVersion: { default: "2.6.13", values: [{ id: "2.6.13", name: "2.6.13" }] },
  javaVersion: { default: "1.8", values: [{ id: "1.8", name: "8" }] },
  packaging: { default: "jar", values: [{ id: "jar", name: "Jar" }] },
  language: { default: "java", values: [{ id: "java", name: "Java" }] },
  dependencies: {
    values: [
      { name: "Web", values: [{ id: "web", name: "Spring Web", description: "web mvc" }] },
      { name: "SQL", values: [{ id: "data-jpa", name: "Spring Data JPA" }] },
    ],
  },
};

test("searchDependencies matches id, name, description and group", () => {
  assert.equal(searchDependencies(METADATA, "web").length, 1);
  assert.equal(searchDependencies(METADATA, "jpa").length, 1);
  assert.equal(searchDependencies(METADATA, "sql").length, 1);
  assert.equal(searchDependencies(METADATA, "").length, 2);
  assert.equal(searchDependencies(METADATA, "nope").length, 0);
});

test("findUnsupportedValues reports values absent from metadata", () => {
  const warnings = findUnsupportedValues([
    { field: "Boot version", section: METADATA.bootVersion, value: "2.6.13" },
    { field: "Java version", section: METADATA.javaVersion, value: "1.8" },
    { field: "Boot version", section: METADATA.bootVersion, value: "99.9.9" },
    { field: "Language", section: METADATA.language, value: "cobol" },
  ]);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0]!, /Boot version "99\.9\.9"/);
  // Small value lists are echoed so the user can pick a valid one.
  assert.match(warnings[0]!, /available: 2\.6\.13/);
  assert.match(warnings[1]!, /Language "cobol"/);
});

test("findUnsupportedValues ignores sections the registry does not advertise", () => {
  assert.deepEqual(
    findUnsupportedValues([{ field: "Architecture", section: undefined, value: "mvc" }]),
    [],
  );
});

test("resolveRegistry handles ids, URLs and unknown values", () => {
  assert.equal(resolveRegistry(undefined).id, "spring");
  assert.equal(resolveRegistry("").id, "spring");
  assert.equal(resolveRegistry("aliyun").baseUrl, "https://start.aliyun.com");
  assert.equal(resolveRegistry("spring").baseUrl, "https://start.spring.io");
  // Trailing slashes are normalised so path joining stays correct.
  assert.equal(resolveRegistry("https://start.aliyun.com/").baseUrl, "https://start.aliyun.com");
  assert.throws(() => resolveRegistry("nope"), /Unknown registry "nope"/);
});

test("isRegistryUrl only accepts http(s) URLs", () => {
  assert.equal(isRegistryUrl("https://start.aliyun.com"), true);
  assert.equal(isRegistryUrl("http://localhost:8080"), true);
  assert.equal(isRegistryUrl("aliyun"), false);
  assert.equal(isRegistryUrl("ftp://x"), false);
});

test("every built-in registry has a distinct id and https base URL", () => {
  const ids = REGISTRIES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const r of REGISTRIES) {
    assert.ok(r.baseUrl.startsWith("https://"), `${r.id} should use https`);
    assert.ok(!r.baseUrl.endsWith("/"), `${r.id} should not end with a slash`);
  }
});

test("assertSettableRegistry accepts ids and URLs and rejects typos", () => {
  assert.equal(assertSettableRegistry("aliyun").id, "aliyun");
  assert.equal(assertSettableRegistry("https://start.aliyun.com").baseUrl, "https://start.aliyun.com");
  assert.throws(() => assertSettableRegistry("alayun"), /Unknown registry/);
});

test("parseConfig rejects malformed config files", () => {
  assert.deepEqual(parseConfig('{"version":1,"registry":"aliyun"}'), {
    version: 1,
    registry: "aliyun",
  });
  assert.deepEqual(parseConfig("{}"), { version: 1, registry: undefined });
  assert.throws(() => parseConfig("not json", "c.json"), /not valid JSON/);
  assert.throws(() => parseConfig("[]", "c.json"), /must contain a JSON object/);
  assert.throws(() => parseConfig('{"registry":5}', "c.json"), /"registry" must be a string/);
});
