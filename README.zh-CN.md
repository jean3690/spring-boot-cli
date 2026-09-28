# sbc · Spring Boot 脚手架

[English](./README.md) | 简体中文

一个 `vue-cli` 风格的交互式命令行工具，用于**创建、搜索并运行** Spring Boot 项目——支持 monorepo 架构，底层由 [Spring Initializr](https://start.spring.io) 驱动。

## 功能特性

- **创建项目**：像 `vue-cli` 一样，支持交互式提问或通过参数一键生成。
- **搜索 / 筛选依赖**：按 id、名称或描述查询，既可命令行搜索，也可在选择器中输入即时过滤。
- **运行项目**：通过项目自带的 Maven/Gradle Wrapper 启动（`spring-boot:run` / `bootRun`）。
- **Monorepo 支持**：在一个工作区下追踪多个 Spring Boot 模块，并按名称运行任意模块。

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

### 搜索依赖

```bash
sbc search graphql
sbc search "spring security"
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
pnpm dev        # 监听模式
```

## 许可证

[ISC](./LICENSE) © jeangrey
