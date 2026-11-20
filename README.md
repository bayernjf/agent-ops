# Agent Ops

本地优先的 Agent 控制面：发现并调度本机已安装的编码 Agent（Claude Code / Codex / OpenCode 等），以 Task/Run 为单位在隔离 worktree 内执行，产出可审阅的证据，人来验收。

## 当前状态

- 内核 **5 个 package**：`agent-runtime` / `workflow` / `policy` / `storage-core` / `server-core`；内核 **2 个 app**：`cli` / `daemon`。
- `daemon` **双模**：默认只挂载内核 Task/Run 控制面（`server-core`）；`AGENT_OPS_ENABLE_WEBAPP=1` 时懒加载 webapp-delivery 云链路（Project / Blueprint / Apply / Release）。
- webapp-delivery 的 7 个 package 与 1 个 app（`studio`）隔离在 `plugins/webapp-delivery/`，内核不反向依赖插件。
- 全仓 `npm run typecheck` 通过，`npm test` 62 文件 / 730 tests 全绿。
- **真实模型 Run 已跑通（2026-11-20）**：本机已登录的 **CodeBuddy v2.185.0**（registry 中的 `verified` adapter）通过内核 API 完成 1 条真实写任务并 accept（commit `2020338`）。Studio UI 点击验收仍待做；Claude Code / Codex 仍受 CC Switch `base_url` 阻塞。

## 内核能力

| 能力 | 说明 |
|---|---|
| Task / Run | 每任务一个 worktree；Run 持久化 stdout/stderr、完整 diff（含未跟踪 patch）、exit code、耗时、usage；SSE 实时输出与取消 |
| Roles | 角色绑定 Profile / base agent、系统提示、验收标准、工具策略与成本预算；内置 architect / implementer / reviewer / tester / researcher 模板 |
| Teams + Handoff | 团队 = 花名册 + 交接边；Pipeline 每跨一条边写一条交接收据（上游 commit + changedFiles） |
| 串行 Pipeline | 每步独立 Run，成功后自动提交并交接；支持每步审批门、失败重跑、从失败 step 重试 |
| 并行 DAG | 步骤可写 `dependsOn`（`[]` 为根）；ready steps 在各自 worktree 内有界并发，失败依赖跳过下游，文件冲突只报告、不合并 |
| Coordinator | 按团队花名册与交接边推导 Pipeline（确定性拓扑序），预览后由人点击应用；另有不调模型的分步汇总 |
| 并行 lanes | 每角色独立 worktree，有界并发；lane 结束后统一任务状态；文件级冲突只报告、不自动合并；接受 / 驳回按 lane 独立提交与 pin |
| 证据与审计 | Run 证据（含实际工具调用与被拒原因，拿不到标 unknown）；append-only 审计可回放；单任务 JSON 导出；成功率 / 返工 / 用量 / 耗时指标 |
| 成本预算 | Role / Team 可设 cost / token 上限，按任务已上报用量检查，超限阻断 createRun 与 executeRun |
| 重跑 hygiene | 失败 Run 默认 reset 到 base commit；可选 keep 保留残留或 fresh 重建 worktree |

## 目录

### 内核

- `apps/daemon`：Hono 服务入口，默认挂载 `createKernelApp`；`AGENT_OPS_ENABLE_WEBAPP=1` 时叠加 webapp-delivery。
- `apps/cli`：`doctor` / `start` / `mcp` / `export` 命令与 MCP server。
- `packages/agent-runtime`：Agent 探测、Runtime Registry、Profiles、Roles、Role 模板、Teams、串行 Pipeline、Tool Policy、失败分类、工具审计。
- `packages/policy`：运行时无关的工具策略求值（allow / deny / approval）、账号发现、连接器、确认策略。
- `packages/workflow`：Task/Run 状态机引擎（xstate）。
- `packages/storage-core`：内核数据层（SQLite + JSON store）：Task/Run 证据、Role/Team、Pipeline、交接、审计、指标、预算、worktree 生命周期。
- `packages/server-core`：内核 HTTP 控制面（`/api/tasks`、`/api/runs`、`/api/roles`、`/api/teams`、`/api/audit`、`/api/metrics`、`/api/policy/evaluate` 等）。

### webapp-delivery 插件

- `plugins/webapp-delivery/apps/studio`：Studio UI（Projects、Tasks、Roles、Teams、Metrics …）。
- `plugins/webapp-delivery/packages/{blueprint, storage-webapp, delivery-server, delivery-workflow, provider-core, provider-cli, deployment-composer}`：webapp 交付与部署链路。

## 命令

```bash
npm install --legacy-peer-deps
npm run typecheck
npm test
```

按 workspace 运行：

```bash
npm run typecheck -w @agent-ops/studio
npm test -w @agent-ops/storage-core
```

CLI：

```bash
npx tsx apps/cli/src/index.ts doctor     # 本机工具链与连接器检查
npx tsx apps/cli/src/index.ts start      # 启动内核 daemon
npx tsx apps/cli/src/index.ts mcp        # MCP server（stdio）
npx tsx apps/cli/src/index.ts export <taskId> [--out file]   # 导出单任务证据
```

## 文档

- `handoff.md`：**唯一活跃待办入口**与逐项完成记录（含提交号）。
- `docs/prd/Agent-Ops-多Agent角色与团队-PRD-2026-11-19.md`：角色 / 团队 / 交接 / 并行 PRD。
- `docs/prd/Agent-Ops-多Agent角色与团队-实施拆解-2026-11-19.md`：功能点拆解与验收口径。
- `AGENTS.md`：仓库约定与分层边界。
- 迁移方案：`bayjf/docs/tier0/Tier0-agent-dev并入AgentOps-迁移方案-2026-11-18.md`。

## 已知限制

- 真实模型的执行入口已可用（CodeBuddy）；token/cost 与工具审计仍取决于 Runtime 是否上报，CodeBuddy 当前不报。
- 并行团队不自动合并，也没有“选哪条 lane 作为最终交付”的一等操作。
- 预算为任务内口径，不跨任务累计；只在启动前阻断。
- Studio 部分新面板（Teams 计划、Metrics、试跑、工具审计）尚未在真实浏览器逐项点击验证。
