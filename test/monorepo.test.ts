import { test } from "node:test";
import assert from "node:assert/strict";
import {
  centralizeGradleCoordinates,
  escapeXml,
  parseModules,
  parentRelativePath,
  renderGradleRootBuild,
  renderGradleSettings,
  renderParentPom,
  reparentPom,
  type ParentProject,
} from "../src/monorepo.ts";
import { isValidArtifactId, sanitizeArtifactId } from "../src/validate.ts";
import { normalizeBootVersion } from "../src/api/initializr.ts";

const PARENT: ParentProject = {
  groupId: "com.example",
  artifactId: "my-monorepo",
  version: "0.0.1-SNAPSHOT",
  name: "my-monorepo",
  description: "Monorepo aggregating 2 module(s)",
  javaVersion: "21",
  bootVersion: "4.1.1",
};

/** Verbatim pom.xml as start.spring.io returns it for a maven-project. */
const GENERATED_POM = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
	xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
	<modelVersion>4.0.0</modelVersion>
	<parent>
		<groupId>org.springframework.boot</groupId>
		<artifactId>spring-boot-starter-parent</artifactId>
		<version>4.1.1</version>
		<relativePath/> <!-- lookup parent from repository -->
	</parent>
	<groupId>com.example</groupId>
	<artifactId>api</artifactId>
	<version>0.0.1-SNAPSHOT</version>
	<name>api</name>
	<description>demo</description>
	<url/>
	<licenses>
		<license/>
	</licenses>
	<scm>
		<connection/>
		<developerConnection/>
		<tag/>
		<url/>
	</scm>
	<properties>
		<java.version>21</java.version>
	</properties>
	<dependencies>
		<dependency>
			<groupId>org.springframework.boot</groupId>
			<artifactId>spring-boot-starter-webmvc</artifactId>
		</dependency>
	</dependencies>

	<build>
		<plugins>
			<plugin>
				<groupId>org.springframework.boot</groupId>
				<artifactId>spring-boot-maven-plugin</artifactId>
			</plugin>
		</plugins>
	</build>

</project>
`;

/** Verbatim build.gradle as start.spring.io returns it for a gradle-project. */
const GENERATED_BUILD_GRADLE = `plugins {
	id 'java'
	id 'org.springframework.boot' version '4.1.1'
	id 'io.spring.dependency-management' version '1.1.7'
}

group = 'com.example'
version = '0.0.1-SNAPSHOT'
description = 'demo'

java {
	toolchain {
		languageVersion = JavaLanguageVersion.of(21)
	}
}

