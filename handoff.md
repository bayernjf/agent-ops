# Agent Ops — handoff

## 待办登记（标准）

> 本段是本产品唯一活跃待办入口；详细背景见下方原有章节。完成一项改 `[x]`，并在“最近变更 / Recently shipped”留证据。
> 最近同步：2026-11-20
>
> 产品规划（非活跃待办，不计入上方待办）：多 Agent 角色与团队 v0.2/v0.3，PRD 见 `docs/prd/Agent-Ops-多Agent角色与团队-PRD-2026-11-19.md`，实施拆解见 `docs/prd/Agent-Ops-多Agent角色与团队-实施拆解-2026-11-19.md`；PD-1～PD-9 已于 2026-11-19 拍板；后续方向备忘（Tier 0 能力包 / 现有 Harness / Personal Agent）见 PRD §12.1–12.2。

- [ ] **真实模型 UI E2E** — 状态：blocked；阻塞：Claude Code / Codex 未登录，OpenCode `serve --service` 启动超过 80 秒无产出；下一步：owner 登录后跑真实写任务。
- [ ] **登录后真实写任务验收** — 状态：blocked；当前 UI 完成路径使用确定性 E2E runner，不代表真实模型任务已验收。
- [ ] **3–5 个本仓 dogfood** — 状态：open；下一步：收集 diff / 测试 / 失败率，验证是否能替代手工。
- [ ] **三 Agent adapter 扩张** — 状态：blocked by D7；下一步：按 W1 探测三、W2 Claude Code、W3 Codex/OpenCode。

> 本仓库从 agent-dev 迁移而来（move + 功能裁剪 + 收尾已闭环）。当前：M1/M2 的功能面（角色 / 团队 / 交接 / 串行与并行协调 / 审计 / 导出 / 指标 / 预算 / 重跑 hygiene / 策略层）已完成并有测试；**M1 退出标准中的“真实模型 UI E2E”仍 blocked**，M2 的 3–5 个 dogfood 因此尚未开始。
> 迁移方案与执行记录见 `bayjf/docs/tier0/Tier0-agent-dev并入AgentOps-迁移方案-2026-11-18.md`。

## 迁移（move 阶段）— 已完成

- [x] agent-dev → agent-ops 命名清零（45 文件 / 414 处，commit `4899dae`）
- [x] 内核 4 package（agent-runtime / workflow / policy / storage-core）+ 2 app（cli / daemon）抽取
- [x] webapp-delivery 插件隔离（blueprint / storage-webapp / delivery-server / provider-core / provider-cli / deployment-composer + studio）
- [x] 数据目录 `~/.agent-dev` → `~/.agent-ops`，环境变量 `AGENT_DEV_*` → `AGENT_OPS_*`
- [x] typecheck 0 错误、42 文件 / 589 tests 全绿

## 功能裁剪 — 已完成

- [x] ① 15 态 delivery machine 迁出内核 → 新建 `@agent-ops/delivery-workflow` 插件包（commit `feaacc2`）；内核 `workflow` 只留 5 态 task-run
- [x] ③ 拆 delivery-server
  - [x] ③a 新建 `@agent-ops/server-core` 内核控制面：`createKernelApp` 暴露 task/run + health HTTP（基于 KernelStore，零依赖 webapp 插件）
  - [x] ③b daemon 双模：默认内核模式（server-core + KernelStore），`AGENT_OPS_ENABLE_WEBAPP=1` 时懒加载 webapp 云链路（commit `f27df6a`）；smoke 验证内核模式独立启动
  - [x] ③c doctor + runtime/probe/catalog/profiles 内核能力路由回归 server-core（commit `99cc3f5`）；credentials/connectors 因依赖 provider-cli（云链路）明确留在 webapp
- [x] ② blueprint 收敛 preset（commit `5f479e8`）：对外收敛为 `webapp-golden-path` + `storefront` 两个 preset，6 类 generator 实现保留（方案 B），`task.recipe` 可写 preset id 或具体 productType

## 收尾 — 已完成

- [x] dogfood：用 agent-ops 在真实仓库跑通一条 Task/Run（codex 真实执行创建 `DOGFOOD2.md`，`queued→running→review→done` 闭环）；发现并修复 diffStat 漏统计 untracked 文件（commit `9013f81`）
- [x] 确认 daemon / studio / cli 独立启动，不读任何 `~/.agent-dev` 路径（grep 无残留 + daemon smoke + cli doctor + studio build 1652 modules）
- [x] 删除本地 `/Users/jiangfeng/000mycodes/agent-dev` + `~/.agent-dev`（删前备份到 `~/000mycodes-backups/agent-dev`，32M）

## 内核产品面补充 — 已完成

- [x] cli 的 MCP server 补 12 个内核 task/run 工具（`list/get/create/provision/release` task，`list/create/get/execute/cancel/accept/reject` run），对应 server-core `/api/tasks`、`/api/runs`；与 webapp 面工具并行、不替换
- [x] delivery-server 组合内核路由：`createDaemonApp` 挂载 `createKernelApp`，webapp 模式 daemon 也暴露内核 task/run 控制面（外层 auth 中间件统一鉴权；health/doctor/runtime 由 webapp 路由拥有，内核侧以 `diagnostics: false` 不再挂载，见下“技术债 — 已完成”）
- [x] mcp.test.ts 补内核 task/run 端到端测试（create_task→list/get→create_run→list/get→404），全量 44 文件 / 601 tests 绿

## 运行证据链 — 已完成（2026-11-19）

- [x] `storage-core` 新增 `runs.artifacts`（migration `0008_run_artifacts`）：持久化 combined stdout/stderr、output 截断标记、完整 diff（tracked diff + untracked patch）、diff 截断标记、changedFiles、exitCode、signal、timedOut、startedAt/completedAt、durationMs。
- [x] `executeRun` 成功、失败、超时三条路径都采集并落库，不再只记录 `diffStat`；证据采集是 best-effort，git 异常不会把已完成的 run 变成未落库异常。
- [x] `GET /api/runs/:id` 与 `GET /api/tasks/:id/runs` 直接返回 `artifacts`；accept/reject 保留证据，不重写。
- [x] Studio Task 看板每个 Run 可展开“运行证据”，显示 exit code、耗时、变更文件、stdout/stderr、完整 diff 与截断提示。
- [x] 测试：storage-core `execute-run.test.ts` 10 例（含成功、未跟踪文件、失败、超时、超大输出截断、持久化重开）；server-core 7 例（含 API 返回 artifacts、accept 保留 artifacts）；全仓 44 文件 / 604 tests 绿，Studio `tsc + vite build` 成功。

## 运行取消与实时输出 — 已完成（2026-11-19）

- [x] `agent-runtime`：进程 runner 新增 `onOutput` 流式回调与 `AbortSignal` 取消；取消先 SIGTERM，5 秒未退出升级 SIGKILL，结果带 `cancelled`；`executeCodexPlan` 第四参透传，原三参调用保持兼容。
- [x] `storage-core`：`RunArtifacts` 新增 `cancelled`；`RunEvent` 落 SQLite `run_events`（migration `0009_run_events`），按 `seq` 保留每 Run 最近 500 条；`executeRun` 登记 `activeRuns` 并 emit `started/stdout/stderr/completed/failed/cancelled`；新增 `cancelRun`，仅允许取消 running 且有活动句柄的 Run。
- [x] `server-core`：新增 `POST /api/runs/:id/cancel` 与 `GET /api/runs/:id/events`（SSE）。事件流先 replay，再订阅；terminal 事件写完即关闭；daemon 重启后从 SQLite 回放，不再返回空 `done`。
- [x] Studio Task 看板：执行时用 fetch + ReadableStream 消费 SSE（EventSource 不能带 bearer token），运行中显示实时输出和取消按钮；取消/普通失败用独立 `cancelled` / `failed` 状态区分，标签为“已取消”。
- [x] CLI MCP 新增 `agent_ops_cancel_run`，内核 task/run 工具共 12 个；取消说明从 “ends in failed” 改为 “ends in cancelled”。
- [x] 测试：agent-runtime 16 例、storage-core `execute-run.test.ts` 13 例、server-core 9 例（含 SSE replay、HTTP 取消、重启后 SSE 回放）、workflow 6 例（含 CANCEL 迁移）；全仓 44 文件 / 612 tests 绿，全仓 typecheck 0。
- [x] 已知限制已关闭：`run_events` 只在内存 → 已落 SQLite；取消映射 `failed` → 已改为独立 `cancelled` 终态。
- [x] 本轮提交：`bf477e3 feat(storage-core): persist run events across restarts`、`272e806 feat(workflow): add a terminal cancelled run state`、`6e206ec test(server-core): cover SSE replay after daemon restart`、`640a343 fix(storage-core): publish terminal events after status persists`、`ba30abb fix(studio): refresh task and run state after actions`。
- [x] Studio UI E2E（2026-11-19，内置浏览器实测）：从 UI 完成 `queued → running → review → done`，并从 UI 取消真实 OpenCode Run 验证 `cancelled` 证据。过程中发现并修复两个真实缺陷：terminal SSE 事件早于状态落盘，导致“任务已取消、Run 仍在运行”；Tasks 刷新只刷任务不刷已展开 Run，导致状态长期陈旧。
- [x] E2E 门禁：修复后全仓 44 文件 / 612 tests 绿，全仓 typecheck 0。
- [ ] 真实模型 UI E2E 仍受登录阻塞：Claude Code 与 Codex 均返回 `Not logged in`，Claude adapter 仍是 `candidate`；OpenCode 本次 `serve --service` 启动超过 80 秒仍未产出，真实 Run 已从 UI 取消。当前 UI 完成路径使用确定性 E2E runner，不代表真实模型任务已验收。

