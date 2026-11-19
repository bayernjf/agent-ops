# Agent Ops

本地优先的 Agent 控制面：发现并调度本机已安装的编码 Agent（Claude Code / Codex / OpenCode），以 Task/Run 为单位，在隔离 worktree 内执行，产出可审阅的 diff / 测试 / 日志，人来验收。

## 当前状态

迁移（move 阶段）已完成：内核 4 个 package（agent-runtime / workflow / policy / storage-core）+ 2 个 app（cli / daemon）从 `agent-dev` 抽取到本仓；webapp-delivery 的 6 个包（blueprint / storage-webapp / delivery-server / provider-core / provider-cli / deployment-composer）与 1 个 app（studio）已隔离到 `plugins/webapp-delivery/`。内核不再反向依赖插件。typecheck 通过、测试全绿。

内核 Task/Run 控制面已具备运行证据链：每次 Run 持久化 stdout/stderr（有上限）、完整 diff（含未跟踪文件 patch，有上限）、exit code、耗时、超时标记与变更文件；运行中可通过 SSE 实时查看 stdout/stderr 并取消执行，取消同样落库为证据；Studio 的 Task 看板可展开审阅这些证据后再 accept/reject。

迁移方案见：

`bayjf/docs/tier0/Tier0-agent-dev并入AgentOps-迁移方案-2026-11-18.md`

## 目录

### 内核

- `apps/daemon`：Hono Server（薄挂载层，只挂载 `@agent-ops/delivery-server`）。
- `apps/cli`：doctor / serve / mcp 命令行与 MCP。
- `packages/agent-runtime`：Agent 发现、能力探测、Profile、串行 Pipeline、失败分类。
- `packages/workflow`：状态机引擎（xstate）。
- `packages/policy`：账号发现、连接器、确认策略。
- `packages/storage-core`：SQLite Ledger 内核，task/run/profile/worktree 数据层。

### webapp-delivery 插件

- `plugins/webapp-delivery/apps/studio`：Web App 交付控制台 UI。
- `plugins/webapp-delivery/packages/delivery-server`：webapp-delivery 的 HTTP 服务层（由 daemon 挂载）。
- `plugins/webapp-delivery/packages/blueprint`：产品规范 schema 与计划生成。
- `plugins/webapp-delivery/packages/storage-webapp`：project/blueprint/apply/release 数据层。
- `plugins/webapp-delivery/packages/provider-core` / `provider-cli` / `deployment-composer`：webapp 交付与部署垂直链路。

## 命令

```bash
npm install --legacy-peer-deps
npm run typecheck
npm test
```
