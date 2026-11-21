# Agent Ops

本地优先的 Agent 控制面：发现并调度本机已安装的编码 Agent（Claude Code / Codex / OpenCode 等），以 Task/Run 为单位在隔离 worktree 内执行，产出可审阅的证据，人来验收。

## 当前状态

- 内核 **5 个 package**：`agent-runtime` / `workflow` / `policy` / `storage-core` / `server-core`；内核 **2 个 app**：`cli` / `daemon`。
- `daemon` **双模**：默认只挂载内核 Task/Run 控制面（`server-core`）；`AGENT_OPS_ENABLE_WEBAPP=1` 时懒加载 webapp-delivery 云链路（Project / Blueprint / Apply / Release）。
- webapp-delivery 的 7 个 package 与 1 个 app（`studio`）隔离在 `plugins/webapp-delivery/`，内核不反向依赖插件。
- 全仓 `npm run typecheck` 通过，`npm test` 62 文件 / 737 tests 全绿。
- **真实模型验收已完成（2026-11-20）**：CodeBuddy v2.185.0（registry 中的 `verified` adapter）通过内核 API 完成 1 条真实任务，随后在 Studio UI 里用“角色 + 一步 Pipeline + Run pipeline”跑通第二条（commit `ea4553f7d2`）。Claude Code / Codex 仍受 CC Switch `base_url` 阻塞，不影响 CodeBuddy 路径。
- **真实 dogfood 已完成 3 条 + 4 次团队运行（2026-11-21）**：3 条单任务（Studio 重跑策略、Studio 预算面板、CLI `export --summary`）接受率 3/3、检查通过 3/3、返工 1 次小修；五角色团队串行完成（首轮暴露“落盘 owner 未指派”），owner 机制补齐后重跑成功；带依赖链接的 worktree 让五角色跑通了一个**真实代码任务**（新增 `listTasksByTeam` + 单测，reviewer→owner 修正了恒真断言）。详见 `handoff.md`。

## 内核能力

| 能力 | 说明 |
|---|---|
| Task / Run | 每任务一个 worktree（自动链接仓库 `node_modules`，`AGENT_OPS_LINK_NODE_MODULES=0` 关闭）；Run 持久化 stdout/stderr、完整 diff（含未跟踪 patch）、exit code、耗时、usage；SSE 实时输出与取消 |
| Roles | 角色绑定 Profile / base agent、系统提示、验收标准、工具策略与成本预算；内置 architect / implementer / reviewer / tester / researcher 模板 |
| Teams + Handoff | 团队 = 花名册 + 交接边 + 可选 owner（落盘角色，必须最后一步且不再交接）；Pipeline 每跨一条边写一条交接收据（上游 commit + changedFiles） |
| 串行 Pipeline | 每步独立 Run，成功后自动提交并交接；支持每步审批门、失败重跑、从失败 step 重试 |
| 并行 DAG | 步骤可写 `dependsOn`（`[]` 为根）；ready steps 在各自 worktree 内有界并发，失败依赖跳过下游，文件冲突只报告、不合并 |
| Coordinator | 按团队花名册与交接边推导 Pipeline（确定性拓扑序），预览后由人点击应用；owner 置末并标记 `ownsDeliverable`，完成后若没改动任何文件会在 summary 里告警 |
| 并行 lanes | 每角色独立 worktree，有界并发；lane 结束后统一任务状态；文件级冲突只报告、不自动合并；接受 / 驳回按 lane 独立提交与 pin |
| 证据与审计 | Run 证据（含实际工具调用与被拒原因，拿不到标 unknown）；append-only 审计可回放；单任务 JSON 导出；成功率 / 返工 / 用量 / 耗时指标 |
| 成本预算 | Role / Team 可设 cost / token 上限，按任务已上报用量检查，超限阻断 createRun 与 executeRun |
| 重跑 hygiene | 失败 Run 默认 reset 到 base commit；可选 keep 保留残留或 fresh 重建 worktree |

## 报告指标

内核从三类口径报告任务与运行的证据指标：运行证据、工具审计、成本预算。字段与语义以源码和测试为准。

### 运行证据

每个 Run 持久化合并后的 `output`（stdout/stderr 合并，超限截断）与 `diff`（含未跟踪 patch，超限截断），均带 `outputTruncated` / `diffTruncated` 标志（上限 `RUN_OUTPUT_LIMIT` / `RUN_DIFF_LIMIT`），同时记录 exit code、耗时与 usage；分离的 stdout/stderr 另以事件落库（每 Run 保留最近 500 条）用于 SSE 实时投递与回放，运行中可取消。证据落在 `packages/storage-core`；单任务可用 `export <taskId> --summary` 导出摘要。

汇总指标（`KernelMetrics`，由 `getMetrics()` 返回）：

