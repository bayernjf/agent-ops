# Agent Ops

本地优先的 Agent 控制面：发现并调度本机已安装的编码 Agent（Claude Code / Codex / OpenCode 等），以 Task/Run 为单位在隔离 worktree 内执行，产出可审阅的证据，人来验收。

## 当前状态

- 内核 **5 个 package**：`agent-runtime` / `workflow` / `policy` / `storage-core` / `server-core`；内核 **2 个 app**：`cli` / `daemon`。
- `daemon` **双模**：默认只挂载内核 Task/Run 控制面（`server-core`）；`AGENT_OPS_ENABLE_WEBAPP=1` 时懒加载 webapp-delivery 云链路（Project / Blueprint / Apply / Release）。
- webapp-delivery 的 7 个 package 与 1 个 app（`studio`）隔离在 `plugins/webapp-delivery/`，内核不反向依赖插件。
- 全仓 `npm run typecheck` 通过，`npm test` 69 文件 / 789 tests 全绿。
- **真实模型验收已完成（2026-11-20）**：CodeBuddy v2.185.0（registry 中的 `verified` adapter）通过内核 API 完成 1 条真实任务，随后在 Studio UI 里用“角色 + 一步 Pipeline + Run pipeline”跑通第二条（commit `ea4553f7d2`）。Claude Code / Codex 仍受 CC Switch `base_url` 阻塞，不影响 CodeBuddy 路径。
- **真实 dogfood 已完成 3 条 + 4 次团队运行（2026-11-21）**：3 条单任务（Studio 重跑策略、Studio 预算面板、CLI `export --summary`）接受率 3/3、检查通过 3/3、返工 1 次小修；五角色团队串行完成（首轮暴露“落盘 owner 未指派”），owner 机制补齐后重跑成功；带依赖链接的 worktree 让五角色跑通了一个**真实代码任务**（新增 `listTasksByTeam` + 单测，reviewer→owner 修正了恒真断言）。详见 `handoff.md`。

## 内核能力

