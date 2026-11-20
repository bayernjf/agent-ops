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

> 本仓库从 agent-dev 迁移而来（move + 功能裁剪 + 收尾已闭环），当前处于**运行证据链补强完成**阶段。
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
