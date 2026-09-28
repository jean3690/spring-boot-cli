# sbc · Spring Boot CLI

English | [简体中文](./README.zh-CN.md)

[![npm version](https://img.shields.io/npm/v/@jeangrey/sbc.svg)](https://www.npmjs.com/package/@jeangrey/sbc)
[![npm downloads](https://img.shields.io/npm/dm/@jeangrey/sbc.svg)](https://www.npmjs.com/package/@jeangrey/sbc)
[![license](https://img.shields.io/npm/l/@jeangrey/sbc.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/@jeangrey/sbc.svg)](https://nodejs.org)

A `vue-cli` style interactive CLI to **scaffold, search and run** Spring Boot projects — monorepo-aware, powered by [Spring Initializr](https://start.spring.io).

## Features

- **Scaffold** projects interactively (prompts) or non-interactively (flags), just like `vue-cli`.
- **Search / filter** dependencies by id, name or description — from the command line or a type-to-filter picker.
- **Run** a generated project through its Maven/Gradle wrapper (`spring-boot:run` / `bootRun`).
- **Monorepo** support: track multiple Spring Boot modules under one workspace and run any of them by name.

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

### Search dependencies

```bash
sbc search graphql
sbc search "spring security"
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
pnpm dev        # watch mode
```

## License

[ISC](./LICENSE) © jeangrey
