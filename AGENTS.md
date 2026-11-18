# AGENTS.md — Agent Ops

本仓库是 Agent Ops：本地优先的 Agent 控制面。

## 约定

- 包管理器只用 npm，锁文件只用 `package-lock.json`。
- Node.js 22 LTS。
- 提交信息用英文 Conventional Commits；每个提交只处理一个独立目的。
- 提交前至少运行 `npm run typecheck && npm test`。
- 本地工作分支为 `dev`；`main` 通过 PR 合入，不直接提交。