## M0 基础闭环 — 已完成（2026-11-20）

- [x] `acceptRun` 真正落 commit：新增内核共享 `packages/storage-core/src/commit.ts`，accept 时 `git add -A`，拒绝 `.env` / 外部软链，提交后回写 `runs.commit_sha`；无改动时回写当前 HEAD，不伪造新提交。验收提交同时 pin 到 `refs/agent-ops/tasks/<taskId>`，worktree 释放后仍可读取。
- [x] `releaseTask` 脏 worktree 拒绝：删除前先 `git status --porcelain`，有未提交改动即报错，不再让 `worktree remove --force` 吞掉未验收工作。
- [x] `rejectRun` 重置 worktree：按 provision 时记录的 `base_commit` 执行 `reset --hard + clean -fdx`，上一轮 agent 提交、未跟踪文件和被忽略文件都不会进入下一轮。
- [x] Task 增加 `acceptanceCriteria` / `priority` / `baseCommit`：migration `0010_task_closure`、storage schema、server `createTaskSchema` 三处同步；`executeRun` 把标准和优先级写入 agent prompt，不再写死空数组。
- [x] 测试覆盖：accept 提交未提交改动、`.env` 拒提交、reject 回到 base 并可重跑、release 脏 worktree 拒绝、criteria/priority API 往返、prompt 含 priority；全仓 typecheck 0，44 文件 / 614 tests 绿。
- [x] 本轮提交：`73026db feat(storage-core): close the task acceptance and commit loop`、`60ec8dd fix(storage-core): keep accepted commits reachable`。
- [ ] M0 的**真实模型**验收仍受登录阻塞，见上方“真实模型 UI E2E”；本轮闭环使用确定性 runner 与真实 git 临时仓验证，不把它冒充真实模型已验收。

## M1-A Role + Runtime Registry — 已完成（2026-11-20）

- [x] `RuntimeRegistry`：7 个默认 adapter 从硬编码 switch 迁到 `packages/agent-runtime/src/runtime-registry.ts`；状态扩展为 `verified | candidate | experimental | unsupported`，verified = codex/opencode/codebuddy/hermes，candidate = claude-code/aider/openclaw；能力矩阵覆盖 `nonInteractive / streaming / structuredOutput / sessionResume / toolPolicy / worktreeSafe`。
- [x] 内核执行路径改为 `getRuntimeAdapter`，不再直接读 `AGENT_ADAPTERS`；`isAgentExecutable` 与 `resolveRuntimeExecutor` 统一走 registry 状态，`candidate` / `experimental` 明确拒绝。
- [x] `AgentRole` schema：`id/name/description/baseAgentId/profileId/systemPrompt/acceptanceCriteria/runtimePolicy/enabled/createdAt/updatedAt`；必须至少有一个 `baseAgentId` 或 `profileId`；`RoleRuntimePolicy` 含 `allowedTools/blockedTools/approvalMode`，默认 `human` + 空数组。
- [x] `RoleStore`：`agent-roles.json`，与 `ProfileStore` 相同的原子替换 + corrupted 拒写策略；同名角色自动 `reviewer` / `reviewer-2`。JSON 是 M1-A 单用户 tradeoff，Team/Pipeline 需要关系查询时再迁 SQL。
- [x] `/api/roles`：列表/详情/创建/更新/删除 + `/resolve`；创建/更新校验 Profile 存在、Profile 与 baseAgent 一致、baseAgent 必须 verified；candidate adapter 直接 400，不静默降级。
- [x] CLI MCP 新增 5 个工具：`agent_ops_list_roles`、`agent_ops_get_role`、`agent_ops_create_role`、`agent_ops_update_role`、`agent_ops_delete_role`；`callDaemon` 支持 `DELETE`。
- [x] 测试：`runtime-registry` 3、`roles` 7、`roles-store` 2、server role API 2、CLI role 流程；全仓 typecheck 0，47 文件 / 629 tests 绿。
- [x] 本轮提交：`2f25b19 feat(runtime): register adapters and roles`、`9cca353 test(runtime): cover role resolution and registry`。
- [ ] **M1-A 不是完整 M1**：F3 Policy、F4 Task/Run role、F6 串行 Pipeline 已在后续完成；F7 Studio RolesView、F9 Claude/OpenCode 真实写任务仍未完成，不能据此宣称 M1 完成。

## F0-06 Run 证据 role/runtime/commit — 已完成（2026-11-20）

- [x] migration `0011_run_identity`：`runs` 增加 `role_id` / `runtime_id`，默认空字符串，旧 Run 读取时映射为 `null`。
- [x] `RunRecord` 增加 `roleId` / `runtimeId`；`createRun(taskId, agentId, roleId?)` 校验 Role 存在，未知 Role 抛 `Role <id> was not found.`。
- [x] `executeRun` 解析出实际 adapter 后调用 `updateRunRuntime`，记录的是 base adapter（如请求 `local-codex` 落 `codex`），不是请求里的 profile 形式 id。
- [x] `commitSha` 仍由 accept 写入；`RunRecord.commitSha` 保持空字符串表示未 accept，Studio 对空值显示 `—`。
- [x] server `POST /api/tasks/:id/runs` 接受可选 `roleId`；MCP `agent_ops_create_run` 同步透传。
- [x] Studio `KernelRun` 接入 `commitSha` / `roleId` / `runtimeId`；TasksView 的 Run 行展示实际 runtime，下方证据行展示 Role / Runtime / Commit，中英文 key 已补。
- [x] 测试：storage role 落库/未知 Role、执行后 runtime 持久化、server roleId 回显/执行/accept commit、MCP roleId 透传；全仓 typecheck 0，47 文件 / 630 tests 绿。
- [x] 本轮提交：`19d260a feat(storage-core): record run role and runtime`、`5020001 test(storage-core): cover run identity evidence`、`94465d4 docs(handoff): record the run identity baseline`。
- [x] F0-06 的后续边界：Role 与 run.agentId 的一致性校验、Role prompt 注入已在 F4 完成；F0-06 本身只负责证据落库与展示。

## F3 Policy 执行 — 已完成（2026-11-20）

- [x] `RuntimeToolPolicy` 进入执行计划：`buildAgentExecutionPlan` 接收 Role 的 `allowedTools/blockedTools`，解析结果写入 `CodexExecutionPlan.toolPolicy`，包含 `readOnly`、`exact/coarse` 与告警。
- [x] Codex 映射：纯只读 allowlist（如 Read/Grep/Glob）使用 `--sandbox read-only`，执行级 `exact`；含写工具的 allowlist 使用 `workspace-write`，标记 `coarse` 并提示 allowlist 只是 advisory，不能假装精确拦截。
- [x] Claude Code 映射：allowlist 与 blocked 合并后写入 `--allowedTools`，`exact`；blocked 过滤掉被禁工具。
- [x] 不支持工具策略的 Adapter（Hermes/OpenCode/CodeBuddy/Aider/OpenClaw）遇到受限 Role 直接拒绝执行，错误为 `cannot enforce a Role tool policy`；不再让受限角色落到 `--yolo` 全放行。
- [x] `executeRun` 从 `run.roleId` 读回 Role 并传入执行计划；Role 被删除时明确抛 `Role <id> was not found.`。
- [x] 只读审查者测试：Role `Read/Grep/Glob` 在 Codex 上生成 read-only 命令，runner 仅在非 read-only 时尝试写文件，执行后 worktree 保持 clean 且无泄漏文件。
- [x] 测试：`tool-policy` 5、storage execute 新增 2；全仓 typecheck 0，48 文件 / 637 tests 绿。
- [x] 本轮提交：`b11b8fb feat(runtime): enforce role tool policies`、`f1d9621 test(runtime): cover read-only policy enforcement`。
- [ ] F3 只覆盖 F3-01/F3-02/F3-03；工具调用审计（F3-04）和跨 Runtime 统一策略层（F3-05）仍未做。`approvalMode` 仍由人工门禁消费，不由 Adapter 伪装执行。