| 能力 | 说明 |
|---|---|
| Task / Run | 每任务一个 worktree（自动链接仓库 `node_modules`，`AGENT_OPS_LINK_NODE_MODULES=0` 关闭）；Run 持久化 stdout/stderr、完整 diff（含未跟踪 patch）、exit code、耗时、usage；SSE 实时输出与取消 |
| Run 身份 | `POST /api/tasks/:id/runs` 的 `agentId` 可省略：显式值优先，否则继承 Task Role 的 `profileId`，无 Profile 时回退 Role 的 `baseAgentId`；Role 绑定 Profile 时仍校验 base 兼容，无 Role 且无 `agentId` 返回 400 |
| Task Role 改绑 | `PATCH /api/tasks/:id` 可在创建后改绑或清空 Task Role（传 `null`）；新 Role 必须存在、启用且在该 Task 的 Team 花名册内，成功写 `task.updated` 审计；后续 Run 按新 Role 继承身份 |
| 任务视图 | Studio 任务页提供 List / Board 切换；看板按 `queued` / `running` / `review` / `done` / `failed` / `cancelled` 六状态分列，列头带计数，卡片展示 `repo@baseRef`、Pipeline 状态与 Team/Role chip；点卡片回到列表定位并展开该任务 |
| 任务取消 | `POST /api/tasks/:id/cancel` 取消 `queued` / `running` / `review` 任务：终止活动 Run，串行 Pipeline、DAG、并行 lane 都停止后续步骤，任务与 Run 证据保留；终态任务返回 409 |
| Roles | 角色绑定 Profile / base agent、系统提示、验收标准、工具策略与成本预算；内置 architect / implementer / reviewer / tester / researcher 模板 |
| 策略预览 | 角色表单保存前调用 `POST /api/policy/evaluate`，逐 Runtime 展示只读、执行精度、人工门、allow/deny 判定与不支持原因；策略一改，旧结果立即清空 |
| Teams + Handoff | 团队 = 花名册 + 交接边 + 可选 owner（落盘角色，必须最后一步且不再交接）；Pipeline 每跨一条边写一条交接收据（上游 commit + changedFiles）；Studio 任务队列按选中团队调用 `GET /api/teams/:teamId/tasks`，不拉全量任务 |
| 串行 Pipeline | 每步独立 Run，成功后自动提交并交接；支持每步审批门、失败重跑、从失败 step 重试、completed 后从第一步重跑；后续 step 的 prompt 可模板引用上游 output / commit |
| 并行 DAG | 步骤可写 `dependsOn`（`[]` 为根）；ready steps 在各自 worktree 内有界并发，失败依赖跳过下游；join 步骤把多个依赖 commit 依次 `--no-ff` merge 成新 base，冲突则整步 failed 并列出冲突文件；跨步骤文件改动重叠只报告、不回写任务 worktree；`requiresApproval` 的 step 会停在 `awaiting_approval`，批准后从已完成结果续跑，驳回则失败该步及所有尚未完成的 step；Studio 任务面板可触发并展示每步结果 |
| Coordinator | 按团队花名册与交接边推导 Pipeline（确定性拓扑序），预览后由人点击应用；owner 置末并标记 `ownsDeliverable`，完成后若没改动任何文件会在 summary 里告警 |
| 并行 lanes | 每角色独立 worktree，有界并发；lane 结束后统一任务状态；文件级冲突只报告、不自动合并；接受 / 驳回按 lane 独立提交与 pin；Studio 结果面板可直接决策每条 lane，并把已接受的一条标记为最终交付（指针，不合并） |
| 证据与审计 | Run 证据（含实际工具调用与被拒原因，拿不到标 unknown）；append-only 审计可回放，Studio 可按任务 / 团队 / 类型筛选并导出 JSON；单任务 JSON 证据导出；成功率 / 返工 / 用量 / 耗时指标 |
| 成本预算 | Role / Team 可设 cost / token 上限，按任务已上报用量检查，超限阻断 createRun 与 executeRun |
| 重跑 hygiene | 失败 Run 默认 reset 到 base commit；可选 keep 保留残留或 fresh 重建 worktree |

### Pipeline 提示词模板

后续 step 的 prompt 可以引用已完成上游 step 的结果：`{{previous.output}}` / `{{previous.commit}}`（串行上一步；DAG 步骤取最后一个依赖），以及 `{{step:<id>.output}}` / `{{step:<id>.commit}}`（任意已完成 step，按 step id）；花括号内允许空白（如 `{{ previous.output }}`）。创建任务时会校验 token：未知 step id、字段拼错、引用自己的 output/commit 或未闭合 `{{` 会返回 400；`{{previous.*}}` 在没有上游 step 时被拒绝，`{{step:<id>.*}}` 必须引用目标 step 的传递祖先（按 `dependsOn`，未写时按串行上一步），后续 step 与独立并行 step 不算确定上游。运行期只在目标 step 已完成且字段有值时替换；未完成 step、或没有记录 output/commit 时保留原 token，不静默清空。output 用的是内核记录值（当前每条 step result 上限 2000 字符）。截断时结果落 `outputTruncated: true`，存储文本保持原样；后续 step 展开 `output` 会追加 `[The output above was truncated to 2000 characters.]`，Studio 在步骤状态后显示“输出已截断”。实现与测试见 `packages/storage-core/src/pipeline-template.ts`、`test/pipeline-template.test.ts`。

### Pipeline 重跑

completed pipeline 通过 `POST /api/tasks/:id/pipeline/rerun` 从第一步重跑：先把旧 step commit 逐个 pin 到 `refs/agent-ops/pipelines/<taskId>/<runId>`，再把 worktree 重置到任务 base commit、清空旧 step results；旧 commit 不会因 `git gc` 变成不可达对象。failed pipeline 仍走 retry，保留已完成的 step 前缀。Studio 的 Rerun pipeline 按钮执行前会二次确认。

### DAG 与并行 lanes 的运行入口

