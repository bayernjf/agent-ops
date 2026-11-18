# Agent Ops

本地优先的 Agent 控制面：发现并调度本机已安装的编码 Agent（Claude Code / Codex / OpenCode），以 Task/Run 为单位，在隔离 worktree 内执行，产出可审阅的 diff / 测试 / 日志，人来验收。

## 当前状态

迁移（move 阶段）已完成：8 个 package + 3 个 app 全部从 `agent-dev` 抽取到本仓，typecheck 通过、570 tests 全绿。后续 webapp-delivery 插件化见迁移方案：

`bayjf/docs/tier0/Tier0-agent-dev并入AgentOps-迁移方案-2026-11-18.md`

## 目录

- `apps/daemon`：Hono Server 内核。
- `apps/cli`：doctor / serve / mcp 命令行与 MCP。
- `apps/studio`：React 控制台 UI。
- `packages/agent-runtime`：Agent 发现、能力探测、Profile、串行 Pipeline、失败分类。
- `packages/workflow`：交付状态机（xstate）。
- `packages/policy`：账号发现、连接器、确认策略。
- `packages/blueprint`：产品规范 schema 与计划生成（共享 schema）。
- `packages/storage`：SQLite Ledger，evidence、质量门、git 证据。
- `packages/provider-core` / `provider-cli` / `deployment-composer`：webapp-delivery 垂直链路（P2 将插件化）。

## 命令

```bash
npm install --legacy-peer-deps
npm run typecheck
npm test
```