## F4 Task/Run Role 绑定 + prompt 注入 — 已完成（2026-11-20）

- [x] migration `0012_task_role`：`tasks` 增加 `role_id`，默认空字符串；旧 Task 读取为 `null`，不破坏历史数据。
- [x] `createTask` 接受 `roleId`，校验 Role 存在且 `enabled`；`PATCH` 未做，Task 的 Role 目前只能在创建时指定。
- [x] `createRun` 默认继承 `task.roleId`，显式 `roleId` 可覆盖；Role 缺失、禁用或与 run agent 不匹配时明确抛错。
- [x] Agent 匹配：Role 的 baseAgent 与 `local-*` 前缀、Profile 的 baseAgent 统一比较；Role 绑定 Profile 时，Run 的 agent 必须落在同一 base 上。
- [x] `buildAgentExecutionPlan` 接收完整 Role：prompt 追加 `Acting Role`、职责/`systemPrompt`、Role 验收标准、allowed/blocked tools、approval mode；Profile prompt 仍在其后。
- [x] server `POST /api/tasks` 接受 `roleId`；MCP `agent_ops_create_task` 增加 `roleId`、`acceptanceCriteria`、`priority`，`agent_ops_create_run` 可省略 `roleId` 走继承。
- [x] 测试：Task Role 落库/未知 Role、Run 继承/显式覆盖/agent 不匹配、Role prompt 注入、server Task→Run 继承、MCP Task 字段；全仓 typecheck 0，48 文件 / 639 tests 绿。
- [x] 本轮提交：`288cdff feat(storage-core): bind task and run roles`、`ebc5b5c test(storage-core): cover task role binding`。
- [ ] F4 只覆盖 F4-01/F4-02/F4-03；Team 字段（E5 Team 模型尚未存在）、Run version/command/token/cost（F4-04）、重跑 hygiene（F4-05）、成本预算（F4-06）未做。
- [ ] Run 不会自动把 Role 的 `profileId` 变成执行 Profile；`agentId` 仍由调用方指定，只校验与 Role 的 base 兼容。

## F6 内核串行 Pipeline — 已完成（2026-11-20）

- [x] migration `0013_task_pipeline` 给 `tasks` 增加 `pipeline`（JSON 字符串，默认空）；migration `0014_run_instruction` 给 `runs` 增加 `instruction`（默认空），旧记录读取为 `null` / 空指令。
- [x] Pipeline 模型进入 kernel：`TaskPipelineStepInput` / `TaskPipelineStep` / `TaskPipelineStepResult` / `TaskPipeline`；step 支持 `roleId` / `profileId` / `agentId` / `prompt`，至少指定一个执行身份，step id 自动生成并校验唯一。
- [x] `createTask` 接受 `pipeline`，校验 Role 存在且启用、Profile 存在；同时绑定 Role 与 Profile 时比较 baseAgent，不允许跨 Runtime 组合。
- [x] `executeTaskPipeline(taskId, runner?)`：仅允许 `idle` 启动，`activePipelines` 拒绝并发重入；逐步解析执行身份（`agentId` > `profileId` > Role 的 `profileId` / `baseAgentId`），每步创建 Run 并写入 `Pipeline step N/M: <name>` + step prompt。
- [x] 每步 Run 成功后必须进入 `review`，随即 `acceptRun` 自动提交；非 `review` 或失败即把 pipeline 置 `failed` 并停止，不启动下一步。每步记录 `runId` / `commitSha` / `output` / `error` / 起止时间；全部成功置 `completed`，Task 最终 `done`。
- [x] 所有 step 共用同一 worktree，下游基于上一步已提交的 commit 继续；`buildAgentExecutionPlan` 新增 `instruction`，在 Task objective 之后追加 `Step instruction`。
- [x] server 新增 `GET /api/tasks/:id/pipeline`（无 pipeline 或 task 不存在返回 404）与 `POST /api/tasks/:id/pipeline/execute`；`createTaskSchema` 接受 1–20 个 step，step 必须提供三种身份之一。
- [x] MCP `agent_ops_create_task` 接受 `pipeline.steps`；新增 `agent_ops_execute_pipeline`（POST execute，`ADDITIVE` 注解）。
- [x] 测试：pipeline 持久化/自动 id/重开 DB、两步串行成功（每步不同文件、第二步可见第一步文件、两个不同 commit SHA、Role 分别正确、Task done、worktree clean）、第一步失败即停（仅 1 个 Run、pipeline failed、Task failed）、server pipeline 读取与执行、MCP create_task pipeline 透传；全仓 typecheck 0，49 文件 / 643 tests 绿。
- [x] 本轮提交：`79644d3 feat(storage-core): add serial task pipelines`、`dffa9db test(storage-core): cover pipeline execution`。
- [ ] F6 只覆盖 F6-01/F6-02/F6-03；每步审批/暂停恢复（F6-04）、失败重跑与 step base reset（F6-05）、并行 DAG（F6-06）未做。
- [ ] Pipeline 当前只允许 `idle` 启动，completed/failed 不能直接重跑；step 间不替换 output 模板，下游只依赖上一步 commit 的 worktree 状态。

## 技术债 — 已完成

- [x] 去重 health/doctor/runtime 路由：`createKernelApp` 新增 `diagnostics` 开关（默认 `true`，独立内核模式不变），webapp 模式 daemon 以 `diagnostics: false` 只挂 task/run，health/doctor/runtime 继续由 webapp 路由拥有；不再依赖“后挂载遮蔽内核副本”。
- [x] 测试：server-core 断言 `diagnostics: false` 下四个诊断端点 404 且 `/api/tasks` 仍 200；delivery-server 的 `/api/health` 断言带 `version`（证明响应来自 webapp 路由）。
- [x] 门禁：typecheck 0、44 文件 / 602 tests 绿。

## F7-02 Studio RolesView — 已完成（2026-11-20）

- [x] 新增 `studio/src/views/RolesView.tsx`：角色列表（名称/id、绑定 baseAgent 或 Profile、审批模式、启用状态）、新建、编辑、删除、启用/停用，全部对接 `/api/roles` CRUD。
- [x] `types.ts` 新增 browser 侧 `AgentRole` / `RoleRuntimePolicy` / `RoleApprovalMode`，`View` 增加 `{ kind: 'roles' }`。
- [x] `App.tsx` 侧边栏新增 Roles 入口、topbar 标题、standalone-view 渲染。
- [x] `en.ts` / `zh.ts` 新增 `nav.roles` 与 `roles` 区块；表单 placeholder 也走 i18n，owned-copy 与 cross-locale 测试通过。
- [x] `styles.css` 新增 role-table / role-form 样式，复用 task board chrome。
- [x] 测试：studio smoke 新增 RolesView 渲染断言（标题 + 列头 + loading）；全仓 49 文件 / 644 tests 绿，typecheck 0。
- [x] 本轮提交：`23ec2bf feat(studio): add the kernel roles view`、`06ad65c test(studio): cover the roles view render`。
- [ ] F7-02 只覆盖角色管理 UI；F6-04 每步审批、F6-05 失败重跑仍未做。

## F7-01 Studio 建任务 + Pipeline 编辑 — 已完成（2026-11-20）

- [x] TasksView 从只读列表升级：新增 "New task" 表单（repo / baseRef / title / objective / priority / roleId / acceptanceCriteria），roleId 下拉从 `/api/roles` 拉取，提交走 `POST /api/tasks`；勾选 "Add a serial pipeline" 后可配置 1–20 个 step（名称 + Role/Profile/Agent 身份 + prompt），提交时组装 `pipeline: { steps }`。
- [x] 任务展开面板：有 pipeline 的任务展示 step 列表（名称、执行身份、状态、commit SHA），"Run pipeline" 调用 `POST /api/tasks/:id/pipeline/execute`，运行中显示 running 状态并逐 step 刷新。
- [x] `types.ts` 新增 browser 侧 `TaskPipeline` / `TaskPipelineStep` / `TaskPipelineStepResult`，`KernelTask` 增加 `pipeline?: TaskPipeline | null`。
- [x] `en.ts` / `zh.ts` 新增 tasks 区块的建任务与 pipeline 全套 key；placeholder 全部走 i18n，owned-copy 与 cross-locale 测试通过。
- [x] `styles.css` 新增 task-form / tasks-actions / pipeline-toggle / pipeline-editor / pipeline-step / pipeline-panel / pipeline-step-row / pipeline-step-identity / pipeline-step-commit 样式。
- [x] 门禁：全仓 typecheck 0，49 文件 / 644 tests 绿（studio 16 例含 owned-copy / cross-locale / smoke）。
- [x] 本轮提交：`ab59175 feat(studio): add task creation and pipeline editing`。
- [ ] F7-01 只覆盖串行 Pipeline 的建任务与执行 UI；F7-05 Run 详情扩展仍未做；F6-05 失败重跑已在后续完成。