Studio 任务展开面板在任务处于 `queued` / `review` 时提供两个分支动作：

- **Run as DAG**：调用 `POST /api/tasks/:id/pipeline/dag`，按步骤的 `dependsOn` 在独立 worktree 内有界并发；`requiresApproval` 的 step 单独执行并在 Run 到 `review` 时暂停整张 DAG，`pipeline.status` 变 `awaiting_approval`，执行模式与并发度随 pipeline 落库。`POST /api/tasks/:id/pipeline/approve` 接受该 lane Run 后从已完成的 step results 续跑剩余调度，不重跑已完成步骤；`reject` 将该步和所有尚未完成的 step 标记 failed。DAG 每轮最多启动一个审批 step，避免并发产生多个 awaiting 结果；暂停与恢复分别写 `pipeline.dag.paused` / `pipeline.dag.resumed` 审计。多个依赖会先 checkout 最后一个依赖 commit，再把其余依赖依次 `--no-ff` merge 成真实 merge commit，作为该 step 的 `evidenceBase`；任一依赖合并冲突则该 step `failed`，错误信息列出冲突文件。实际产生的新 merge commit SHA 写入该 step result 的 `mergeCommitSha`，并随 `pipeline.results` 持久化、写入 `pipeline.dag.executed` / `paused` 审计的 `mergeCommits`；Studio 在 DAG 结果行显示 `merge <sha>`。结果面板展示每步状态、commit 与冲突。
- **Run parallel team**：仅对绑定了 Team 的任务显示，调用 `POST /api/tasks/:id/parallel/execute`，按团队花名册每角色一条 lane；结果面板展示 lane 状态、变更文件数和文件冲突。
- **Lane 决策**：并行结果面板在 lane 处于 `review` 时直接提供 Accept lane / Reject lane；已接受的 lane 可点 Set as final，调用 `POST /api/tasks/:id/final-lane` 持久化 `finalRunId` / `finalCommitSha`。最终选择只是指向已 pin 的 lane commit，不把改动 merge 到任务 worktree；重新选择会替换指针，并写 `task.final_lane.selected` 审计。

两个动作都不会把结果自动合并回任务主 worktree；DAG 只在自己的 step lane 内合并依赖 commit，lane/step 的产物仍要人工接受。任务没有运行记录且状态为 `queued` 时，面板还提供删除入口（`DELETE /api/tasks/:id`）：删除任务及其 worktree；任何已有 Run 的任务会被拒绝，因为 Run 与审计是证据。

### Studio 任务看板

任务页顶部提供 **List / Board** 分段切换，默认仍是列表。看板把当前任务按 `queued` / `running` / `review` / `done` / `failed` / `cancelled` 六种状态分列，列头显示状态与任务计数；卡片只做状态概览，展示标题、`repo@baseRef`、Pipeline 状态徽标，以及 Team 或 Role chip。点卡片不会在看板内复制详情面板，而是切回列表、展开该任务，并按任务行 `id` 滚动定位；运行证据、审批门、lane 决策等操作仍在列表详情里使用同一套入口。

看板列宽 220px 起、横向滚动，列体最高 `65vh` 独立滚动；任务多时不会把整页拉长。中英文文案都在 `tasks.view*` / `tasks.board*` 下维护。

### 任务取消

`POST /api/tasks/:id/cancel` 用于停止一个尚未进入终态的任务：

- 允许从 `queued` / `running` / `review` 取消；`done` / `failed` / `cancelled` 返回 409。
- 取消会 abort 该任务所有活动 Run；没有执行句柄但仍是 `running` 的遗留 Run 会被标成 `cancelled`，避免任务永远无法收口。
- 串行 Pipeline 当前步骤标 `cancelled`，未启动步骤也补成 `cancelled`；Pipeline 状态变 `cancelled`。DAG 与并行 lane 同样停止后续步骤 / wave，不再把任务状态覆盖回 `review` 或 `failed`。
- 已 `completed` 的 Pipeline 保留 `completed`：它的 commit 已经存在，取消只放弃任务，不删除已交付产物。
- 任务行、Run、worktree 都保留为证据；只有“没有 Run 的探测任务”才走 `DELETE /api/tasks/:id`。
- 审计写 `task.cancelled`，记录 previousStatus、cancelledRuns 与 pipelineStatus；Studio 任务展开面板提供“取消任务”，CLI 提供 `agent_ops_cancel_task`。

