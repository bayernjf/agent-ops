# AGENTS.md — Agent Ops

本仓库是 Agent Ops：本地优先的 Agent 控制面。

## 约定

- 包管理器只用 npm，锁文件只用 `package-lock.json`。
- Node.js 22 LTS。
- 提交信息用英文 Conventional Commits；每个提交只处理一个独立目的。
- 提交前至少运行 `npm run typecheck && npm test`。
- 本地工作分支为 `dev`；`main` 通过 PR 合入，不直接提交。

## 分层边界

- `packages/*` 是 Agent Ops 内核，不得依赖 `plugins/webapp-delivery/*`。
- `plugins/webapp-delivery/*` 只能依赖内核，不能反向依赖。
- `apps/daemon` 已收敛为只挂载 `@agent-ops/delivery-server`（webapp-delivery 的 HTTP 服务层，其内部依赖 blueprint/provider-*/deployment-composer/storage-webapp），不再直接 import 这些插件。
- 已知待切断的反向依赖：`apps/studio → blueprint`。不得新增反向依赖。