## F6-04 每步审批 requiresApproval — 已完成（2026-11-20）

- [x] `TaskPipelineStep` / `TaskPipelineStepInput` 增加 `requiresApproval`；step 成功进入 `review` 后若该步需审批，不自动 accept，pipeline 置 `awaiting_approval`，step result 同为 `awaiting_approval`，Run 保持 `review`。
- [x] `approvePipelineStep`：接受当前待审 Run（commit），把该 step 置 `completed` 并继续执行剩余步骤；`rejectPipelineStep`：reset worktree 到该 step 的前置 commit（首步回 `baseCommit`），该 step 记 `Rejected by operator.`，pipeline 与任务均置 `failed`。
- [x] `parseTaskPipeline` 白名单补 `awaiting_approval`，否则 daemon 重载后暂停态会被折回 `idle`（由新测试抓到的真实缺陷）。
- [x] server 新增 `POST /api/tasks/:id/pipeline/approve`、`/reject`；`createTaskSchema` step 接受 `requiresApproval`；无待审批时的 gate 调用返回 409。
- [x] Studio：建任务表单每步新增"需要人工审批后继续"开关；pipeline 面板与 step 行渲染 `awaiting_approval`，暂停时显示 Approve / Reject 按钮；zh/en 文案与状态配色补齐。
- [x] 测试：storage-core 3 例（暂停、approve 继续、驳回 reset、无门禁拒绝）、server-core 2 例 HTTP approve/reject；全仓 typecheck 0，49 文件 / 649 tests 绿。
- [x] 本轮提交：`e6e4658 feat(storage-core): pause pipeline steps for approval`、`d4ddacc feat(server-core): expose pipeline approval routes`、`4b4ba7c feat(studio): gate pipeline steps in the task board`。
- [ ] F6-04 只覆盖串行 Pipeline 的单点审批门禁；F6-06 并行 DAG、F7-05 Run 详情扩展仍未做。

## F6-05 失败重跑 — 已完成（2026-11-20）

- [x] `retryTaskPipeline` 只接受 `failed` pipeline；completed / idle / awaiting_approval / running 均拒绝，避免把“重试”误用成“重跑已完成任务”。
- [x] 找到第一个 `failed` 的 step，重跑前把 worktree hard reset 到该 step 的前置 commit：首步回 `baseCommit`，中间步回上一条 completed result 的 `commitSha`；同时清掉 failed step 及其后的结果，保留前面 completed step 的 commit 和 result。
- [x] 重试会新建 Run，旧失败 Run 继续留在 Run 列表；重试成功后继续执行剩余 step，pipeline `completed`、Task `done`；再次失败则仍为 `failed`，可继续重试。
- [x] 修复 F6-04 的真实缺陷：`rejectPipelineStep` 之前调用 `rejectRun` 会 reset 到任务 `baseCommit`，把前面已完成 step 的 commit 一并抹掉；现在 `rejectRun` 接受可选 reset target，pipeline 驳回只回退到当前 step 的前置 commit。
- [x] server 新增 `POST /api/tasks/:id/pipeline/retry`，非 failed pipeline 返回 409。
- [x] MCP 新增 `agent_ops_retry_pipeline`；Studio failed 状态的按钮从错误的 execute 改为 Retry failed step，并沿用 busy/错误处理。
- [x] 测试：三步 Pipeline 首步保留、第二步失败后重试成功、失败文件被清掉、首步 runner 不重复执行、首步 commit 不变、最终 4 个 commit 且 worktree clean；驳回第二步时保留第一步 commit 与文件；server HTTP 重试与 completed 再重试 409；全仓 typecheck 0，49 文件 / 652 tests 绿。
- [x] 本轮提交：`20d707a feat(storage-core): retry failed pipelines`、`4ec87aa feat(server-core): expose pipeline retry`、`53687f3 feat(studio): retry failed pipeline steps`、`28e4e5a test(storage-core): cover pipeline retry`。
- [ ] F6-05 只支持 failed pipeline 的重试；completed pipeline 仍不支持 reset 后重跑，step 间 output 模板替换也未做。F6-06 并行 DAG、F7-05 Run 详情扩展仍未做。

## M1 退出验收 — 4 步串行完整组合 — 已完成（2026-11-20）

- [x] 新增 4 步串行 Pipeline 端到端测试：`Plan → Implement（requiresApproval）→ Review → Verify`，四个不同 Role，真实 git 仓库 + 真实 worktree + 注入 runner。
- [x] 断言覆盖完整组合：执行到第 2 步停在 `awaiting_approval`（此时只有 2 次 runner 调用）；`approvePipelineStep` 后继续跑第 3、4 步；4 个 step 全部 `completed` 且各有一个互不相同的 40 位 commit SHA；worktree 累计 5 个 commit（init + 4 步）且 worktree clean；Task 最终 `done`、pipeline `completed`。
- [x] 断言每步身份正确：4 条 Run 的 `roleId` 依序对应 Architect / Implementer / Reviewer / Verifier，prompt 中 `Pipeline step N/4` 标记与 `Acting Role` 段落逐步骤匹配，下游能读到上游已提交的文件。
- [x] 发现的真实限制：`executeCodexPlan` 在 `adapter.status !== 'verified'` 时拒绝执行，`claude-code` 仍是 `candidate`，因此带 Claude 角色的 step 会直接失败。本条验收的组合因此使用 4 个 codex 角色；“同一 Codex 3 角色 + Claude/Hermes 角色”要等 Claude adapter 通过验证后才能组合。
- [x] 全仓 `npm run typecheck` 0 错误，`npm test` 49 文件 / 657 tests 全绿。
- [x] 本轮提交：`63fe913 test(storage-core): cover a four-step pipeline`。
- [ ] 本条验收是确定性 runner 下的内核级验收，不是真实模型 UI 验收；真实模型 UI E2E 仍 blocked（见上方待办登记）。

## F5-01/F5-02/F5-03 Team + Assignment — 已完成（2026-11-20）

- [x] `agent-runtime` 新增 `teams.ts`：`AgentTeam` 只存 `roleIds` 花名册与 `handoffs` 交接边；`validateTeamGraph` 校验空花名册、重复成员、自交接、重复边、非成员边与环；stored/create/update schema 共用同一套规则。
- [x] `storage-core` 新增 `TeamStore`（`agent-teams.json`，与 Role/Profile 相同的原子写、损坏保护和重开读取），挂在 `KernelStore.teams`；创建/更新时校验 Role 存在且启用。
- [x] Task 增加 `team_id`（migration `0016_task_team`）：`createTask` 校验 Team 存在且启用；同时给 `roleId` 时校验该 Role 在该 Team 花名册内；`TaskRecord.teamId` 随 API 返回。
- [x] `server-core` 新增 `GET/POST /api/teams` 与 `GET/PUT/DELETE /api/teams/:teamId`；`createTaskSchema` 接受 `teamId`；Store 抛出的 “is disabled” 映射 400，未知 Team 404。
- [x] MCP 新增 `agent_ops_list_teams/get_team/create_team/update_team/delete_team`，`agent_ops_create_task` 接受 `teamId`。
- [x] 测试：TeamStore 唯一 id/持久化/重开、未知或停用 Role、重复成员/自交接/重复边/非成员边/环、更新导致交接悬空时报错；任务 `teamId` 持久化与成员校验；server CRUD 与环 400/未知角色 404；MCP 团队工具与 `teamId` 透传。全仓 typecheck 0，50 文件 / 664 tests 绿。
- [x] 本轮提交：`18d127f feat(storage-core): add team roster store`、`fb0f187 feat(storage-core): assign tasks to teams`、`89d1854 feat(server-core): expose the team API`、`46f26e4 feat(cli): expose team tools over MCP`。
- [ ] 未做：F8-02 审计导出、F5-06 Coordinator、F5-07 并行团队。（F5-04、F5-05/F7-03 见下方章节。）
- [ ] Team 目前只是花名册 + 交接图；Pipeline 仍按 task 的 step 显式配置，不会从 Team 自动推导。

## F5-05/F7-03 Studio TeamsView — 已完成（2026-11-20）