### Studio 审计与证据导出

Studio 侧边栏的 **Audit（审计）** 是内核 append-only 事件流的只读回放，和记录前端操作的 **Activity（活动）** 页分开。它调用 `GET /api/audit`，可按任务 ID、团队 ID、事件类型和最多条数筛选；列表按 `seq` 展示最近 N 条，展开后显示 actor、task/team 与事件 data。

- **Export audit JSON**：把当前已应用的筛选条件与当前事件列表导出为 `agent-ops-audit-YYYY-MM-DD.json`。
- **Export task evidence**：按任务 ID 调用 `GET /api/tasks/:id/export`，使用服务端 `content-disposition` 的文件名下载完整证据包（task、runs、handoffs、pipeline、audit、totals）。
- 审计页目前需要手动 **Refresh**，没有自动轮询或实时追加；事件类型下拉是固定清单，暂未从内核类型动态派生。

真实浏览器验收（2026-11-21，隔离 DB + 临时 git 仓）：审计页显示 6 条角色 / 团队 / 任务事件；任务过滤后剩 2 条（`task.created` / `task.deleted`），再按 `task.created` 过滤后剩 1 条；事件展开显示 data。`Export task evidence` 下载 `agent-ops-task-897204a3-….json`（1 KB，任务、totals 正确）；`Export audit JSON` 下载 `agent-ops-audit-2026-11-21.json`（3.2 KB，`count=7`，filters 与事件类型正确）。

### Studio 策略预览

角色创建 / 编辑表单里有 **Cross-runtime policy preview（跨 Runtime 策略预览）**。它把当前表单里的 `allowedTools` / `blockedTools` / `approvalMode` 发给 `POST /api/policy/evaluate`，在保存角色前返回每个注册 Runtime 的同一份策略判定：

- Runtime 的 `capability`（native / wrapper / unsupported）与 `enforcement`（exact / coarse / unsupported）；
- 是否只读、是否需要人工门；
- 展开后显示逐工具 allow / deny、原因、warnings 与 `unsupportedReason`。

策略字段一改，旧预览结果立即清空，避免把过期判定当成当前策略。空策略（没有白名单和黑名单）也会返回 7 个 Runtime 的“0 条判定”，页面会明确提示各 Runtime 使用自身默认工具集。

真实浏览器验收（2026-11-21，隔离 DB）：填 `Read, Grep` + `Bash` 后预览，7 个 Runtime 全部返回；`codex` / `claude-code` 为 native + exact，其他 5 个 Runtime 为 unsupported（展开可见 warning 与不支持原因）；每个 Runtime 20 条判定，`Read` / `Grep` 允许、`Bash` 因黑名单拒绝、其他已知工具因不在白名单拒绝。修改白名单后旧结果立即清空；空策略显示 7 个 Runtime、0 条判定和默认工具集提示；中英文文案均正常。

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
- 并行团队不自动合并；最终交付 lane 只记录指针，不把 commit 应用到任务 worktree。
- 预算为任务内口径，不跨任务累计；只在启动前阻断。
- Studio 的 Teams 计划预览已在真实浏览器打开并取消；把计划应用回 Pipeline 尚未做浏览器验收。Metrics 页、Role/Team 预算输入、任务预算面板、completed pipeline 的 Rerun 按钮与并行 lane 决策已实测。
- worktree 只链接根 `node_modules`：仓库本身未安装依赖时仍需先 `npm ci`；跨包的 TypeScript 类型可能指回主仓源码。
- SSE 实时投递在本地 UI 用过，终态回放与重启回放有测试覆盖，但未做长时间 / 并发压测。
