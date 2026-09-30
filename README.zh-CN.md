# sbc · Spring Boot 脚手架

[English](./README.md) | 简体中文

[![npm version](https://img.shields.io/npm/v/@jeangrey/sbc.svg)](https://www.npmjs.com/package/@jeangrey/sbc)
[![npm downloads](https://img.shields.io/npm/dm/@jeangrey/sbc.svg)](https://www.npmjs.com/package/@jeangrey/sbc)
[![license](https://img.shields.io/npm/l/@jeangrey/sbc.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/@jeangrey/sbc.svg)](https://nodejs.org)

一个 `vue-cli` 风格的交互式命令行工具，用于**创建、搜索并运行** Spring Boot 项目——支持 monorepo 架构，底层由 [Spring Initializr](https://start.spring.io) 或[阿里云镜像](https://start.aliyun.com) 驱动。

## 功能特性

- **创建项目**：像 `vue-cli` 一样，支持交互式提问或通过参数一键生成。
- **搜索 / 筛选依赖**：按 id、名称或描述查询，既可命令行搜索，也可在选择器中输入即时过滤。
- **运行项目**：通过项目自带的 Maven/Gradle Wrapper 启动（`spring-boot:run` / `bootRun`）。
- **Monorepo 支持**：在一个工作区下追踪多个 Spring Boot 模块，并按名称运行任意模块。
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

# 非交互式（只要传入 --deps 即进入非交互模式）
sbc create my-app --type maven-project --java 21 --group com.example -d web,data-jpa

# 生成后立即运行
sbc create my-app -d web --run
```

常用参数：

| 参数 | 说明 |
| --- | --- |
| `--type <id>` | `maven-project` \| `gradle-project` \| `gradle-project-kotlin` |
| `--language <lang>` | `java` \| `kotlin` \| `groovy` |
| `--boot <version>` | Spring Boot 版本，如 `3.5.0` |
| `--java <version>` | Java 版本，如 `21` |
| `--group` / `--artifact` | Maven 坐标 |
| `--package <name>` | 基础包名，如 `com.example.demo` |
| `--packaging <type>` | `jar` \| `war` |
| `-d, --deps <list>` | 逗号分隔的依赖 id 或名称 |
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

### Monorepo 工作区

```bash
# 1. 在 monorepo 根目录创建工作区清单
sbc workspace init

# 2. 创建模块——每个模块会自动登记进 sbc.workspace.json
sbc create services/user-service -d web,data-jpa
sbc create apps/api-gateway --type gradle-project -d web

# 3. 在工作区任意位置查看并运行模块
sbc list
sbc run user-service
```

`sbc.workspace.json` 会记录每个模块的名称、路径、构建类型、语言及 Boot 版本：

```json
{
  "version": 1,
  "modules": [
    { "name": "user-service", "path": "services/user-service", "type": "maven-project", "language": "java", "bootVersion": "3.5.0" }
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