- [x] 新增 `TeamsView`：团队列表（花名册人数、交接边数、启用切换、编辑/删除），选中团队后在下方展示花名册、交接边与任务队列。
- [x] 建/编辑表单：名称、描述、角色花名册多选（角色来自 `/api/roles`）、交接边编辑器（上游/下游/备注，下拉取花名册角色）、启用开关；保存/取消/错误提示沿用 RolesView 的处理方式。
- [x] 任务队列：按 `task.teamId` 过滤 `/api/tasks`，显示任务状态；`pipeline.status === 'awaiting_approval'` 的任务额外标记“审批卡点”。
- [x] 接入 Studio 导航（`nav.teams`）与 `View` 联合类型；浏览器侧补 `AgentTeam`/`TeamHandoff` 类型与 `KernelTask.teamId`。
- [x] 文案全部走 i18n：`en`/`zh` 同步新增 `teams` 与 `nav.teams`；`owned-copy` 扫描通过。
- [x] 验证：Studio `tsc` 与 `vite build` 通过（1655 modules），Studio 14 文件 / 257 tests 绿；全仓 typecheck 0，50 文件 / 664 tests 绿。
- [x] 本轮提交：`b216d83 feat(studio): add the teams view`。
- [ ] 未做：交接边只有文本列表，没有可视化图；花名册不校验角色是否绑定 runtime；TeamsView 未在真实浏览器里逐项点过（仅 tsc/build + 单元测试）。

## F5-04 Handoff — 已完成（2026-11-20）

- [x] migration `0017_run_handoffs` + `run_handoffs` 表：每遍历一条 Pipeline 边就写一条收据，字段包括 task/team、from/to step、from/to run、from/to role、上游已接受的 commit（`fromCommitSha`）与上游 changedFiles（`artifacts`）。
- [x] `runPipelineSteps` 在创建下游 Run 后立刻落收据：只有上游 step 已 `completed` 且有 commit 才写；重试会为新 Run 再写一条，不覆盖旧记录。
- [x] `KernelStore.listHandoffs(taskId)`（按创建时间倒序，重开 DB 仍在）与 `getHandoffForRun(runId)`。
- [x] server：`GET /api/tasks/:id/handoffs`；`GET /api/tasks/:id/runs` 与 `GET /api/runs/:id` 给每个 Run 带上 `handoff`（无则 `null`）。
- [x] MCP：新增 `agent_ops_list_handoffs`。
- [x] Studio：Run 证据面板新增交接行（上游 step → 下游 step、上游 commit 前 10 位、随行变更文件数）。
- [x] 测试：4 步 Pipeline 产生 3 条收据（plan→implement→review→verify），`fromCommitSha` 与对应 step 的 commit 一致、`toRunId` 与下游 Run 一致、`artifacts` 含上游写出的文件、重开 DB 仍是 3 条、首步 Run 无交接；server HTTP 收据与未知任务 404、Run 详情 `handoff`；全仓 typecheck 0，50 文件 / 665 tests 绿；Studio 14 文件 / 257 tests 绿、`vite build` 通过。
- [x] 本轮提交：`c94e8d6 feat(storage-core): record pipeline handoffs`、`b7a7cf3 feat(server-core): expose handoff receipts`、`0724ba8 feat(cli): add the handoff tool`、`a5906e8 feat(studio): show run handoff receipts`。
- [ ] 未做：Team 配置的交接边与 Pipeline step 之间没有一致性校验（Pipeline 仍可任意串联 Role）；收据不记录 worktree 路径与审批人；TeamsView 尚未展示团队维度的交接历史。

## F7-05 Run 详情扩展 — 已完成（2026-11-20）

- [x] migration `0015_run_execution_evidence` 给 `runs` 增加 `runtime_version`（默认空字符串）、`command`（默认空字符串）、`input_tokens` / `output_tokens`（INTEGER，可空）、`cost_usd`（REAL，可空）；旧 Run 读取为 `runtimeVersion=null`、`command=''`、usage 为 `null`。
- [x] `RunRecord` 增加 `runtimeVersion` / `command` / `inputTokens` / `outputTokens` / `costUsd`；`createRun` 初始化空证据；新增 `RunExecutionEvidence` 与 `updateRunExecutionEvidence`。
- [x] `updateRunExecutionEvidence` 对 command 做 `RUN_COMMAND_LIMIT = 4000` 字符截断（超出时追加 `[truncated: N characters total]`）；token/cost 只接受有限非负数，token 向下取整，非法值落 `null`；空版本落 `null`，不伪造。
- [x] `executeRun` 在构造执行计划后立即写入实际命令行（`plan.command.join(' ')`），在 runner 返回后、收集 diff 前写入 `runtimeVersion` 与 runner 上报的 `usage`；未上报的 token/cost 保持 `null`，不写 0。
- [x] `agent-runtime` 新增 `probeAgentVersion(command)`，复用 `detect()` 的探测缓存与 5 秒超时；`runCodexProcessOnPlatform` 改为 async runner，spawn 前探测版本，探测失败不阻塞执行并返回 `runtimeVersion=null`；所有 resolve 分支都带版本证据。
- [x] server `GET /api/runs/:id` 直接返回新字段；Studio `KernelRun` 增加对应类型，Run 身份行展示 Role / Runtime / Version / Commit / Tokens(in/out) / Cost，证据面板新增 Command 区块；`en.ts` / `zh.ts` 补齐 `version` / `command` / `tokens` / `cost` 文案。
- [x] 测试：storage 覆盖 runner 上报 version+usage 的落库与重开 DB 持久化、command 截断与非法 usage 归一化、未上报时三个 usage 字段为 null；server 覆盖 Run 详情返回 `runtimeVersion=null`、command 含 `codex exec`、usage 字段为 null；全仓 typecheck 0，49 文件 / 654 tests 绿。
- [ ] 真实 Codex / Claude CLI 目前不返回 token/cost usage，Studio 显示 `—`；这是“未上报”而非 0。命令行为包含 prompt，`RUN_COMMAND_LIMIT` 只限制长度，不脱敏。
- [ ] 本轮提交：`9ab2084 feat(agent-runtime): probe runtime versions`、`894bd21 feat(storage-core): record run execution evidence`、`65b5c7b feat(studio): show run execution evidence`、`4fe610d test(storage-core): cover run execution evidence`。

## F7-04 逐文件接受 — 已完成（2026-11-20）

- [x] `commitWorktreeChanges` 增加可选 `files`：部分接受时先 `git reset -q` 清掉 agent 自己 staged 的内容，再 `git add -A -- <files>`，只提交选中路径；拒绝绝对路径、空路径和含 `..` 的路径。
- [x] `KernelStore.acceptRun(id, files?)`：`files` 省略时保持全量接受；传入时必须非空且是本次 Run `artifacts.changedFiles` 的子集，否则抛错且不触碰 worktree。部分接受提交选中文件后 `resetWorktree` 丢弃未选文件，确保 worktree clean、可 release。
- [x] server `POST /api/runs/:id/accept` 支持可选 `{ files: string[] }`；无 body 仍为全量接受，非法 JSON / 非法字段返回 400，不再把 malformed body 当成“接受全部”；未知路径映射为 400。
- [x] Studio Run 证据面板新增逐文件 checkbox（默认全选），接受按钮显示 `接受选中文件 (n/m)`，未选任何文件时禁用；选择在刷新 run 列表时保留，但会过滤掉已不存在的路径。zh/en 文案与样式补齐。
- [x] 测试：staged 双文件场景只提交 `keep.txt`、`drop.txt` 被删除、worktree clean；未知文件 400 且 Run 保持 review；malformed JSON 400 且不触发接受；全仓 typecheck 0，49 文件 / 656 tests 绿。
- [x] 本机 UI 实跑：临时 DB + 临时 git 仓库进入 review，展开证据后取消勾选 `drop.txt`，点“接受选中文件 (1/2)”；HEAD 只含 `keep.txt`，`drop.txt` 已删除，`git status --porcelain` 为空，Task 变 done。
- [ ] 当前是“本次操作里接受选中、其余丢弃”的一次性语义；不支持保留未选文件留待下一轮。Pipeline 自动 accept 与不带 files 的旧调用仍走全量接受。
- [ ] 本轮提交：`8bf226e feat(storage-core): accept selected run files`、`e1e6fd5 feat(server-core): accept selected run files`、`324cca1 feat(studio): pick files before accepting a run`、`5d24e70 test(storage-core): cover partial run acceptance`。

## F8-02 审计事件 — 已完成（2026-11-20）