repositories {
	mavenCentral()
}
`;

/* -------------------------------------------------------------------------- */
/* parseModules                                                               */
/* -------------------------------------------------------------------------- */

test("parseModules reads a plain comma separated list", () => {
  assert.deepEqual(parseModules("api,core,web"), [
    { path: "api", artifactId: "api", dependencies: undefined },
    { path: "core", artifactId: "core", dependencies: undefined },
    { path: "web", artifactId: "web", dependencies: undefined },
  ]);
});

test("parseModules derives the artifact id from the last path segment", () => {
  const [module] = parseModules("services/user-service");
  assert.equal(module?.artifactId, "user-service");
  assert.equal(module?.path, "services/user-service");
});

test("parseModules reads per-module dependencies once a colon is present", () => {
  assert.deepEqual(parseModules("api:web,jdbc;core:jdbc,data-jpa"), [
    { path: "api", artifactId: "api", dependencies: ["web", "jdbc"] },
    { path: "core", artifactId: "core", dependencies: ["jdbc", "data-jpa"] },
  ]);
});

test("parseModules treats a bare colon as explicitly no dependencies", () => {
  assert.deepEqual(parseModules("api:;core:jdbc"), [
    { path: "api", artifactId: "api", dependencies: [] },
    { path: "core", artifactId: "core", dependencies: ["jdbc"] },
  ]);
});

test("parseModules accepts a single module with dependencies", () => {
  assert.deepEqual(parseModules("api:web"), [
    { path: "api", artifactId: "api", dependencies: ["web"] },
  ]);
});

test("parseModules normalises leading ./ and trailing slashes", () => {
  assert.deepEqual(parseModules("./services/api/"), [
    { path: "services/api", artifactId: "api", dependencies: undefined },
  ]);
});

test("parseModules tolerates whitespace and semicolons", () => {
  assert.deepEqual(parseModules(" api ; core "), [
    { path: "api", artifactId: "api", dependencies: undefined },
    { path: "core", artifactId: "core", dependencies: undefined },
  ]);
});

test("parseModules returns an empty list for blank input", () => {
  assert.deepEqual(parseModules("   "), []);
});

test("parseModules rejects duplicate modules", () => {
  assert.throws(() => parseModules("api,api"), /Duplicate module/);
});

test("parseModules rejects path traversal and illegal names", () => {
  // isValidArtifactId rejects "..", so traversal cannot survive normalisation.
  assert.throws(() => parseModules("../evil"), /Invalid module path/);
  assert.throws(() => parseModules("services/../.."), /Invalid module path/);
  assert.throws(() => parseModules("bad name"), /Invalid module path/);
});

test("parseModules rejects an empty module list", () => {
  assert.throws(() => parseModules(":"), /Invalid module path/);
});

/* -------------------------------------------------------------------------- */
/* parentRelativePath                                                         */
/* -------------------------------------------------------------------------- */

test("parentRelativePath climbs one level per path segment", () => {
  assert.equal(parentRelativePath("api"), "../pom.xml");
  assert.equal(parentRelativePath("services/api"), "../../pom.xml");
  assert.equal(parentRelativePath("a/b/c"), "../../../pom.xml");
});

/* -------------------------------------------------------------------------- */
/* renderParentPom                                                            */
/* -------------------------------------------------------------------------- */

test("renderParentPom emits an aggregator with pom packaging and every module", () => {
  const xml = renderParentPom(PARENT, parseModules("api,services/web"));
  assert.match(xml, /<packaging>pom<\/packaging>/);
  assert.match(xml, /<artifactId>my-monorepo<\/artifactId>/);
  assert.match(xml, /<artifactId>spring-boot-starter-parent<\/artifactId>/);
  assert.match(xml, /<version>4\.1\.1<\/version>/);
  assert.match(xml, /<module>api<\/module>/);
  assert.match(xml, /<module>services\/web<\/module>/);
  // The aggregator itself must not depend on anything.
  assert.doesNotMatch(xml, /<dependencies>/);
  assert.doesNotMatch(xml, /spring-boot-maven-plugin/);
});

test("renderParentPom declares the shared java version", () => {
  assert.match(renderParentPom(PARENT, parseModules("api")), /<java\.version>21<\/java\.version>/);
});

test("renderParentPom omits an empty description", () => {
  const xml = renderParentPom({ ...PARENT, description: "  " }, parseModules("api"));
  assert.doesNotMatch(xml, /<description>/);
});

test("escapeXml neutralises markup in user supplied values", () => {
  assert.equal(escapeXml(`a&b<c>"d"`), "a&amp;b&lt;c&gt;&quot;d&quot;");
  const xml = renderParentPom({ ...PARENT, name: "a&b" }, parseModules("api"));
  assert.match(xml, /<name>a&amp;b<\/name>/);
});

test("renderParentPom pins a Boot version that exists on Maven Central", () => {
  // 4.1.1.RELEASE is how registries *display* modern Boot versions, but the
  // published artifact is 4.1.1 — the aggregator must not pin the display form.
  assert.equal(normalizeBootVersion("4.1.1.RELEASE"), "4.1.1");
  assert.equal(normalizeBootVersion("3.5.0"), "3.5.0");
  // Boot 2.4.0+ also dropped the suffix; only 2.3.x and 1.x keep it.
  assert.equal(normalizeBootVersion("2.6.13"), "2.6.13");
  assert.equal(normalizeBootVersion("2.3.12"), "2.3.12.RELEASE");
  assert.equal(normalizeBootVersion("2.3.12.RELEASE"), "2.3.12.RELEASE");
  assert.equal(normalizeBootVersion("1.5.22"), "1.5.22.RELEASE");
});

/* -------------------------------------------------------------------------- */
/* reparentPom                                                                */
/* -------------------------------------------------------------------------- */

test("reparentPom points the module at the aggregator with a local relativePath", () => {
  const xml = reparentPom(GENERATED_POM, PARENT, "../pom.xml");
  assert.match(
    xml,
    /<parent>\s*<groupId>com\.example<\/groupId>\s*<artifactId>my-monorepo<\/artifactId>\s*<version>0\.0\.1-SNAPSHOT<\/version>\s*<relativePath>\.\.\/pom\.xml<\/relativePath>\s*<\/parent>/,
  );
  assert.doesNotMatch(xml, /spring-boot-starter-parent/);
});

test("reparentPom drops the coordinates the module now inherits", () => {
  const xml = reparentPom(GENERATED_POM, PARENT, "../pom.xml");
  // The module's own coordinates sit between </parent> and the first
  // structural element; groupId and version are inherited now, artifactId is not.
  const head = xml.slice(
    xml.indexOf("</parent>") + "</parent>".length,
    xml.indexOf("<properties>"),
  );
  assert.doesNotMatch(head, /<groupId>/);
  assert.doesNotMatch(head, /<version>/);
  assert.match(head, /<artifactId>api<\/artifactId>/);
});

test("reparentPom indents the injected parent block once", () => {
  const xml = reparentPom(GENERATED_POM, PARENT, "../pom.xml");
  assert.match(xml, /^\t<parent>$/m);
  assert.match(xml, /^\t\t<groupId>com\.example<\/groupId>$/m);
  assert.match(xml, /^\t<\/parent>$/m);
});

test("reparentPom keeps the module's own metadata intact", () => {
  const xml = reparentPom(GENERATED_POM, PARENT, "../pom.xml");
  assert.match(xml, /<name>api<\/name>/);
  assert.match(xml, /<java\.version>21<\/java\.version>/);
  assert.match(xml, /spring-boot-starter-webmvc/);
  assert.match(xml, /spring-boot-maven-plugin/);
  assert.match(xml, /<modelVersion>4\.0\.0<\/modelVersion>/);
});

test("reparentPom produces balanced parent tags", () => {
  const xml = reparentPom(GENERATED_POM, PARENT, "../pom.xml");
  assert.equal(xml.match(/<parent>/g)?.length, 1);
  assert.equal(xml.match(/<\/parent>/g)?.length, 1);
});

test("reparentPom inserts a parent block when the generated pom has none", () => {
  const bare = `<?xml version="1.0" encoding="UTF-8"?>
