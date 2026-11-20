# AGENTS.md — Agent Ops

本仓库是 Agent Ops：本地优先的 Agent 控制面。

## 约定

- 包管理器只用 npm，锁文件只用 `package-lock.json`。
- Node.js 22 LTS（`engines: >=22.0.0`）。
- 提交信息用英文 Conventional Commits；每个提交只处理一个独立目的。
- 提交前至少运行 `npm run typecheck && npm test`；Studio 改动另跑 `npm run typecheck -w @agent-ops/studio` 与 `npm run build -w @agent-ops/studio`。
- 本地工作分支为 `dev`；`main` 通过 PR 合入，不直接提交。
- 新能力要同时更新 `README.md`（能力 / 目录）与 `handoff.md`（完成记录与提交号）；属于 PRD 批次的功能再补 `docs/prd/...实施拆解` 里的完成记录。

## 分层边界

- `packages/*` 是 Agent Ops 内核（5 个包：agent-runtime / policy / workflow / storage-core / server-core），不得依赖 `plugins/webapp-delivery/*`。
- `plugins/webapp-delivery/*` 只能依赖内核，不能反向依赖。
- `apps/daemon` 双模：默认只挂载 `createKernelApp`（`@agent-ops/server-core`）；`AGENT_OPS_ENABLE_WEBAPP=1` 时才懒加载 `@agent-ops/delivery-server`（webapp 链路，内部依赖 blueprint / provider-* / deployment-composer / storage-webapp）。默认路径不得 import 插件。
- `plugins/webapp-delivery/apps/studio` 是唯一前端 app；内核 `apps/` 只有 `cli`、`daemon`。
- `packages/agent-runtime` 可以依赖 `@agent-ops/policy`（工具策略的规范语义在 policy 包）；policy 包不得反向依赖 agent-runtime。

## 事实与验收

- README / handoff 里的“已完成”必须能对上代码与测试；拿不到证据的情况（例如真实 CLI 未登录）要写 blocked，不写成通过。
- 测试不得依赖真实模型、真实外部服务或生产数据；执行路径使用注入 runner。