- [x] migration `0018_audit_events` + `audit_events` 表：`seq` 全局单调，字段含 `task_id` / `team_id` / `actor` / `type` / `data` / `at`；重启时从 `MAX(seq)` 续号。
- [x] 事件类型：`role.created/updated/deleted`、`team.created/updated/deleted`、`task.created`、`run.accepted/rejected`、`pipeline.step.approved/rejected`、`pipeline.retried`、`handoff.recorded`。
- [x] `RoleStore`/`TeamStore` 新增可选 `onChange` 钩子，`KernelStore` 用它把模型改动写进审计；创建/更新/删除在落盘后触发，原有调用方式不变。
- [x] `task.created` 记录 roleId / teamId / pipelineSteps；`run.accepted` 记录 runId / commitSha / roleId / 选中文件；`handoff.recorded` 记录上下游 step、run、commit 与随行文件数。
- [x] `KernelStore.listAudit({ taskId, teamId, type, limit })`：按 `seq` 升序返回，`limit` 取最新 N（默认 200，上限 1000）。
- [x] server：`GET /api/audit?taskId=&teamId=&type=&limit=`。
- [x] MCP：新增 `agent_ops_list_audit`。
- [x] 测试：角色/团队/派活的事件顺序与过滤、Pipeline 回放顺序 `task.created → run.accepted → handoff.recorded → run.accepted`、reject 记录、重启后事件仍在且新事件 seq 递增；server 三向过滤与 limit；MCP 返回 `role.created`。全仓 typecheck 0，51 文件 / 669 tests 绿。
- [x] 本轮提交：`7a7d7af feat(storage-core): record kernel audit events`、`bfb4398 feat(server-core): serve the audit log`、`e746600 feat(cli): add the audit tool`。
- [ ] 未做：Studio 暂无审计面板；`actor` 只区分 operator/system，没有具体操作人身份（本地单用户内核还没有身份模型）；审计表不自动截断。（F8-03 见下节。）

## F8-03 证据导出 — 已完成（2026-11-20）

- [x] `KernelStore.exportTask(id)` 产出单任务证据包：task + pipeline、每个 Run（diff / output / exitCode / 时长 / changedFiles / commit / role / runtime / usage）、handoff 收据、该任务的审计事件，以及 totals。
- [x] totals：runs、acceptedCommits（有 commit 的 Run）、changedFiles（去重）、inputTokens/outputTokens/costUsd、reportingRuns、durationMs；**没有任何 Run 上报 usage 时三个 usage 字段为 `null`**，不写 0。
- [x] server：`GET /api/tasks/:id/export`（`content-disposition: attachment; filename="agent-ops-task-<id>.json"`），未知任务 404。
- [x] MCP：新增 `agent_ops_export_task`。
- [x] CLI：`agent-ops export <taskId> [--out <file>]`，默认打到 stdout；连接信息取 `AGENT_OPS_DAEMON_URL` / `AGENT_OPS_DAEMON_TOKEN`（或 `~/.agent-ops/daemon-token`）；`--out` 时打印写入字节数。
- [x] 测试：两步 Pipeline 的导出含 2 个 Run（第二个带 handoff、diff/output 可读）、审计 4 条、totals `runs=2 / acceptedCommits=2 / changedFiles=2 / reportingRuns=0 / usage=null / durationMs>0`；空任务 totals 归零且 costUsd 为 null；server 附件头与 404；MCP 导出返回 task id 与 totals。全仓 typecheck 0，52 文件 / 673 tests 绿。
- [x] 本轮提交：`ef4c752 feat(storage-core): export a task's evidence`、`4be9c5b feat(server-core): serve task evidence exports`、`810ff5a feat(cli): add the task export surface`。
- [ ] 未做：导出只有 JSON，没有打包 zip/tar，也不含 worktree 里的二进制产物；artifacts 沿用采集时的截断版本，导出不再二次限长；F8-04 指标聚合未做。

## F1-06 Role 模板 — 已完成（2026-11-20）

- [x] `agent-runtime/src/role-templates.ts`：5 个内置模板 architect / implementer / reviewer / tester / researcher，各自带 name、description、baseAgentId（codex）、systemPrompt、acceptanceCriteria、runtimePolicy（allowed/blocked tools + approvalMode）。
- [x] 模板是常量而非存储数据：应用模板只预填字段，保存前可改；只读模板禁 Write/Edit/Bash，reviewer 为 `strict`，researcher 为 `auto`。
- [x] server：`GET /api/role-templates`、`POST /api/role-templates/:templateId`（可选覆盖 name/description/baseAgentId/profileId）；沿用 `validateRoleBinding`，candidate runtime 仍返回 400，未知模板 404。
- [x] MCP：`agent_ops_list_role_templates`、`agent_ops_create_role_from_template`。
- [x] Studio：新建角色表单顶部展示模板卡片，点击即填充名称/描述/系统提示/验收标准/工具策略/审批模式；中英文文案同步。
- [x] 测试：模板 id 唯一且通过 `agentRoleCreateSchema`、只读模板 blockedTools 覆盖 Write/Edit/Bash；server 列表 5 个、按模板创建出 strict 角色、未知模板 404、candidate 覆盖 400；MCP 列表与按模板创建。全仓 typecheck 0，53 文件 / 678 tests 绿；Studio 14 文件 / 257 tests 绿、`vite build` 通过。
- [x] 本轮提交：`d004042 feat(agent-runtime): add built-in role templates`、`463c596 feat(server-core): serve role templates`、`d3b4597 feat(cli): add role template tools`、`ae87a4e feat(studio): start roles from a template`。
- [ ] 未做：模板只能在代码里内置，UI 不能编辑或新增模板；模板不预校验 baseAgent 是否仍可用（创建时由 binding 兜底）。（F1-07 见下节。）

## F1-07 Role 测试运行 — 已完成（2026-11-20）

- [x] `KernelStore.testRolePlan(roleId, { objective? })`：解析 Role → Runtime/Profile，构造 dry-run 执行计划（不建 Task、不起进程），返回 executable、baseAgentId、adapterStatus、profileId、reason、command、toolPolicy 与 warnings。
- [x] 计划使用固定工作区占位 `<role-test-workspace>`，避免预览命令被误当成可直接执行的真实路径。
- [x] warnings 覆盖：Role 停用、Role 不可执行（附 reason）、计划构建失败；candidate runtime 仍生成命令预览，但不标为可执行。
- [x] server：`POST /api/roles/:roleId/test`（可选 `objective`），未知 Role 404。
- [x] MCP：新增 `agent_ops_test_role`。
- [x] Studio：Roles 表格每行新增试跑按钮，结果面板展示可执行判定、Runtime/Profile、命令预览与警告。
- [x] 测试：codex 角色计划 `executable=true`、命令首项 `codex`、含 Role prompt 与只读策略；自定义 objective 进命令；missing role 返回 null；candidate 角色 `executable=false` 且 warning 含 “not executable” 但仍给命令；停用角色有 warning；server 200/404；MCP 返回 plan。全仓 typecheck 0，54 文件 / 682 tests 绿；Studio 14 文件 / 257 tests 绿、`vite build` 通过。
- [x] 本轮提交：`9f89b91 feat(storage-core): build role test plans`、`d5234fd feat(server-core): serve role test plans`、`ad20b98 feat(cli): add the role test tool`、`ee2c1dd feat(studio): preview a role test plan`。
- [ ] 未做：dry-run 不会真的起模型进程验证输出质量（真实小任务验证仍受 CLI 登录阻塞）；试跑不写审计事件；Studio 试跑面板未在真实浏览器逐项点击。

## F8-04 指标聚合 — 已完成（2026-11-20）

- [x] `KernelStore.getMetrics({ since?, until? })`：任务与运行的成功/失败/取消/在途、成功率、返工（`pipeline.retried` + `run.rejected` 除以已执行运行）、用量合计、耗时（总/平均），以及按 runtime 与按 role 的分解。
- [x] 口径：`executed = review/done/failed/cancelled`；成功率为 `succeeded/executed`，返工率为 `(retries + rejections)/executed`，窗口内无已执行运行时两者为 `null`；用量在无人上报时保持 `null`。
- [x] server：`GET /api/metrics?since=&until=`，非法时间戳返回 400。
- [x] MCP：新增 `agent_ops_get_metrics`。
- [x] Studio：新增 Metrics 页面（KPI 卡片 + 按运行时/按角色表格），侧边栏入口 `nav.metrics`，中英文文案齐。
- [x] 测试：空库全零且比率为 null；两步 Pipeline + 失败 Run + 驳回 Run 得到 tasks 3/1/1/1、runs 4/3/2/1/1、成功率 2/3、返工率 1/3、usage null、平均耗时 > 0、codex 桶 4 条、role 桶 builder/unassigned；未来窗口归零；server 200/400；MCP 空库比率为 null。全仓 typecheck 0，55 文件 / 687 tests 绿；Studio 14 文件 / 257 tests 绿、`vite build` 通过。
- [x] 本轮提交：`169b837 feat(storage-core): aggregate kernel metrics`、`7362bbc feat(server-core): serve kernel metrics`、`5481167 feat(cli): add the metrics tool`、`37f7611 feat(studio): add the metrics view`。
- [ ] 未做：指标按创建时间窗口过滤，不按完成时间；返工率是全局启发式，不是逐任务口径；不接外部 observability（Prometheus/OTel）；Studio 指标页未在真实浏览器点击。

## F5-06 Coordinator — 已完成（串行版，2026-11-20）

