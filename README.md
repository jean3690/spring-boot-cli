# sbc · Spring Boot CLI

English | [简体中文](./README.zh-CN.md)

[![npm version](https://img.shields.io/npm/v/@jeangrey/sbc.svg)](https://www.npmjs.com/package/@jeangrey/sbc)
[![npm downloads](https://img.shields.io/npm/dm/@jeangrey/sbc.svg)](https://www.npmjs.com/package/@jeangrey/sbc)
[![license](https://img.shields.io/npm/l/@jeangrey/sbc.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/@jeangrey/sbc.svg)](https://nodejs.org)

A `vue-cli` style interactive CLI to **scaffold, search and run** Spring Boot projects — monorepo-aware, powered by [Spring Initializr](https://start.spring.io) or the [Alibaba Cloud mirror](https://start.aliyun.com).

## Features

- **Scaffold** projects interactively (prompts) or non-interactively (flags), just like `vue-cli`.
- **Search / filter** dependencies by id, name or description — from the command line or a type-to-filter picker.
- **Run** a generated project through its Maven/Gradle wrapper (`spring-boot:run` / `bootRun`).
- **Monorepo** support: track multiple Spring Boot modules under one workspace and run any of them by name.
- **Multiple registries** — switch between start.spring.io and start.aliyun.com per command, per project, or via an environment variable.

## Install

```bash
npm install -g @jeangrey/sbc
# or run once
npx @jeangrey/sbc
```

## Usage

### Create a project

```bash
# Interactive
sbc create my-app

# Non-interactive (any provided --deps enables non-interactive mode)
sbc create my-app --type maven-project --java 21 --group com.example -d web,data-jpa

# Generate and run immediately
sbc create my-app -d web --run
```

Key options:

| Option | Description |
| --- | --- |
| `--type <id>` | `maven-project` \| `gradle-project` \| `gradle-project-kotlin` |
| `--language <lang>` | `java` \| `kotlin` \| `groovy` |
| `--boot <version>` | Spring Boot version, e.g. `3.5.0` |
| `--java <version>` | Java version, e.g. `21` |
| `--group` / `--artifact` | Maven coordinates |
| `--package <name>` | Base package, e.g. `com.example.demo` |
| `--packaging <type>` | `jar` \| `war` |
| `-d, --deps <list>` | Comma-separated dependency ids or names |
| `-f, --force` | Write into a non-empty directory |
| `--run` | Run the project after generating |
| `--module <name>` | Workspace module name to register |
| `--registry <id>` | Initializr registry: `spring` \| `aliyun`, or a full URL |

### Registries

`sbc` can scaffold from any Initializr-compatible service. Two are built in:

| Id | Service | Notes |
| --- | --- | --- |
| `spring` (default) | [start.spring.io](https://start.spring.io) | Official service, newest Boot versions |
| `aliyun` | [start.aliyun.com](https://start.aliyun.com) | Alibaba Cloud mirror, adds Spring Cloud Alibaba / Nacos / Sentinel / RocketMQ starters, faster from mainland China |

Pick one per invocation, persist it for a project, or set it in the environment:

```bash
# Per command
sbc create my-app --registry aliyun -d web,data-jpa
sbc search nacos --registry aliyun

# Persist for the project (writes sbc.config.json)
sbc config set registry aliyun
sbc create my-app -d web

# Environment variable
export SBC_REGISTRY=aliyun
```

When nothing is configured, `sbc create` asks which registry to use interactively.

Any other Initializr service works too — pass its base URL, and the Boot version
is normalised to a coordinate that exists on Maven Central:

```bash
sbc create my-app --registry https://start.example.com -d web
```

`SBC_REGISTRY`, `sbc.config.json` and the flag accept the same values. Resolution
order, highest priority first: `--registry` → `SBC_REGISTRY` → the nearest
`sbc.config.json` (searched upwards from the target directory) → `spring`.

Inspect the current configuration with:

```bash
sbc config show     # resolved values and the file they came from
sbc config path     # path of the nearest sbc.config.json
```

```json
{
  "version": 1,
  "registry": "aliyun"
}
```

> **Note on Boot versions.** Spring Boot artifacts used a `.RELEASE` suffix
> before 2.4.0 (`2.3.12.RELEASE`) and plain semver from 2.4.0 on (`2.6.13`).
> `sbc` sends whichever form actually exists on Maven Central for the version
> you pick, so generated builds resolve their BOM on both old and new releases —
> regardless of which registry served the project.

### Search dependencies

```bash
sbc search graphql
sbc search "spring security"

# Search the Alibaba Cloud registry instead
sbc search nacos --registry aliyun
```

### Run a project

```bash
# Run the project in the current directory
sbc run

# Run a workspace module by name, from anywhere in the workspace
sbc run my-app

# Forward extra arguments to mvnw/gradlew
sbc run my-app -- --debug
```

### Monorepo workspace

```bash
# 1. Create a workspace manifest at the monorepo root
sbc workspace init

# 2. Scaffold modules — each is auto-registered in sbc.workspace.json
sbc create services/user-service -d web,data-jpa
sbc create apps/api-gateway --type gradle-project -d web

# 3. Inspect and run modules from anywhere in the workspace
sbc list
sbc run user-service
```

`sbc.workspace.json` records each module's name, path, build type, language and Boot version:

```json
{
  "version": 1,
  "modules": [
    { "name": "user-service", "path": "services/user-service", "type": "maven-project", "language": "java", "bootVersion": "3.5.0" }
  ]
}
```

## Development

```bash
pnpm install
pnpm build      # bundle to dist/ with tsup
pnpm test       # unit tests (node:test)
pnpm dev        # watch mode
```

## License

[ISC](./LICENSE) © jeangrey