| 分组 | 字段 | 语义 |
|---|---|---|
| `tasks` | `total` / `done` / `failed` / `cancelled` / `open` | 任务计数 |
| `runs` | `total` / `executed` / `succeeded` / `failed` / `cancelled` / `inFlight` | Run 计数 |
| `runs.successRate` | `succeeded / executed` | 无执行时为 `null` |
| `rework` | `retries` / `rejections` / `reworkRate` | `(retries + rejections) / executed`，启发式 |
| `usage` | `reportingRuns` / `inputTokens` / `outputTokens` / `costUsd` | 仅统计至少上报一个用量字段的 run；无任何 run 上报时三项全为 `null`，否则未上报维度为 `0` |
| `timing` | `totalDurationMs` / `averageDurationMs` | 总耗时 / 平均耗时 |
| `byRuntime` | `runtimeId` + 计数 / 耗时 / `costUsd` | 按运行时分桶；`costUsd` 无上报时为 `null` |
| `byRole` | `roleId` + 计数 / 耗时 | 按角色分桶 |

> 单 Run 的原始证据字段（output、diff、exit code、usage）在 `RunRecord` / `RunArtifacts`；`getMetrics()` 返回的是**汇总指标**，不直接暴露单 Run 的 output/diff。

### 工具审计

工具审计从 Run 的输出中抽取实际工具调用（`packages/agent-runtime/src/tool-audit.ts`）：

| 类型 | 字段 | 语义 |
|---|---|---|
| `ToolCallAudit` | `name` / `status` / `reason` | 单次工具调用；`status ∈ {ok, denied}`（类型联合含 `unknown`，但抽取器不产出），`reason` 可空 |
| `ToolAudit` | `calls[]` / `source` / `reason` | 一次 Run 的工具使用；`source ∈ {runtime, unknown}`，未识别时整次 Run 的 `source = 'unknown'` 且 `reason` 为固定说明文案 |
| 常量 | `TOOL_AUDIT_LIMIT = 100` | 去重键 `name\|status\|reason`，达到上限即停 |

识别规则：`tool_use` / `tool_call` / `function_call` / `mcp_tool_call` 记为 `ok`；`permission_denials` 记为 `denied`（名字取 `tool_name` / `name`，缺省为 `unknown-tool`）。Runtime 未报工具调用时不猜测，整次 Run 标记 `source = 'unknown'`。

### 成本预算

Role / Team 可设成本与 token 上限（`maxCostUsd` / `maxInputTokens` / `maxOutputTokens`，定义在 `packages/agent-runtime/src/teams.ts` 与 `roles.ts`），超限阻断 `createRun` 与 `executeRun`，并写入 `budget.blocked` 审计事件。`budgetStatus(taskId, roleId)` 返回 `role` / `team` 两个维度：

| 字段 | 语义 |
|---|---|
| `scope` / `scopeId` | `role` 或 `team` |
| `configured` | 是否配置了上限 |
| `exceeded` | 是否已超限 |
| `reasons` | 超限原因列表 |
| `limits` | `maxCostUsd` / `maxInputTokens` / `maxOutputTokens`（未设置即不限制） |
| `spend.costUsd` / `spend.inputTokens` / `spend.outputTokens` | 已上报用量；逐字段：该字段无任何 run 上报时为 `null`（与 `usage` 的整段 `null` 语义不同） |
| `spend.reportingRuns` | 至少上报一个用量字段的 run 数 |
| `spend.totalRuns` | 全部 run 数 |

两条口径：预算为**任务内**口径，不跨任务累计，只在启动前阻断；Runtime 未上报用量时**不阻断**（`spend.costUsd = null`、`reportingRuns = 0`、`exceeded = false`）。

Studio 的 Role / Team 表单可编辑这三项上限（留空即该维度不限），编辑时回填既有值；已实测创建与编辑回填。清空已配置的预算目前 API 不支持——表单留空只会省略 `budget` 字段，既有上限保留。

实测记录见 `handoff.md`。

## 目录

### 内核

- `apps/daemon`：Hono 服务入口，默认挂载 `createKernelApp`；`AGENT_OPS_ENABLE_WEBAPP=1` 时叠加 webapp-delivery。
- `apps/cli`：`doctor` / `start` / `mcp` / `export` 命令与 MCP server。
- `packages/agent-runtime`：Agent 探测、Runtime Registry、Profiles、Roles、Role 模板、Teams、串行 Pipeline、Tool Policy、失败分类、工具审计。
- `packages/policy`：运行时无关的工具策略求值（allow / deny / approval）、账号发现、连接器、确认策略。
- `packages/workflow`：Task/Run 状态机引擎（xstate）。
- `packages/storage-core`：内核数据层（SQLite + JSON store）：Task/Run 证据、Role/Team、Pipeline、交接、审计、指标、预算、worktree 生命周期。
- `packages/server-core`：内核 HTTP 控制面（`/api/tasks`、`/api/runs`、`/api/roles`、`/api/teams`、`/api/teams/:teamId/tasks`、`/api/audit`、`/api/metrics`、`/api/policy/evaluate` 等）。

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
npx tsx apps/cli/src/index.ts export <taskId> [--summary] [--out file]   # 导出单任务证据（--summary 输出紧凑摘要）
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
- Studio 的 Metrics 页与 Teams 计划预览尚未在真实浏览器逐项点击验证（Role/Team 预算输入与任务预算面板已实测）。
- worktree 只链接根 `node_modules`：仓库本身未安装依赖时仍需先 `npm ci`；跨包的 TypeScript 类型可能指回主仓源码。
- SSE 实时投递在本地 UI 用过，终态回放与重启回放有测试覆盖，但未做长时间 / 并发压测。