- [x] `orderTeamRoles(roleIds, handoffs)`：按交接边做确定性拓扑排序，同层以花名册顺序兜底；环由 Team schema 拦截，残留节点按花名册顺序追加。
- [x] `KernelStore.planTeamPipeline(taskId)`：用任务的 Team 推导串行 pipeline（每步 = 一个 Role，prompt 取角色 description），返回 order / steps / warnings；任务没有 Team 时报错。
- [x] `KernelStore.applyTeamPipeline(taskId)`：只在 `queued` 且 pipeline 为 `idle` 时写入，写入这个动作就是人工审批门；写后记 `pipeline.planned` 审计事件。
- [x] `KernelStore.coordinatorSummary(taskId)`：确定性汇总每步状态、commit、变更文件数，以及完成/失败/等待数、交接数和卡点（不调用模型）。
- [x] server：`POST /api/tasks/:id/coordinator/plan`、`POST /api/tasks/:id/coordinator/apply`、`GET /api/tasks/:id/coordinator`；无 Team 400、非 queued 409、未知任务 404。
- [x] MCP：`agent_ops_plan_team_pipeline`、`agent_ops_apply_team_plan`、`agent_ops_coordinator_summary`。
- [x] Studio：TeamsView 任务队列里 `queued` 任务显示“生成计划”，预览步骤后点“应用计划”才落库。
- [x] 测试：拓扑排序（链/并列/菱形/越界边）；协调器 plan→apply→execute→summary（3 步全部 completed、2 条交接、卡点为空、重复 apply 被拒）；无 Team 报错；server 200/400/404；MCP 端到端 plan/apply。全仓 typecheck 0，57 文件 / 695 tests 绿；Studio 14 文件 / 257 tests 绿、`vite build` 通过。
- [x] 本轮提交：`4190eb9 feat(agent-runtime): order team roles by handoff`、`cdfe346 feat(storage-core): add a team coordinator`、`dea6f98 feat(server-core): serve coordinator plans`、`c0b5e8e feat(cli): add coordinator tools`、`b124e4a feat(studio): plan a pipeline from a team`。
- [ ] 未做：这是**串行**协调器；并行版见下节（F5-07）。“拆任务”只按花名册拆到角色，不按内容再拆子任务；汇总不调模型、不做语义总结；Studio 未在真实浏览器点击。

## F5-07 并行团队 — 已完成（内核版，2026-11-20）

- [x] `KernelStore.executeParallelTeam(taskId, { runner?, maxConcurrency? })`：为团队每个角色创建独立 lane，worktree 从任务 base commit 拉开（`tasks/<taskId>/lanes/<roleId>`），按 `maxConcurrency`（默认 2，范围 1–8）分波执行。
- [x] `executeRun` 增加可选 `worktreePath` 与 `taskStatus: 'none'`：lane 在各自 worktree 里执行、证据从该 worktree 采集，且不会让每个 lane 改写任务状态；任务状态在全部 lane 结束后统一落一次（有任一成功 → `review`，全部失败 → `failed`）。
- [x] 冲突可见而非自动合并：按各 lane 的 `changedFiles` 求交集，返回 `{ file, roleIds }` 列表；不 merge、不解决。
- [x] 单个 lane 失败不阻塞其它 lane；角色停用/缺失/无可解析 agent 时该 lane 直接记失败原因。
- [x] 审计：新增 `parallel.executed` 事件（并发上限、lane 数、成功/失败、冲突数）。
- [x] server：`POST /api/tasks/:id/parallel/execute`（`maxConcurrency` 1–8，越界 400）；MCP：新增 `agent_ops_execute_parallel`。
- [x] 测试：3 角色团队按并发 2 跑 3 条 lane，实测最大并发 = 2、三个独立 worktree、每 lane 自有文件 + 两条 lane 共享的 `SHARED.md` 被列为冲突、任务落 `review`、审计含 `parallel.executed`；一个 lane 失败时另一个仍成功且任务仍 `review`；未 provision 的任务报 `no worktree`；server 200/400。全仓 typecheck 0，58 文件 / 698 tests 绿。
- [x] 本轮提交：`2411c85 feat(storage-core): add parallel team lanes`、`a63ef21 feat(server-core): expose parallel lanes`、`64033fb feat(cli): add the parallel lane tool`。
- [ ] 未做：**没有自动合并或合成**——lane 产出的 commit 需要人工逐个接受或放弃（接受语义见下节）；`releaseTask` 不会清理 lane worktree；Studio 没有并行入口；真实模型的并行执行未跑（CLI 登录仍阻塞）。

## 并行任务接受语义 — 已完成（2026-11-20）

- [x] migration `0019_run_lane`：`runs.worktree_path` / `runs.lane_id`；`RunRecord.worktreePath` / `laneId` 随 API 返回，普通 Run 为 null。
- [x] `executeRun` 接受 `laneId` 并把实际 worktree 与 lane 落到 Run 上；并行 lane 走各自 worktree，普通 Run 仍用任务 worktree。
- [x] `acceptRun` 在 Run 自己的 worktree 里提交；lane commit pin 到 `refs/agent-ops/tasks/<taskId>/lanes/<laneId>`，多条 lane 接受互不覆盖。
- [x] 并行任务状态：接受一条 lane 后，若仍有 `queued`/`running`/`review` 的 lane，任务保持 `review`；全部决定后才置 `done`。驳回一条 lane 只 reset 该 lane 的 worktree，任务保持 `review`，该 Run 回到 `queued` 可重跑。
- [x] `run.accepted` / `run.rejected` 审计新增 `laneId`；Studio Run 身份行显示 `Lane`（并行通道）。
- [x] 测试：两条 lane 各自接受后任务才 `done`、主 worktree 未被污染、lane commit 在各自 worktree HEAD 且 pin ref 存在；驳回 lane 后任务仍 `review`、lane worktree 干净、文件被清掉。全仓 typecheck 0，58 文件 / 700 tests 绿；Studio 14 文件 / 257 tests 绿、`vite build` 通过。
- [x] 本轮提交：`5b32c6f feat(storage-core): accept parallel lanes`、`6bee0e6 feat(studio): label parallel lane runs`。
- [ ] 未做：仍然**不自动合并**多 lane 结果，也没有“选哪条 lane 作为最终交付”的一等操作；`releaseTask` 不清理 lane worktree；并行任务没有专用 UI 入口（接受/驳回仍走普通 Run 操作）。

## F7-06 团队看板 — 已完成（2026-11-20）

- [x] `getMetrics` 增加 `teamId` 过滤：只统计指派给该团队的任务及其 Run；返回值新增 `teamId: string | null` 标明范围。
- [x] server `GET /api/metrics?teamId=`；MCP `agent_ops_get_metrics` 增加 `teamId` 参数。
- [x] TeamsView 详情新增两块面板：
  - **卡点**：该团队下 `failed` 任务，以及 pipeline 停在 `awaiting_approval` 的任务；
  - **团队用量**：成功率、Run 数、成本、Token、平均耗时（来自 `/api/metrics?teamId=`，未上报仍显示 `—`）。
- [x] 切换选中团队时按 `teamId` 重新拉取指标，并带取消标记避免旧请求写回。
- [x] 格式化函数抽到 `src/lib/format.ts`，MetricsView 与 TeamsView 共用。
- [x] 测试：两个团队时全量 metrics 统计 2、按 `teamId` 只统计 1 且 `teamId` 字段正确；server `?teamId=` 透传；全仓 typecheck 0，58 文件 / 701 tests 绿；Studio 14 文件 / 257 tests 绿、`vite build` 通过。
- [x] 本轮提交：`38ca138 feat(storage-core): scope metrics to a team`、`be6b3ed feat(server-core): accept a teamId on metrics`、`05639c5 feat(cli): filter metrics by team`、`ed285bb feat(studio): show team blockers and usage`。
- [ ] 未做：看板仍是列表式，没有按状态分列的看板视图；成本只有上报 usage 时才有数字；卡点不含“被驳回的 lane 等待重跑”这类更细的状态；Studio 未在真实浏览器点击。

## F3-04 工具审计 — 已完成（2026-11-20）