<project>
	<modelVersion>4.0.0</modelVersion>
	<artifactId>api</artifactId>
	<dependencies/>
</project>
`;
  const xml = reparentPom(bare, PARENT, "../pom.xml");
  assert.match(xml, /<artifactId>my-monorepo<\/artifactId>/);
  assert.match(xml, /<relativePath>\.\.\/pom\.xml<\/relativePath>/);
  assert.match(xml, /<artifactId>api<\/artifactId>/);
});

/* -------------------------------------------------------------------------- */
/* Gradle rendering and rewrites                                              */
/* -------------------------------------------------------------------------- */

test("renderGradleSettings includes every module", () => {
  const settings = renderGradleSettings(PARENT, parseModules("api,services/web"), false);
  assert.match(settings, /rootProject\.name = 'my-monorepo'/);
  assert.match(settings, /include 'api'/);
  assert.match(settings, /include 'services\/web'/);
});

test("renderGradleSettings uses Kotlin syntax when asked", () => {
  const settings = renderGradleSettings(PARENT, parseModules("api"), true);
  assert.match(settings, /rootProject\.name = "my-monorepo"/);
  assert.match(settings, /include\("api"\)/);
});

test("renderGradleRootBuild publishes the shared coordinates", () => {
  const build = renderGradleRootBuild(PARENT, false);
  assert.match(build, /group = 'com\.example'/);
  assert.match(build, /version = '0\.0\.1-SNAPSHOT'/);
  // The Boot plugin stays per-module so each Initializr response is self-contained.
  assert.doesNotMatch(build, /org\.springframework\.boot/);
});

test("centralizeGradleCoordinates makes the module read from the root project", () => {
  const build = centralizeGradleCoordinates(GENERATED_BUILD_GRADLE);
  assert.match(build, /group = rootProject\.group/);
  assert.match(build, /version = rootProject\.version/);
});

test("centralizeGradleCoordinates leaves plugin versions untouched", () => {
  const build = centralizeGradleCoordinates(GENERATED_BUILD_GRADLE);
  assert.match(build, /id 'org\.springframework\.boot' version '4\.1\.1'/);
  assert.match(build, /id 'io\.spring\.dependency-management' version '1\.1\.7'/);
});

test("centralizeGradleCoordinates preserves the rest of the build file", () => {
  const build = centralizeGradleCoordinates(GENERATED_BUILD_GRADLE);
  assert.match(build, /repositories \{\n\tmavenCentral\(\)\n\}/);
  assert.match(build, /JavaLanguageVersion\.of\(21\)/);
});

/* -------------------------------------------------------------------------- */
/* validate helpers                                                           */
/* -------------------------------------------------------------------------- */

test("sanitizeArtifactId coerces directory names into artifact ids", () => {
  assert.equal(sanitizeArtifactId("my-monorepo"), "my-monorepo");
  assert.equal(sanitizeArtifactId("my app"), "my-app");
  assert.equal(sanitizeArtifactId("my_app!"), "my_app");
  assert.equal(sanitizeArtifactId("--api--"), "api");
  assert.ok(isValidArtifactId(sanitizeArtifactId("My Cool Repo!")));
});

test("sanitizeArtifactId returns an empty string when nothing usable remains", () => {
  assert.equal(sanitizeArtifactId("!!!"), "");
  assert.equal(sanitizeArtifactId("   "), "");
});
