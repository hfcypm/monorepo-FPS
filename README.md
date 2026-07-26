# my-monorepo

基于 [Bun](https://bun.com) 的 TypeScript Monorepo 项目。

## 项目结构

```
my-monorepo/
├── package.json                 # 根工作区配置
├── tsconfig.json                # 共享 TypeScript 配置
├── scripts/
│   └── link-workspaces.sh       # postinstall 工作区链接脚本
└── packages/
    ├── shared/                  # @my-monorepo/shared  公共工具库
    │   ├── src/index.ts
    │   └── test/index.test.ts
    ├── server/                  # @my-monorepo/server  HTTP 服务
    │   └── src/index.ts
    └── client/                  # @my-monorepo/client  客户端入口
        └── src/index.ts
```

## 架构

```
┌──────────────┐     ┌──────────────┐
│   server     │     │   client     │
│  (Bun HTTP)  │     │  (入口脚本)   │
└──────┬───────┘     └──────┬───────┘
       │    workspace:*     │
       └────────┬───────────┘
                │
        ┌───────┴───────┐
        │    shared     │
        │  (公共工具库)  │
        └───────────────┘
```

- **shared** — 提供 `greet()`、`add()` 等公共方法，被 server 和 client 共同依赖
- **server** — 基于 `Bun.serve` 的 HTTP 服务，端口 `3001`，提供 `/api/hello` 接口
- **client** — 引用 shared 的客户端脚本

包间依赖通过 Bun 的 `workspace:*` 协议声明。

## 快速开始

### 环境要求

- [Bun](https://bun.com) >= 1.3

### 安装

```bash
bun install
```

`postinstall` 脚本会自动为工作区包创建 `node_modules` 符号链接。

### 常用命令

| 命令 | 说明 |
|------|------|
| `bun install` | 安装所有依赖 |
| `bun test` | 运行全部测试 |
| `bun run dev` | 启动所有包的 dev 脚本 |
| `bun run build` | 构建所有包 |
| `bun run clean` | 清理构建产物和依赖 |

### 单独启动某个包

```bash
# 启动 server（热重载）
bun run --filter '@my-monorepo/server' dev

# 运行 client
bun run --filter '@my-monorepo/client' dev

# 运行 shared 测试
bun run --filter '@my-monorepo/shared' test
```

## ADB 本地诊断模式

服务端支持直接读取已授权 Android 设备的当前前台应用，无需在应用工程中集成 SDK。采集器通过 `dumpsys gfxinfo` 提取帧耗时、FPS、卡顿率、P95、P99 和冻结帧，并在高风险窗口尝试获取主线程堆栈。

```bash
export ADB_PATH=/opt/android-sdk/platform-tools/adb
bun run --filter '@my-monorepo/server' dev
```

开发看板通过以下命令启动：

```bash
bun run --filter '@my-monorepo/client' dev
```

设备连接后执行以下命令确认授权状态：

```bash
$ADB_PATH devices -l
```

设备列表出现 `device` 状态后，打开看板即可查看当前前台应用的实时性能数据。

## 技术栈

- **运行时**: Bun 1.3
- **语言**: TypeScript 5
- **包管理**: Bun Workspaces
- **构建**: `bun build`
- **测试**: `bun test`
