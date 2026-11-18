# Agent Ops

本地优先的 Agent 控制面：发现并调度本机已安装的编码 Agent（Claude Code / Codex / OpenCode），以 Task/Run 为单位，在隔离 worktree 内执行，产出可审阅的 diff / 测试 / 日志，人来验收。

## 当前状态

迁移（move 阶段）已完成：Agent Ops 内核 4 个 package（agent-runtime / workflow / policy / storage）+ 3 个 app 已从 `agent-dev` 抽取到本仓；webapp-delivery 的 4 个包（blueprint / provider-core / provider-cli / deployment-composer）已隔离到 `plugins/webapp-delivery/packages/`。typecheck 通过、570 tests 全绿。内核对插件的反向依赖切断见迁移方案：

`bayjf/docs/tier0/Tier0-agent-dev并入AgentOps-迁移方案-2026-11-18.md`

## 目录

- `apps/daemon`：Hono Server 内核。
- `apps/cli`：doctor / serve / mcp 命令行与 MCP。
- `apps/studio`：React 控制台 UI。
### 内核

- `packages/agent-runtime`：Agent 发现、能力探测、Profile、串行 Pipeline、失败分类。
- `packages/workflow`：状态机引擎（xstate）。
- `packages/policy`：账号发现、连接器、确认策略。
- `packages/storage`：SQLite Ledger，evidence、质量门、git 证据。

### webapp-delivery 插件

- `plugins/webapp-delivery/packages/blueprint`：产品规范 schema 与计划生成。
- `plugins/webapp-delivery/packages/provider-core` / `provider-cli` / `deployment-composer`：webapp 交付与部署垂直链路。

## 命令

```bash
npm install --legacy-peer-deps
npm run typecheck
npm test
```
