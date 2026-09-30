# sbc · Spring Boot 脚手架

[English](./README.md) | 简体中文

[![npm version](https://img.shields.io/npm/v/@jeangrey/sbc.svg)](https://www.npmjs.com/package/@jeangrey/sbc)
[![npm downloads](https://img.shields.io/npm/dm/@jeangrey/sbc.svg)](https://www.npmjs.com/package/@jeangrey/sbc)
[![license](https://img.shields.io/npm/l/@jeangrey/sbc.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/@jeangrey/sbc.svg)](https://nodejs.org)

一个 `vue-cli` 风格的交互式命令行工具，用于**创建、搜索并运行** Spring Boot 项目——支持 monorepo 架构，底层由 [Spring Initializr](https://start.spring.io) 或[阿里云镜像](https://start.aliyun.com) 驱动。

## 功能特性

- **创建项目**：像 `vue-cli` 一样，支持交互式提问或通过参数一键生成。
- **Monorepo 支持**：`--modules` 生成真正的多模块构建——一个父聚合器、一套 wrapper、一条命令构建全部模块。
- **搜索 / 筛选依赖**：按 id、名称或描述查询，既可命令行搜索，也可在选择器中输入即时过滤。
- **运行项目**：通过项目自带的 Maven/Gradle Wrapper 启动（`spring-boot:run` / `bootRun`）。
- **工作区清单**：一棵 `sbc list` / `sbc run <模块名>` 都能用的 `sbc.workspace.json`。
- **多镜像源**：可在 start.spring.io 与 start.aliyun.com 之间切换，支持按命令、按项目或按环境变量指定。

## 安装

```bash
npm install -g @jeangrey/sbc
# 或临时运行
npx @jeangrey/sbc
```

## 使用

### 创建项目

```bash
# 交互式
sbc create my-app

# 非交互式（传入 --deps 或 --modules 即进入非交互模式）
sbc create my-app --type maven-project --java 21 --group com.example -d web,data-jpa

# 生成多模块 monorepo，而非单个项目
sbc create shop --modules api,core,web -d web

# 生成后立即运行
sbc create my-app -d web --run
```

常用参数：

| 参数 | 说明 |
| --- | --- |
| `--type <id>` | `maven-project` \| `gradle-project` \| `gradle-project-kotlin` |
| `--modules <list>` | 生成 monorepo：`api,core,web` 或 `api:web;core:jdbc,data-jpa` |
| `--language <lang>` | `java` \| `kotlin` \| `groovy` |
| `--boot <version>` | Spring Boot 版本，如 `3.5.0` |
| `--java <version>` | Java 版本，如 `21` |
| `--group` / `--artifact` | Maven 坐标（monorepo 中 `--artifact` 为根工程 artifactId） |
| `--name` / `--description` | 项目名称与描述 |
| `--package <name>` | 基础包名，如 `com.example.demo` |
| `--packaging <type>` | `jar` \| `war` |
| `-d, --deps <list>` | 逗号分隔的依赖 id 或名称 |
| `--config-format <fmt>` | `properties` \| `yml` |
| `--set <key=value>` | 追加一条配置文件条目（可重复） |
| `-f, --force` | 允许写入非空目录 |
| `--run` | 生成后立即运行 |
| `--module <name>` | 注册到工作区的模块名 |
| `--registry <id>` | Initializr 镜像源：`spring` \| `aliyun`，或完整 URL |

### 镜像源

`sbc` 支持任意兼容 Spring Initializr 的服务，内置两个：

| Id | 服务 | 说明 |
| --- | --- | --- |
| `spring`（默认） | [start.spring.io](https://start.spring.io) | 官方服务，Boot 版本最新 |
| `aliyun` | [start.aliyun.com](https://start.aliyun.com) | 阿里云镜像，额外提供 Spring Cloud Alibaba / Nacos / Sentinel / RocketMQ 等 starter，国内访问更快 |

可按次指定、也可持久化到项目或环境变量：

```bash
# 按次指定
sbc create my-app --registry aliyun -d web,data-jpa
sbc search nacos --registry aliyun

# 持久化到项目（写入 sbc.config.json）
sbc config set registry aliyun
sbc create my-app -d web

# 环境变量
export SBC_REGISTRY=aliyun
```

若均未配置，`sbc create` 会在交互模式下询问使用哪个镜像源。

其他 Initializr 服务同样可用，直接传入地址即可，`sbc` 会自动把 Boot 版本
规范化成 Maven Central 上真实存在的坐标：

```bash
sbc create my-app --registry https://start.example.com -d web
```

`SBC_REGISTRY`、`sbc.config.json` 与 `--registry` 接受相同的值。优先级从高到低：
`--registry` → `SBC_REGISTRY` → 最近的 `sbc.config.json`（从目标目录逐级向上查找）→ `spring`。

查看当前配置：

```bash
sbc config show     # 生效的配置及其来源文件
sbc config path     # 最近的 sbc.config.json 路径
```

```json
{
  "version": 1,
  "registry": "aliyun"
}
```

> **关于 Boot 版本**：Spring Boot 制品在 2.4.0 之前使用 `.RELEASE` 后缀
> （如 `2.3.12.RELEASE`），2.4.0 起改为纯语义化版本（如 `2.6.13`）。
> `sbc` 会自动选择该版本在 Maven Central 上真实存在的形式，
> 无论项目由哪个镜像源生成，都能正确解析 BOM。

### 搜索依赖

```bash
sbc search graphql
sbc search "spring security"

# 改为搜索阿里云镜像源
sbc search nacos --registry aliyun
```

### 运行项目

```bash
# 运行当前目录的项目
sbc run

# 在工作区内任意位置，按名称运行某个模块
sbc run my-app

# 向 mvnw/gradlew 透传额外参数
sbc run my-app -- --debug
```

### Monorepo（多模块构建）

`sbc create --modules` 生成的是真正的构建 reactor，而不是一堆互不相干的项目：
根目录是父聚合器，所有模块都继承自它，一条 `./mvnw` / `./gradlew` 即可构建整棵树。

```bash
# 交互式——被问到布局时选 Monorepo，然后逐个添加模块
sbc create shop

# 非交互式：平铺模块，统一使用 --deps 的依赖
sbc create shop --modules api,core,web -d web

# 嵌套路径 + 每个模块各自的依赖
sbc create shop --modules "api:web,data-jpa;services/gateway:web;core"

# Gradle 用法完全一致
sbc create shop --modules api,web --type gradle-project
```

生成结果是一整个 reactor：

```
shop/
├── pom.xml          # <packaging>pom</packaging> + <modules>
├── mvnw             # 整棵树只有一套 wrapper
├── sbc.workspace.json
├── api/
│   ├── pom.xml      # <parent> → ../pom.xml
│   └── src/main/java/com/example/api/ApiApplication.java
├── core/
│   └── pom.xml      # <parent> → ../pom.xml
└── services/gateway/
    └── pom.xml      # <parent> → ../../pom.xml
```

各模块共享构建工具、语言、Boot 版本、Java 版本与 groupId，仅在 artifactId、
包名与依赖上不同。只需在根 `pom.xml` 改一次 Boot 版本，所有模块随之更新。

```bash
cd shop
./mvnw install -DskipTests            # 构建全部模块
./mvnw -pl api spring-boot:run        # 运行单个模块
sbc list                              # 列出所有模块
sbc run api                           # 同上，可在任意位置执行
```

Gradle 根目录会生成带 `include` 的 `settings.gradle`（或 `.kts`），
各模块的构建脚本从 `rootProject` 读取 `group` 与 `version`。

### 工作区

工作区就是任何含有 `sbc.workspace.json` 的目录。`sbc create` 会自动维护它——
monorepo 会写在根目录，独立项目则自动登记到外层已有的工作区：

```bash
# 把多个独立构建的项目统一追踪在一个根目录下
sbc workspace init
sbc create services/user-service -d web,data-jpa
sbc create apps/api-gateway --type gradle-project -d web

sbc list
sbc run user-service
```

清单记录了聚合器（当根目录是 reactor 时）以及每个模块的名称、路径、
构建类型、语言、Boot 版本与所属父工程：

```json
{
  "version": 2,
  "root": { "artifactId": "shop", "type": "maven-project", "bootVersion": "4.1.1" },
  "modules": [
    {
      "name": "api",
      "path": "services/api",
      "type": "maven-project",
      "language": "java",
      "bootVersion": "4.1.1",
      "parent": "shop"
    }
  ]
}
```

## 开发

```bash
pnpm install
pnpm build      # 使用 tsup 打包到 dist/
pnpm test       # 单元测试（node:test）
pnpm dev        # 监听模式
```

## 许可证

[ISC](./LICENSE) © jeangrey