- [x] `agent-runtime/src/tool-audit.ts`：`extractToolAudit(output)` 从运行时输出读取工具调用——支持 `tool_use` / `tool_call` / `function_call` / `mcp_tool_call` 以及 `permission_denials`（带 reason 时记录），按 `name|status|reason` 去重、上限 100；先逐行解析 JSON，失败再整体解析一次。
- [x] 拿不到就标 unknown：没有可解析的工具报告时返回 `source: 'unknown'` 加明确原因，不猜。
- [x] `RunArtifacts` 增加 `toolCalls` 与 `toolAudit{source, reason}`；`executeRun` 在 collectEvidence 里解析**原始输出**（不是截断后的副本）并写入证据；旧记录读回为空 + unknown。
- [x] Studio：Run 证据面板新增「工具调用」区，逐条显示 Called / Denied（拒绝原因一并显示）；没有上报时显示原因文案。
- [x] 测试：tool_use + permission_denials 解析顺序、重复去重、整体 JSON、纯文本标 unknown、坏 JSON 行跳过、上限 100；executeRun 端到端覆盖 reported / unknown 两种 artifact。全仓 typecheck 0，59 文件 / 708 tests 绿；Studio 14 文件 / 257 tests 绿、`vite build` 通过。
- [x] 本轮提交：`c3c330b feat(agent-runtime): read tool calls from output`、`84eec32 feat(storage-core): audit tool calls per run`、`f5e7f58 feat(studio): show run tool calls`。
- [ ] 未做：只解析 JSON 里明确出现的字段，不覆盖所有 Runtime 的格式（Codex 不同版本的事件字段可能变化）；不记录参数与输出摘要（避免泄漏敏感内容）；不写入 `audit_events`（它是 Run 证据的一部分）；真实 CLI 的上报情况仍未在登录条件下验证。

## F3-05 统一策略层 — 已完成（2026-11-20）

- [x] `@agent-ops/policy/tool-policy`：运行时无关的策略求值——输入 `{allowedTools, blockedTools, approvalMode}` 与能力（`native | wrapper | unsupported`），输出 allow/deny 决策、readOnly、enforcement（`exact | coarse | unsupported`）、`approval{mode, humanGate}`、warnings 与 `unsupportedReason`；**不抛错**，由调用方决定拒绝还是提示。
- [x] 语义集中：`READ_ONLY_TOOL_NAMES` / `WRITE_TOOL_NAMES` / `KNOWN_TOOL_NAMES`、`isReadOnlyToolPolicy`、`effectiveAllowedTools` 全部搬到 policy 包；agent-runtime 只保留方言说明。
- [x] `resolveToolPolicy` 改为委托统一层：Codex 的 sandbox 提示、Claude 的 `--allowedTools`、无映射 native adapter 的 “advisory” 提示仍留在 adapter 侧；unsupported 仍拒绝受限策略。
- [x] server：`POST /api/policy/evaluate` 对每个注册 Runtime 返回同一份决策与该 Runtime 的 enforcement；MCP：新增 `agent_ops_evaluate_policy`。
- [x] agent-runtime 新增 `@agent-ops/policy` 依赖；`vitest.config.ts` 补 `@agent-ops/policy/tool-policy` 子路径别名（vitest 对 workspace 符号链接的 subpath 解析不稳定，与既有注释一致）。
- [x] 测试：只读/宽/仅禁三类策略的 readOnly 与决策、unsupported 不抛错并带原因、wrapper 标 coarse、approval 透传；server 端 codex `exact` + hermes `unsupported` + 400；MCP 端到端。全仓 typecheck 0，60 文件 / 718 tests 绿。
- [x] 本轮提交：`673d584 feat(policy): add a runtime-neutral tool policy`、`d2dd663 refactor(agent-runtime): use the unified policy layer`、`121a426 feat(server-core): evaluate policies across runtimes`、`d2852d8 feat(cli): add the policy evaluation tool`。
- [ ] 未做：决策基于内置工具名表，未知工具不会被判 deny；`approvalMode` 只是被携带，没有跨 Runtime 的审批执行器；Studio 没有策略预览 UI；`wrapper` 能力目前没有 adapter 使用（只有 native / unsupported）。

## F4-06 成本预算 — 已完成（2026-11-20）

- [x] Role / Team 新增可选 `budget{maxCostUsd, maxInputTokens, maxOutputTokens}`（`CostBudget` + `costBudgetSchema`，至少一个上限；Role/Team 的 create/update schema 与 JSON store 都透传）。
- [x] `KernelStore.budgetStatus(taskId, roleId?)`：按该任务已有 Run 的上报用量聚合 role 与 team 两个 scope 的 spend，并给出 configured / exceeded / reasons / limits。
- [x] 超额阻断：`createRun` 与 `executeRun` 在启动前检查，已超预算即抛 `Budget exceeded` 并写 `budget.blocked` 审计；queued 的 Run 在别的 Run 把预算用完后也不能再启动。
- [x] 诚实口径：只累加上报过的维度；没有上报的维度不会单独触发阻断（`spend` 对应字段为 `null`，`reportingRuns` 标明基线完整度）。
- [x] server：`GET /api/tasks/:id/budget?roleId=`；MCP：新增 `agent_ops_get_budget`。
- [x] 测试：role 预算 $1 两笔 $0.6 后第三笔被阻断且审计含 `budget.blocked`；team 预算 100 input tokens 跨角色累计到 120 后，先建后执行的 queued Run 在 execute 时被阻断；未上报用量不阻断（spend null）；server 200/404；MCP 返回 null scope。全仓 typecheck 0，61 文件 / 723 tests 绿。
- [x] 本轮提交：`4ac5021 feat(agent-runtime): add role and team budgets`、`81ca0a5 feat(storage-core): enforce role and team budgets`、`e4a7594 feat(server-core): serve task budget status`、`068a55b feat(cli): add the budget tool`。
- [ ] 未做：预算是“任务内”口径（同一 Role/Team 在不同任务里各自计算，不跨任务累计）；只在 Run 启动前阻断，不中断正在跑的 Run；Studio 没有预算输入框或展示；真实 CLI 不报 usage 时预算实际不生效。

## F4-05 重跑 hygiene — 已完成（2026-11-20）

- [x] `executeRun` 新增 `worktree: 'auto' | 'keep' | 'fresh'`：`auto`（默认）重跑 `failed` Run 时先把 worktree reset 到任务 base commit；`keep` 保留上次残留；`fresh` 删除并重新 checkout（main 与 lane 路径都支持，lane 只动自己的 worktree）。
- [x] 每次实际重跑写 `run.rerun` 审计（runId、worktree 策略、laneId）。
- [x] server：`POST /api/runs/:id/execute` 接受可选 `worktree`，非法值 400；MCP：`agent_ops_execute_run` 增加同名参数。
- [x] 语义保持：Pipeline 的 `retryTaskPipeline` 仍 reset 到失败 step 的前置 commit（不走这条 Run 级路径）；`rejectRun` 仍走自己的 reset。
- [x] 测试：失败 Run 重跑默认看不到 `LEFTOVER.md`；`keep` 能看到 `KEEP.md`；`fresh` 看不到 `FRESH.md` 且 HEAD 回到 `baseCommit`；审计含 `run.rerun`；server 400 / 409。全仓 typecheck 0，61 文件 / 725 tests 绿。
- [x] 本轮提交：`16ef3a8 feat(storage-core): reset failed worktrees on rerun`、`27a2f3a feat(server-core): accept a rerun worktree policy`、`9450273 feat(cli): expose the rerun worktree policy`。
- [ ] 未做：Studio 的 Retry 按钮仍用默认 `auto`，没有让用户选 `keep` / `fresh`；`fresh` 依赖 Run 已记录 lane 路径（首次执行后的重跑才可用）；真实 CLI 上未验证。

## F10-03 文档同步 — 已完成（2026-11-20）

- [x] `README.md` 重写：当前状态（内核 5 包 / 双模 daemon / 测试基线 61 文件 725 tests / 真实模型 E2E blocked）、内核能力表（Task-Run、Roles、Teams+Handoff、Pipeline、Coordinator、并行 lanes、证据与审计、预算、重跑 hygiene）、目录、命令（workspace 与 CLI export）、文档索引与已知限制。
- [x] `AGENTS.md` 更新：5 个内核包清单、daemon 双模（默认 kernel，`AGENT_OPS_ENABLE_WEBAPP=1` 才加载插件）、agent-runtime → policy 的依赖方向、Studio 验证命令、文档同步要求，以及“拿不到证据要写 blocked”的验收口径。
- [x] `handoff.md` 顶部状态从“运行证据链补强完成”改为当前阶段；待办登记保持不变：真实模型 E2E blocked、dogfood open、adapter 扩张 blocked。
- [x] 一致性核对（对源码复核）：`packages/*` 5 个、`apps/` 2 个、`plugins/webapp-delivery` 7 包 + studio；CLI 命令 `doctor / start / mcp / export`；daemon 环境变量 `AGENT_OPS_ENABLE_WEBAPP`；npm workspaces 四个 glob；root scripts 只有 `typecheck` / `test`。
- [x] 本轮提交：文档同步提交（README、AGENTS、本 handoff 段落）。
- [x] 后续补齐：`docs/prd/...实施拆解` 已加入“角色与团队功能面完成记录（2026-11-20）”、M2 状态行与 §11 变更记录行（725 tests 基线）。
- [ ] 未做：README 的能力表按模块描述，不逐条列出 API 路由。
