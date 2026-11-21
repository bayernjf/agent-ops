# Agent Ops — handoff

## 待办登记（标准）

> 本段是本产品唯一活跃待办入口；详细背景见下方原有章节。完成一项改 `[x]`，并在“最近变更 / Recently shipped”留证据。
> 最近同步：2026-11-21
>
> 产品规划（非活跃待办，不计入上方待办）：多 Agent 角色与团队 v0.2/v0.3，PRD 见 `docs/prd/Agent-Ops-多Agent角色与团队-PRD-2026-11-19.md`，实施拆解见 `docs/prd/Agent-Ops-多Agent角色与团队-实施拆解-2026-11-19.md`；PD-1～PD-9 已于 2026-11-19 拍板；后续方向备忘（Tier 0 能力包 / 现有 Harness / Personal Agent）见 PRD §12.1–12.2。

- [x] **真实模型 UI E2E** — 已完成（2026-11-20）。UI 里新建 CodeBuddy 角色与一步 Pipeline 任务，点 `Run pipeline` 由真实 CodeBuddy 2.185.0 执行，任务 done、Run 可见（commit `ea4553f7d2`）。Claude Code / Codex 仍受 CC Switch `base_url` 阻塞，但不影响 CodeBuddy 路径；真实模型 API 路径与 UI 路径均已有证据。
- [x] **3–5 个本仓 dogfood** — 已完成 3 条真实任务 + 4 次团队运行（2026-11-21）：单任务接受率 3/3、检查通过率 3/3、返工 1 次人工小修；五角色串行 5 步完成（首轮暴露落盘 owner 缺口）；owner 机制补齐并实测落盘；带 owner 的五角色交付重跑成功；依赖链接后五角色完成**真实代码交付**（`listTasksByTeam` + 单测，含 reviewer→owner 修正）。详见下方 “F10-01/F10-02 Dogfood” 章节。
- [x] **Studio 浏览器复查** — 2026-11-21：Role/Team 表单预算输入（创建 / 编辑回填与探针清理）、completed pipeline 的 Rerun 按钮、Metrics 页（23 runs / 11 tasks 聚合）与 Teams 详情（花名册 / 交接边 / 队列 / 用量）均在真实浏览器查看；Teams 计划预览当时因缺少带团队的 queued 任务未点击，已由下方“Studio 分支入口浏览器验收”补验。
- [x] **Studio 分支入口浏览器验收** — 已完成（2026-11-21）。隔离数据库 + 临时 git 仓实测：DAG 先验 `aider` candidate 失败面板，再用真实 CodeBuddy 跑通成功路径（pipeline completed、commit `b976ee0`、输出 `PROBE_OK`）；并行 lane 先验失败面板，再用真实 CodeBuddy 跑通 `review` lane（0 文件、`PROBE_OK`）；Teams 计划预演在带 Team 的 queued 任务上点开并取消；`Delete probe` 从 Studio 删除后后端列表确认消失。过程中发现并修复 Studio 长请求沿用 15 秒默认超时的问题（commit `d7dd834`）。
- [x] **并行 lane 决策入口** — 已完成（2026-11-21）。并行结果面板直接提供 Accept lane / Reject lane；已接受的 lane 可 Set as final，持久化 `finalRunId` / `finalCommitSha` 并写 `task.final_lane.selected` 审计。真实 CodeBuddy 两条 lane 已在浏览器走通接受、驳回和最终选择；选择只是指向已 pin 的 lane commit，不合并到任务 worktree。提交 `2ed1adb` / `6b51497` / `9750a83` / `88cd6bd`。
- [x] **Studio 审计面板与导出** — 已完成（2026-11-21）。新增独立 Audit 导航，`GET /api/audit` 支持任务 / 团队 / 类型 / 条数筛选；事件可展开查看 actor、task/team 与 data；`Export audit JSON` 导出当前筛选切片，`Export task evidence` 调用 `GET /api/tasks/:id/export` 下载单任务证据包。真实浏览器已验证 6 条事件、两层过滤、详情展开和两种下载；全仓 65 文件 / 752 tests 绿，Studio build 1659 modules 成功。
- [x] **Studio 策略预览面板** — 已完成（2026-11-21）。角色创建 / 编辑表单接入 `POST /api/policy/evaluate`，保存前逐 Runtime 展示 capability、enforcement、只读、人工门与 allow/deny 判定；策略字段变更立即清空旧结果，空策略显示默认工具集提示。真实浏览器已验证 7 个 Runtime、20 条判定、unsupported 原因与中英文文案；全仓 66 文件 / 753 tests 绿，Studio build 1660 modules 成功。
- [x] **Teams 任务队列服务端过滤** — 已完成（2026-11-21）。`TeamsView` 不再拉取全量 `/api/tasks` 后按 `teamId` 过滤，改为对选中团队调用 `GET /api/teams/:teamId/tasks`；切换团队立即清空旧队列并带取消标记，队列与卡点面板分别有加载态和错误态，计划预览对团队切换做了响应隔离。真实浏览器已验证 Alpha 2 条 / Beta 1 条、未归属任务不出现，切换与刷新只请求当前团队队列；全仓 66 文件 / 753 tests 绿，Studio build 1660 modules 成功。
- [x] **Studio 任务看板分列** — 已完成（2026-11-21）。Tasks 页新增 List / Board 切换，看板按六种任务状态分列、列头计数，卡片显示 `repo@baseRef`、Pipeline 徽标与 Team/Role chip；点卡片切回列表并展开、滚动定位该任务。真实浏览器已验证六列各 1 条、计数、Team/Role/Pipeline 标记、卡片跳转展开与中英文；全仓 67 文件 / 755 tests 绿，Studio build 1661 modules 成功。
- [x] **Task 级取消** — 已完成（2026-11-21）。新增 `cancelTask` / `POST /api/tasks/:id/cancel` / `agent_ops_cancel_task` / Studio“取消任务”：`queued` / `running` / `review` 可取消，abort 活动 Run，串行 Pipeline、DAG 与并行 lane 都停止后续步骤，Pipeline 与步骤变 `cancelled`，终态拒绝；真实浏览器已验证排队任务取消、状态与 Pipeline 步骤变“已取消”、审计 `task.cancelled`；全仓 68 文件 / 760 tests 绿，Studio build 1661 modules 成功。
- [x] **DAG 多依赖合并** — 已完成（2026-11-21）。`executeDagPipeline` 不再只取最后一个依赖 commit：join step 先 checkout 最后一个依赖，再把其余依赖逐个 `--no-ff` merge 成真实 merge commit 作为 `evidenceBase`；合并冲突则 abort 该次 merge、step 标 failed 并列出冲突文件。新增依赖合并冲突与已包含依赖不重复 merge 用例；全仓 68 文件 / 762 tests 绿，typecheck 0。
- [x] **重跑前 pin 旧 pipeline commit** — 已完成（2026-11-21）。completed pipeline 重跑前把每个旧 step commit pin 到 `refs/agent-ops/pipelines/<taskId>/<runId>`，再 reset worktree、清空旧 results；`pipeline.rerun` 审计记录 `pinnedCommits`。测试覆盖 `git gc --prune=now` 后旧 commit 仍可解析；全仓 68 文件 / 762 tests 绿。
- [x] **修复任务 ref 命名空间冲突** — 已完成（2026-11-21）。默认 accept ref 从 `refs/agent-ops/tasks/<taskId>` 改为 `.../<taskId>/accepts/latest`；旧路径是文件，导致同一任务先串行接受再接受 lane 时 `update-ref` 报 “cannot lock ref”。新增默认 ref 与 lane ref 共存测试；全仓 68 文件 / 763 tests 绿。
- [x] **Pipeline 模板语法校验** — 已完成（2026-11-21）。`validatePipelineTemplates` 在创建任务时拒绝未知 step id、坏字段、自引用和未闭合 token，server 返回 400；`{{ previous.output }}` 这类花括号内空白现在也能真正展开。纯函数新增 6 例、创建任务 1 例、HTTP 400 1 例；全仓 68 文件 / 771 tests 绿。
- [x] **显式标记 step output 截断** — 已完成（2026-11-21）。step result 落 `outputTruncated`，DAG 结果同时保留 `changedFiles` / `output`；串行与 DAG 下游展开被截断的 output 时追加 `[The output above was truncated to 2000 characters.]`，Studio 步骤状态显示“输出已截断”。新增串行 1 例、DAG 1 例、模板 1 例；全仓 68 文件 / 773 tests 绿，Studio build 1661 modules 成功。
- [x] **DAG 审批门** — 已完成（2026-11-21）。`executeDagPipeline` 支持 `requiresApproval`：gated step 单独执行，Run 到 `review` 时 DAG 存 `awaiting_approval`，pipeline 持久化 `executionMode: 'dag'` / `maxConcurrency` / 已完成结果；`approvePipelineStep` 接受该 lane Run 后从已完成 results 续跑，不重跑已完成步骤；`rejectPipelineStep` 将该步与所有尚未完成的 step 标 failed。暂停/恢复写 `pipeline.dag.paused` / `pipeline.dag.resumed` 审计。新增 4 个 DAG 用例（批准续跑、连续两道门、驳回下游、原有 DAG 回归）；全仓 68 文件 / 776 tests 绿，typecheck 0，Studio build 1661 modules 成功。
- [x] **记录 DAG merge commit** — 已完成（2026-11-21）。多依赖 join 实际生成 merge commit 时，把 SHA 写入 `DagStepResult.mergeCommitSha` 与 `pipeline.results`，并在 `pipeline.dag.executed` / `paused` 审计的 `mergeCommits` 中列出；根步骤与单依赖 step 不写。测试断言 SHA 可解析、有两个父提交、单依赖为空，并检查持久化与审计；全仓 68 文件 / 776 tests 绿，typecheck 0，Studio build 1661 modules 成功。
- [ ] **三 Agent adapter 扩张** — 状态：blocked by D7；下一步：按 W1 探测三、W2 Claude Code、W3 Codex/OpenCode。

> 本仓库从 agent-dev 迁移而来（move + 功能裁剪 + 收尾已闭环）。当前：M1/M2 的功能面（角色 / 团队 / 交接 / 串行与并行协调 / 审计 / 导出 / 指标 / 预算 / 重跑 hygiene / 策略层）已完成并有测试；真实模型验收已由 CodeBuddy 跑通（API + UI + 3 条 dogfood + 五角色串行），Claude Code / Codex 仍受 CC Switch `base_url` 阻塞。
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

- [x] `acceptRun` 真正落 commit：新增内核共享 `packages/storage-core/src/commit.ts`，accept 时 `git add -A`，拒绝 `.env` / 外部软链，提交后回写 `runs.commit_sha`；无改动时回写当前 HEAD，不伪造新提交。验收提交同时 pin 到 `refs/agent-ops/tasks/<taskId>/accepts/latest`，worktree 释放后仍可读取。2026-11-21 从旧的 `refs/agent-ops/tasks/<taskId>` 迁到嵌套路径，旧 ref 保留但不再写入，避免和 `lanes/*` 的 ref 目录冲突。
- [x] `releaseTask` 脏 worktree 拒绝：删除前先 `git status --porcelain`，有未提交改动即报错，不再让 `worktree remove --force` 吞掉未验收工作。
- [x] `rejectRun` 重置 worktree：按 provision 时记录的 `base_commit` 执行 `reset --hard + clean -fdx`，上一轮 agent 提交、未跟踪文件和被忽略文件都不会进入下一轮。
- [x] Task 增加 `acceptanceCriteria` / `priority` / `baseCommit`：migration `0010_task_closure`、storage schema、server `createTaskSchema` 三处同步；`executeRun` 把标准和优先级写入 agent prompt，不再写死空数组。
- [x] 测试覆盖：accept 提交未提交改动、`.env` 拒提交、reject 回到 base 并可重跑、release 脏 worktree 拒绝、criteria/priority API 往返、prompt 含 priority；全仓 typecheck 0，44 文件 / 614 tests 绿。
- [x] 本轮提交：`73026db feat(storage-core): close the task acceptance and commit loop`、`60ec8dd fix(storage-core): keep accepted commits reachable`。
- [ ] M0 的**真实模型**验收仍受登录阻塞，见上方“真实模型 UI E2E”；本轮闭环使用确定性 runner 与真实 git 临时仓验证，不把它冒充真实模型已验收。
- [x] 2026-11-21 修复 ref 命名空间：`pinWorktreeCommit` 默认 accept ref 改为 `refs/agent-ops/tasks/<taskId>/accepts/latest`，lane ref 仍为 `.../lanes/<laneId>`。旧默认 ref 是 refs 文件，无法再创建同级的 `lanes/` 子 ref；回归测试同时 pin 两种 ref 并都能 `rev-parse`。

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
- [ ] F6 只覆盖 F6-01/F6-02/F6-03；每步审批/暂停恢复（F6-04）、失败重跑与 step base reset（F6-05）、并行 DAG（F6-06）在后续完成（见 F6-04/F6-05/F6-06 章节）。
- [ ] Pipeline 当前只允许 `idle` 启动，completed/failed 不能直接重跑；step 间 output 模板已在 F6-01 模板补做（2026-11-21），下游仍基于上一步 commit 的 worktree 状态。

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
- [ ] F6-04 只覆盖串行 Pipeline 的单点审批门禁；F6-06 并行 DAG 已在后续完成，F7-05 Run 详情扩展也在后续完成。

## F6-05 失败重跑 — 已完成（2026-11-20）

- [x] `retryTaskPipeline` 只接受 `failed` pipeline；completed / idle / awaiting_approval / running 均拒绝，避免把“重试”误用成“重跑已完成任务”。
- [x] 找到第一个 `failed` 的 step，重跑前把 worktree hard reset 到该 step 的前置 commit：首步回 `baseCommit`，中间步回上一条 completed result 的 `commitSha`；同时清掉 failed step 及其后的结果，保留前面 completed step 的 commit 和 result。
- [x] 重试会新建 Run，旧失败 Run 继续留在 Run 列表；重试成功后继续执行剩余 step，pipeline `completed`、Task `done`；再次失败则仍为 `failed`，可继续重试。
- [x] 修复 F6-04 的真实缺陷：`rejectPipelineStep` 之前调用 `rejectRun` 会 reset 到任务 `baseCommit`，把前面已完成 step 的 commit 一并抹掉；现在 `rejectRun` 接受可选 reset target，pipeline 驳回只回退到当前 step 的前置 commit。
- [x] server 新增 `POST /api/tasks/:id/pipeline/retry`，非 failed pipeline 返回 409。
- [x] MCP 新增 `agent_ops_retry_pipeline`；Studio failed 状态的按钮从错误的 execute 改为 Retry failed step，并沿用 busy/错误处理。
- [x] 测试：三步 Pipeline 首步保留、第二步失败后重试成功、失败文件被清掉、首步 runner 不重复执行、首步 commit 不变、最终 4 个 commit 且 worktree clean；驳回第二步时保留第一步 commit 与文件；server HTTP 重试与 completed 再重试 409；全仓 typecheck 0，49 文件 / 652 tests 绿。
- [x] 本轮提交：`20d707a feat(storage-core): retry failed pipelines`、`4ec87aa feat(server-core): expose pipeline retry`、`53687f3 feat(studio): retry failed pipeline steps`、`28e4e5a test(storage-core): cover pipeline retry`。
- [ ] F6-05 的 failed 重试已完成；completed pipeline 的重跑已在后续补齐（见下节）。step 间 output 模板替换已在 F6-01 模板补做。F6-06 并行 DAG 已在后续完成，F7-05 Run 详情扩展也在后续完成。

## F6-01 Pipeline 提示词模板 — 已完成（2026-11-21）

- [x] 新增 `packages/storage-core/src/pipeline-template.ts`：后续 step 的 prompt 支持 `{{previous.output}}` / `{{previous.commit}}`（串行上一步；DAG 取最后一个依赖）与 `{{step:<id>.output}}` / `{{step:<id>.commit}}`（任意已完成 step）；花括号内允许空白。
- [x] 只在目标 step 已完成且字段有值时才替换；未知 id、未完成 step、或没有记录 output/commit 时保留原 token，不静默清空；output 使用内核记录的 2000 字符截断值。
- [x] 串行执行（`pipelineStepInstruction`）与 DAG 执行（`executeDagPipeline`）都在创建 Run 前展开模板；DAG 并发下只使用该 step 的已完成依赖快照。
- [x] 2026-11-21 补齐校验：`validatePipelineTemplates` 在 `normalizePipeline` 阶段拒绝未知 step id、坏字段、自引用和未闭合 token，server 映射 400；普通 `{{...}}` 文本不受影响。纯函数新增 6 例 + 创建任务拒绝/接受 1 例 + HTTP 400 1 例；全仓 68 文件 / 771 tests 绿。
- [x] 测试：模板纯函数 4 例（previous / 按 id / 未知与缺失保持原样 / 无占位符原样返回）；两步串行端到端断言第二步 prompt 与 Run instruction 含第一步 output 和 commit；DAG 端到端断言 join 步骤拿到 last dependency 的 output 与 commit；全仓 typecheck 0，63 文件 / 743 tests 绿。
- [x] 本轮提交见 git log（`feat(storage-core): expand pipeline step templates`）。
- [x] 2026-11-21 补齐截断显式化：`capturePipelineStepOutput` 按 2000 字符截断并写 `outputTruncated`，存储文本不带 marker；串行与 DAG 下游展开被截断的 output 时追加 `[The output above was truncated to 2000 characters.]`。DAG 结果同时落 `changedFiles` / `output` / `outputTruncated`，Studio 步骤状态显示“输出已截断”。新增串行、DAG、模板各 1 例；全仓 68 文件 / 773 tests 绿，Studio build 1661 modules 成功。
- [ ] 未做：模板只支持 output / commit 两种字段，没有加密或转义处理（上游 output 会按原文进入下游 prompt）；模板校验只看 token 形状和 step id，不校验该 step 是否真的会在目标步骤前完成。

## F6-05 completed pipeline 重跑 — 已完成（2026-11-21）

- [x] `rerunTaskPipeline` 只接受 `completed`：先为每个旧 step commit 写 `refs/agent-ops/pipelines/<taskId>/<runId>`，再把 worktree 重置到任务 base commit（`baseCommit || baseRef`），清空旧 step results，从第一步重新执行，并写 `pipeline.rerun` 审计（steps / previousResults / pinnedCommits）。旧 commits 由 ref 保持可达，不会因 `git gc` 被回收。
- [x] 修复真实缺陷：`resetWorktree`（`git reset --hard` + `git clean -fdx`）会删掉 worktree 里链接的 `node_modules`。失败 Run 的 auto hygiene 与 `retryTaskPipeline` 现在 reset 后重新 `linkNodeModules`。
- [x] server 新增 `POST /api/tasks/:id/pipeline/rerun`（非 completed 返回 409）；MCP 新增 `agent_ops_rerun_pipeline`；Studio completed pipeline 显示 Rerun pipeline 按钮，点击前 `window.confirm`。
- [x] 测试：storage-core 两步 pipeline 重跑产生全新 commit 且 HEAD 只含 init + 2（worktree clean）、idle pipeline 拒绝重跑、retry 后 `node_modules` 仍可访问；重跑后旧 run 的 ref 指向旧 commit，`git gc --prune=now` 后仍可 `cat-file -e`，审计含 2 条 pinnedCommits；server HTTP 200/409；MCP 工具清单更新；全仓 typecheck 0，63 文件 / 747 tests 绿。
- [x] 本轮提交见 git log。
- [ ] 未做：重跑会清空旧 results（旧 commit 已 pin，但旧 results 只保留在 `pipeline.rerun` 审计，不在任务 Pipeline 里做对比视图）；真实模型下的 completed 重跑未跑。

## Studio DAG / 并行入口 + 任务删除 — 已完成（2026-11-21）

- [x] Studio 任务展开面板新增两个分支动作：**Run as DAG**（`POST /api/tasks/:id/pipeline/dag`）与 **Run parallel team**（`POST /api/tasks/:id/parallel/execute`）。两者都会在缺 worktree 时先 provision、执行前 `window.confirm`，完成后刷新任务与 Run 列表。
- [x] 结果面板：DAG 展示每步状态 / commit / 未合并依赖 warning / 冲突；并行展示 lane 状态 / 变更文件数 / 冲突。类型定义在 `studio/src/types.ts`，文案 en/zh 同步。
- [x] 任务删除：内核 `deleteTask` 只允许没有 Run 的任务，删除 worktree 与任务行并写 `task.deleted` 审计；server `DELETE /api/tasks/:id`（404 / 409）与 MCP `agent_ops_delete_task`；Studio 对 `queued` 且无 Run 的任务显示删除入口。
- [x] 测试：`task-delete.test.ts` 覆盖删除与拒绝有 Run 的任务；server HTTP 200/404/409；MCP 工具清单更新；全仓 typecheck 0，64 文件 / 750 tests 绿；Studio 14 文件 / 257 tests 绿。
- [x] 浏览器验证：用隔离数据库 `/tmp/agent-ops-browser-verify/agent-ops.sqlite` + 临时 git 仓，不污染本机真实任务库。DAG 先验 `aider` candidate 的失败面板；再用真实 CodeBuddy 2.142.0 跑通成功路径（pipeline `completed`、commit `b976ee0`、输出 `PROBE_OK`）。并行 lane 先验失败面板；再用同一个角色跑通 `review` lane（0 文件、`PROBE_OK`）。Teams 计划预演在带 Team 的 queued 任务上打开并取消，不写回 Pipeline；`Delete probe` 从 Studio 删除后，后端任务列表确认消失。
- [x] 真实模型登录补充：首次并行尝试因 daemon 启动时 `PATH` 未包含 `~/.local/bin`，报 `spawn codebuddy ENOENT`；用 `PATH="$HOME/.local/bin:$PATH"` 重启 daemon 后成功。这不是 Studio 代码缺陷，但本机 daemon 启动环境应显式带上 CLI 路径。
- [x] 发现并修复：DAG / 并行 / 串行 / retry / rerun / approve 都是同步长请求，但 Studio 原来复用 `apiFetch` 的 15 秒默认超时，真实模型超过 15 秒会被前端 abort，daemon 仍在后台执行。新增 `PIPELINE_REQUEST_TIMEOUT_MS = 10 分钟` 并用于这些请求（commit `d7dd834`）。
- [ ] 未做：并行 lane 的接受/驳回仍走普通 Run 操作。原“task 级 cancel 仍未做”的缺口已由上方 `Task 级取消`（2026-11-21）关闭。（团队任务队列已于 2026-11-21 改为 `GET /api/teams/:teamId/tasks`。）
- [x] 本轮提交：`2efd97a feat(storage-core): delete tasks without runs`、`0eb7917 feat(server-core): expose task deletion`、`24d8891 feat(cli): add the delete task tool`、`3592b06 feat(studio): run DAG and parallel teams`、`69bfffc docs(handoff): record branch runs and task deletion`、`d7dd834 fix(studio): keep long pipeline requests alive`。

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
- [x] 任务队列：初版按 `task.teamId` 过滤 `/api/tasks`；2026-11-21 已改为对选中团队调用 `GET /api/teams/:teamId/tasks`，显示任务状态，`pipeline.status === 'awaiting_approval'` 的任务额外标记“审批卡点”。
- [x] 接入 Studio 导航（`nav.teams`）与 `View` 联合类型；浏览器侧补 `AgentTeam`/`TeamHandoff` 类型与 `KernelTask.teamId`。
- [x] 文案全部走 i18n：`en`/`zh` 同步新增 `teams` 与 `nav.teams`；`owned-copy` 扫描通过。
- [x] 验证：Studio `tsc` 与 `vite build` 通过（1655 modules），Studio 14 文件 / 257 tests 绿；全仓 typecheck 0，50 文件 / 664 tests 绿。
- [x] 本轮提交：`b216d83 feat(studio): add the teams view`。
- [ ] 未做：交接边只有文本列表，没有可视化图；花名册不校验角色是否绑定 runtime；TeamsView 的角色 / 交接 / 队列 / 团队用量已在真实浏览器查看（2026-11-21），但计划预览需要一条带团队的 queued 任务，尚未点击。

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
- [ ] 未做：指标按创建时间窗口过滤，不按完成时间；返工率是全局启发式，不是逐任务口径；不接外部 observability（Prometheus/OTel）。Studio 指标页已在真实浏览器查看（2026-11-21，23 runs / 11 tasks 聚合）。

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
- [ ] 未做：这是**串行**协调器；并行版见下节（F5-07）。“拆任务”只按花名册拆到角色，不按内容再拆子任务；汇总不调模型、不做语义总结；Studio 的计划预览尚未点击（需要一条带团队的 queued 任务）。

## F5-07 并行团队 — 已完成（内核版，2026-11-20）

- [x] `KernelStore.executeParallelTeam(taskId, { runner?, maxConcurrency? })`：为团队每个角色创建独立 lane，worktree 从任务 base commit 拉开（`tasks/<taskId>/lanes/<roleId>`），按 `maxConcurrency`（默认 2，范围 1–8）分波执行。
- [x] `executeRun` 增加可选 `worktreePath` 与 `taskStatus: 'none'`：lane 在各自 worktree 里执行、证据从该 worktree 采集，且不会让每个 lane 改写任务状态；任务状态在全部 lane 结束后统一落一次（有任一成功 → `review`，全部失败 → `failed`）。
- [x] 冲突可见而非自动合并：按各 lane 的 `changedFiles` 求交集，返回 `{ file, roleIds }` 列表；不 merge、不解决。
- [x] 单个 lane 失败不阻塞其它 lane；角色停用/缺失/无可解析 agent 时该 lane 直接记失败原因。
- [x] 审计：新增 `parallel.executed` 事件（并发上限、lane 数、成功/失败、冲突数）。
- [x] server：`POST /api/tasks/:id/parallel/execute`（`maxConcurrency` 1–8，越界 400）；MCP：新增 `agent_ops_execute_parallel`。
- [x] 测试：3 角色团队按并发 2 跑 3 条 lane，实测最大并发 = 2、三个独立 worktree、每 lane 自有文件 + 两条 lane 共享的 `SHARED.md` 被列为冲突、任务落 `review`、审计含 `parallel.executed`；一个 lane 失败时另一个仍成功且任务仍 `review`；未 provision 的任务报 `no worktree`；server 200/400。全仓 typecheck 0，58 文件 / 698 tests 绿。
- [x] 本轮提交：`2411c85 feat(storage-core): add parallel team lanes`、`a63ef21 feat(server-core): expose parallel lanes`、`64033fb feat(cli): add the parallel lane tool`。
- [ ] 未做：**没有自动合并或合成**——lane 产出的 commit 需要人工逐个接受或放弃（接受语义见下节）；Studio 没有并行入口；真实模型的并行执行未跑（CLI 登录仍阻塞）。

## 并行任务接受语义 — 已完成（2026-11-20）

- [x] migration `0019_run_lane`：`runs.worktree_path` / `runs.lane_id`；`RunRecord.worktreePath` / `laneId` 随 API 返回，普通 Run 为 null。
- [x] `executeRun` 接受 `laneId` 并把实际 worktree 与 lane 落到 Run 上；并行 lane 走各自 worktree，普通 Run 仍用任务 worktree。
- [x] `acceptRun` 在 Run 自己的 worktree 里提交；lane commit pin 到 `refs/agent-ops/tasks/<taskId>/lanes/<laneId>`，多条 lane 接受互不覆盖。
- [x] 并行任务状态：接受一条 lane 后，若仍有 `queued`/`running`/`review` 的 lane，任务保持 `review`；全部决定后才置 `done`。驳回一条 lane 只 reset 该 lane 的 worktree，任务保持 `review`，该 Run 回到 `queued` 可重跑。
- [x] `run.accepted` / `run.rejected` 审计新增 `laneId`；Studio Run 身份行显示 `Lane`（并行通道）。
- [x] 测试：两条 lane 各自接受后任务才 `done`、主 worktree 未被污染、lane commit 在各自 worktree HEAD 且 pin ref 存在；驳回 lane 后任务仍 `review`、lane worktree 干净、文件被清掉。全仓 typecheck 0，58 文件 / 700 tests 绿；Studio 14 文件 / 257 tests 绿、`vite build` 通过。
- [x] 本轮提交：`5b32c6f feat(storage-core): accept parallel lanes`、`6bee0e6 feat(studio): label parallel lane runs`。
- [x] 后续补齐（2026-11-21）：并行结果面板已有一等 lane 决策入口与最终交付选择，见下方“并行 lane 决策与最终交付”。

## F5-07 收尾 — release 清理 lane worktree — 已完成（2026-11-20）

- [x] `releaseTask` 现在会先收集所有 Run 记录的非主 worktree（并行 lane 与 DAG step 各一个），逐个 `git status` 检查后再统一删除；任一路径有未提交改动即拒绝释放，主 worktree 保持原样（不会半释放）。
- [x] 测试：两条 lane 接受并 release 后，主 worktree 与两条 lane worktree 均不存在；存在失败 lane（留下 `DIRTY.md`）时 release 抛 `uncommitted changes` 且主 worktree 未被删除。全仓 typecheck 0，62 文件 / 730 tests 绿。
- [ ] 未做：release 不清理 `refs/agent-ops/tasks/<id>/lanes/*` 的 pin（保留可审计的 commit）；Studio 的 release 按钮未在浏览器验证。

## 并行 lane 决策与最终交付 — 已完成（2026-11-21）

- [x] storage-core：migration `0020_task_final_lane` 给 `tasks` 增加 `final_run_id` / `final_commit_sha`；`selectFinalLane(taskId, runId)` 只接受已 accepted 且有 commit 的 lane，持久化指针，不 merge；再次选择会替换指针。
- [x] server：`POST /api/tasks/:id/final-lane`，body `{ runId }`；非法 body 400、未知任务/Run 404、未接受或非 lane 409；`GET /api/tasks/:id` 返回两个 final 字段。
- [x] MCP：`agent_ops_select_final_lane`；`agent_ops_accept_run` 文案改为“并行 lane 要等全部决定后才关闭任务”。
- [x] Studio：并行结果面板在 lane `review` 时直接显示 Accept lane / Reject lane；`done` lane 显示 Set as final，选中后显示“最终交付 / Final”徽标；接受/驳回后本地 lane 状态即时刷新。
- [x] 语义：最终选择只指向 lane worktree 里已 pin 的 commit，不把改动应用到任务主 worktree；release 清理 lane worktree 后仍可通过 `refs/agent-ops/tasks/<taskId>/lanes/<laneId>` 读取。
- [x] 测试：storage-core 并行 6 例；server API 200/400/404；MCP 工具清单；全仓 typecheck 0，64 文件 / 751 tests 绿；Studio 1658 modules 构建成功。
- [x] 浏览器验收：隔离 DB `/tmp/agent-ops-lane-verify/agent-ops.sqlite` + 临时 git 仓，真实 CodeBuddy 2.142.0 两条 lane 各写 `PROBE_LANE.txt`；点 Accept lane 后第一条 done、第二条仍 review；点 Set as final 后第一条显示“最终交付”；点 Reject lane 后第二条 queued，任务保持 review。后端确认 `finalRunId=75e4cf8c-…`、`finalCommitSha=ced58f34…`；主 worktree clean 且没有 `PROBE_LANE.txt`；审计表存在 `task.final_lane.selected`。
- [x] 本轮提交：`2ed1adb feat(storage-core): select the final parallel lane`、`6b51497 feat(server-core): expose final lane selection`、`9750a83 feat(cli): add final lane selection`、`88cd6bd feat(studio): decide parallel lanes inline`。

## Studio 审计面板与导出 — 已完成（2026-11-21）

- [x] Studio 新增独立 **Audit / 审计** 导航与 `AuditView`，没有替换既有的 **Activity / 活动** 页：活动页记录项目创建、Blueprint 修订、Baseline 批准等前端事件，审计页只回放内核 `audit_events`。
- [x] `AuditView` 通过 `GET /api/audit` 读取 append-only 事件，筛选任务 ID、团队 ID、事件类型与最多条数（50 / 200 / 500 / 1000）；表单提交后才应用筛选，避免每次输入都请求。事件以 `<details>` 展开，显示 `seq` / 类型 / 时间、actor / task / team 与格式化 JSON data。
- [x] **Export audit JSON** 把已应用筛选与当前事件导出为 `agent-ops-audit-YYYY-MM-DD.json`；**Export task evidence** 要求任务 ID，调用 `GET /api/tasks/:id/export`，从 `content-disposition` 解析文件名并下载单任务证据包。下载 helper 先挂载 anchor，再在 `setTimeout(0)` 里 revoke blob URL，避免立即 revoke 取消下载。
- [x] 安全边界：审计页只调用已有的只读 API；导出在浏览器侧组装，不新增服务端权限面；任务证据仍走内核既有导出端点。
- [x] 测试：新增 `audit-view.test.tsx` SSR 冒烟，断言筛选与两个导出入口在事件加载前已渲染；全仓 typecheck 0，65 文件 / 752 tests 绿；Studio build 1659 modules 成功，主 chunk 288.60 kB。
- [x] 浏览器验收：隔离 DB `/tmp/agent-ops-audit-verify/agent-ops.sqlite` + 临时 git 仓，造 6 条真实角色 / 团队 / 任务审计。页面显示 `#1`–`#6`；按任务过滤后剩 2 条，再按 `task.created` 过滤后剩 1 条；展开可见 data。任务证据下载 `agent-ops-task-897204a3-….json`（1 KB，task 与 totals 正确）；审计 JSON 下载 `agent-ops-audit-2026-11-21.json`（3.2 KB，`count=7`，filters 与事件类型正确）。第二次下载触发浏览器多文件下载权限，重载后用 CDP 允许下载完成验证。
- [x] 本轮提交：`e85e4c4 feat(studio): add the kernel audit panel`。
- [ ] 未做：事件类型下拉是固定 21 项清单，不能从内核类型动态派生；没有自动轮询或实时追加，只有手动 Refresh；没有按时间范围或 actor 过滤。

## Studio 策略预览面板 — 已完成（2026-11-21）

- [x] 角色创建 / 编辑表单新增 `PolicyPreview`，位置在白名单、黑名单、审批模式之后、预算之前；点击 **Preview policy / 预览策略** 调用 `POST /api/policy/evaluate`，不新增服务端路由。
- [x] 结果表逐 Runtime 展示 `capability`、`enforcement`、只读、人工门与判定条数；每行可展开，列出逐工具 allow / deny、原因、warnings 与 `unsupportedReason`，并显示已评估 Runtime 数与当前审批模式。
- [x] 防止过期结果：以 `JSON.stringify(policy)` 作为签名，任一策略字段变化即清空旧结果；请求返回时若签名已变，丢弃响应，不会把旧策略的判定写回。
- [x] 空策略语义明确：没有白名单 / 黑名单时，页面提示各 Runtime 使用自身默认工具集；表格显示 0 条判定、`readOnly=false`，`enforcement=exact`（没有限制可执行，所以不存在不支持）。
- [x] 类型：`types.ts` 新增 `PolicyVerdict` 与 `PolicyPreviewResponse`，镜像内核 `UnifiedPolicyVerdict`；中英文文案补齐 `policy` 块。
- [x] 样式：新增 `.policy-preview`、`.policy-table`、`.policy-enforcement`、`.policy-decision`、`.policy-warnings` 等；预览按钮覆盖 `.secondary-button` 的 100% 宽度，改为自适应，避免挤占标题。
- [x] 测试：新增 `policy-preview.test.tsx` SSR 冒烟，断言标题、预览入口与空态；全仓 typecheck 0，66 文件 / 753 tests 绿；Studio build 1660 modules 成功，主 chunk 294.55 kB。
- [x] 浏览器验收：隔离 DB `/tmp/agent-ops-policy-verify/agent-ops.sqlite`，在 Roles → New role 填 `Read, Grep` + `Bash`，点预览得到 7 个 Runtime；`codex` / `claude-code` 为 native + exact，其余 5 个为 unsupported；每个 Runtime 20 条判定，`Read` / `Grep` allow、`Bash` 按黑名单 deny、其他已知工具按 allowlist deny；展开 aider 看到 warning 与 unsupportedReason。改动白名单后结果立即清空；空策略显示 7 个 Runtime、0 decisions 和默认工具集提示；中英文文案均正常。daemon 停止后再预览显示 `Unable to evaluate the policy.`，旧结果不保留。
- [x] 本轮提交：`babbb80 feat(studio): preview role policy across runtimes`。
- [ ] 未做：预览结果只用于人工查看，不会自动写入角色；没有“把判定导出 JSON”按钮；不支持原因与 warnings 仍显示服务端英文原文；没有独立于角色表单的全局策略沙盒页。

## Studio Teams 任务队列服务端过滤 — 已完成（2026-11-21）

- [x] `TeamsView` 不再在 `loadData` 里拉取全量 `/api/tasks` 后按 `teamId` 过滤；选中团队后单独调用 `GET /api/teams/:teamId/tasks`，团队列表只加载 `/api/teams` 与 `/api/roles`。
- [x] 切换团队立即清空旧队列，并用取消标记忽略上一团队的迟到响应；队列与卡点面板分别显示加载态和错误态，避免把“尚未加载”误报成“没有任务 / 没有卡点”。
- [x] 刷新按钮同时重载团队列表与当前团队队列；应用 Coordinator 计划后额外刷新当前队列，使 Pipeline 状态及时更新。
- [x] 计划预览增加团队切换保护：响应回来时若选中团队已变，不写入 `planResult`；旧请求的失败也不会污染新团队的全局错误；`planningTaskId` 只清除自己那条任务的 loading。
- [x] 中英文新增 `teams.tasksLoading` / `teams.tasksLoad`。
- [x] 真实浏览器验收：隔离 DB + 临时 git 仓，Alpha 团队 2 个任务、Beta 团队 1 个、未归属 1 个。进入 Teams 默认显示 Alpha 的两条队列，切到 Beta 只显示 `Beta queue only`，未归属任务不出现；网络记录只有 `/api/teams/alpha-team/tasks` 与 `/api/teams/beta-team/tasks`，刷新只重载当前团队队列。停止 daemon 后刷新，页面显示 `Unable to load teams.`，队列与卡点面板分别显示 `Unable to load the team task queue.`。
- [x] 门禁：全仓 typecheck 0；66 文件 / 753 tests 全部通过；Studio build 1660 modules 成功，主 chunk 295.45 kB，CSS 65.24 kB。
- [x] 本轮提交：`1636843 feat(studio): load team tasks from the team queue`。
- [ ] 未做：团队队列接口没有分页或状态过滤；任务数量大时仍会一次返回该团队全部任务。

## Task 级取消 — 已完成（2026-11-21）

- [x] `storage-core` 新增 `cancelTask(id)`：仅允许 `queued` / `running` / `review`；`done` / `failed` / `cancelled` 抛错。取消时 abort 该任务所有活动 Run；对没有执行句柄但仍为 `running` 的遗留 Run，直接标 `cancelled` 并补 `artifacts.cancelled`。
- [x] Pipeline：未 completed 的 Pipeline 整体变 `cancelled`；正在运行或待审批的步骤变 `cancelled`；从未启动的步骤补一条 `cancelled` 结果。已 completed 的 Pipeline 保留 `completed`，不删除既有 commit。
- [x] 串行 Pipeline 循环、DAG 调度与并行 wave 都检查任务取消标记：取消后不再启动后续步骤 / lane，也不把任务状态覆盖回 `review` 或 `failed`。并行中尚未启动的 lane 及其 queued Run 一并标 `cancelled`。
- [x] `executeRun` 在入口与打开执行句柄前各检查一次任务状态，防止取消与启动竞态；串行 / DAG / 并行 / retry / rerun 的入口也拒绝已取消任务。
- [x] 审计新增 `task.cancelled`，记录 `previousStatus`、`cancelledRuns`、`pipelineStatus`。
- [x] server `POST /api/tasks/:id/cancel`，返回 `{ task, cancelledRuns }`；终态任务经既有错误映射返回 409。
- [x] CLI MCP 新增 `agent_ops_cancel_task`。
- [x] Studio 任务展开面板对 `queued` / `running` / `review` 显示“取消任务 / Cancel task”，二次确认后调用取消接口并刷新任务与 Run；`pipelineStatus.cancelled`、`pipelineStepStatus.cancelled`、`fanoutStatus.cancelled` 中英文文案补齐。
- [x] 测试：`task-cancel.test.ts` 4 例（排队任务 + idle Pipeline、串行 Pipeline 活动 Run、DAG 活动 Run、并行双 lane）；server API 终态 409；MCP 工具清单更新。全仓 typecheck 0，68 文件 / 760 tests 绿；Studio build 1661 modules 成功，主 chunk 299.62 kB，CSS 67.60 kB。
- [x] 真实浏览器验收（2026-11-21，隔离 DB `/tmp/agent-ops-cancel-verify` + 临时 git 仓）：`Cancel from Studio` 排队任务点“取消任务”并确认后变“已取消”，idle Pipeline 与步骤也显示“已取消”；第二个两步任务取消后两步都显示“已取消”；后端确认 `status=cancelled`、`pipeline.status=cancelled`，审计含 `task.cancelled`（previousStatus `queued`、cancelledRuns `[]`、pipelineStatus `idle`）。
- [x] 本轮提交：`706e604 feat(storage-core): cancel tasks and their active runs`、`7d54839 feat(server-core): expose task cancellation`、`e60d8c2 feat(cli): add the cancel task tool`、`fbf7f5c feat(studio): cancel a task from its detail`。
- [ ] 未做：取消不删除 worktree（保留证据），后续磁盘回收仍需人工 release / delete；已取消任务不支持 retry / rerun；daemon 重启后无法恢复活动执行句柄，遗留 running Run 只能按“无句柄”路径直接标取消。

## DAG 多依赖合并 — 已完成（2026-11-21）

- [x] 缺陷：`executeDagPipeline` 原先 `branchFrom = 最后一个依赖的 commitSha`，多依赖 join 只从最后一个依赖检出，前面的依赖 commit 只记 warning，改动没有进入 step worktree。
- [x] `worktree.ts` 新增 `mergeDependencyCommits(worktreePath, commits)`：按顺序检查每个 commit 是否已是 `HEAD` 祖先，不是则用 `git -c user.name=Agent Ops -c user.email=agent-ops@localhost merge --no-ff --no-edit <sha>` 生成真实 merge commit；全部合并完成后返回最终 `HEAD`。
- [x] 冲突处理：读取 `git diff --name-only --diff-filter=U` 收集未合并文件，执行 `git merge --abort`，抛 `DAG dependency merge conflict in <files>`；step 标 `failed`，不带着半合并的 worktree 继续跑，left / right 等已完成结果保留。
- [x] `executeDagPipeline` 改为收集全部依赖 commit；任一依赖没有 commit 则下游 `skipped`。单依赖 / 根步骤沿用原 base，多依赖调用 `mergeDependencyCommits`，合并后的 HEAD 作为 `executeRun` 的 `evidenceBase`，Agent 改动只相对 merge base 计算。
- [x] `dag.test.ts`：join 用例改为 left 写 `LEFT.md` + `SHARED.md`、right 写 `RIGHT.md`，断言 join 同时看到两个文件、无 “not merged” warning、`conflicts=[]`；新增 left / right 都改 `SHARED.md` 的冲突用例，断言 join failed、error 含 `merge conflict` 与 `SHARED.md`、`conflicts` 的 stepIds 为 left / right、pipeline 第三条为 failed。
- [x] 门禁：`packages/storage-core/test` 17 文件 / 95 tests 绿；`worktree.test.ts` 覆盖“依赖已是 HEAD 祖先时不新增 merge commit”；全仓 typecheck 0；全仓 68 文件 / 762 tests 绿。
- [x] 文档：README 并行 DAG 能力与运行入口段落改为“多依赖依次 merge、冲突整步 failed”，去掉旧“只从最后一个依赖检出 / 未自动合并 warning”描述。
- [x] `DagStepResult` 新增 `mergeCommitSha`：仅当多依赖 join 实际产生新 merge commit 时写入，随 `pipeline.results` 持久化；`pipeline.dag.executed` / `paused` 审计 data 增加 `mergeCommits: [{stepId, commitSha}]`。Studio DAG 结果行显示 `merge <sha>`。
- [x] `dag.test.ts` 回归断言 join 的 merge SHA 可 `cat-file`、`rev-list --parents` 为两父提交、`pipeline.results` 含同值、审计 `mergeCommits` 命中；单依赖 join 的 `mergeCommitSha` 为空。
- [ ] 未做：跨步骤 changedFiles 交集仍只报告，不回写任务主 worktree。

## DAG 审批门 — 已完成（2026-11-21）

- [x] 缺陷：`executeDagPipeline` 原先显式拒绝 `requiresApproval`，DAG 只能全自动跑完，无法在任何步骤前人工检查。
- [x] `TaskPipeline` 新增持久化字段 `executionMode?: 'serial' | 'dag'` 与 `maxConcurrency?: number`；`parseTaskPipeline` 校验并恢复，避免审批恢复时把 DAG 误判成串行。串行执行、retry、rerun 显式写 `executionMode: 'serial'`。
- [x] `executeDagPipeline` 拆成公共入口 + 私有 `runDagPipeline` 调度器。gated step 不与普通 ready step 同波并发；每轮最多执行一个 gated step，Run 到 `review` 后 step result 落 `awaiting_approval`，pipeline 落 `awaiting_approval`、`executionMode: 'dag'`、`maxConcurrency` 与已完成 results；后续 pending steps 不写结果。
- [x] `approvePipelineStep` 按 `executionMode` 分支：DAG 先接受该 lane Run，把 awaiting result 改 completed 并写 commit / changedFiles，再以现有 results 为初始状态调用 `runDagPipeline` 续跑；已完成步骤不重跑，gated step 的 lane worktree 保留。
- [x] `rejectPipelineStep` 的 DAG 分支拒绝该 Run，把 gated step 与所有尚未完成的 step 标 failed，pipeline / task 均 failed，已完成上游结果保留。
- [x] 审计：暂停写 `pipeline.dag.paused`（stepId / runId / completed / pending / maxConcurrency），恢复写 `pipeline.dag.resumed`（stepId / runId / commitSha / pending），结束仍写 `pipeline.dag.executed`。`KernelAuditEventType` 与 Studio Audit 筛选同步。
- [x] Studio 移除“含 requiresApproval 就隐藏 Run as DAG”的旧限制；`DagStepResult.status` 接受 `awaiting_approval`，fanout 状态文案中英文补齐。
- [x] 测试：`dag.test.ts` 8 例，新增批准续跑（publish 只在 approve 后运行、prompt 拿到 review output、审计三类事件）、连续两道门（两次 pause / resume，最终一次 executed）、驳回（gated 与下游 failed、task failed）；原有 DAG 并发、多依赖 merge、冲突、失败跳过、模板、环校验回归通过。
- [x] 门禁：全仓 typecheck 0；68 文件 / 776 tests 绿；Studio build 1661 modules 成功。
- [ ] 未做：本轮未做真实浏览器端到端审批；Studio 只在类型与构建层验证，审批按钮复用既有 `pipeline.status === 'awaiting_approval'` 分支。

## Studio 任务看板 — 已完成（2026-11-21）

- [x] 新增 `TaskBoard.tsx`：按 `TASK_BOARD_STATES`（`queued` / `running` / `review` / `done` / `failed` / `cancelled`）分列；每列显示状态标签、任务计数、空列 `No tasks`；卡片展示标题、`repo@baseRef`、Pipeline 状态徽标、Team 或 Role chip。
- [x] `TasksView` 增加 `viewMode: 'list' | 'board'` 与 List / Board 分段切换；看板与列表按条件分支渲染，列表原有行为保持不变。
- [x] 卡片点击走 `openTaskInList`：切回列表、设置 `expandedId`、按 `task-row-<id>` 滚动定位。看板不复制 Run/Pipeline 详情操作面，避免两套详情维护。
- [x] 看板横向滚动，列最小宽 220px、列体最高 `65vh`；六种状态列头用不同 `border-top-color`；空列与加载态单独样式。
- [x] 中英文新增 `tasks.viewMode` / `viewList` / `viewBoard` / `boardTitle` / `boardHint` / `boardEmpty` / `openDetails`。
- [x] 测试：`task-board.test.tsx` 覆盖六列标签、六条任务、`Awaiting approval`、`alpha-team`、`reviewer`、`Open in list`、loading 不渲染列；SSR 文本节点分隔问题按独立值断言处理。
- [x] 真实浏览器验收（2026-11-21，隔离 DB + 临时 git 仓）：造 `Board queued/running/review/done/failed/cancelled` 六条任务，看板六列各 1 条，计数、Team/Role、Pipeline `Idle` 均正确；点击 `Board review` 卡片切回列表并展开，`Implement / codex / Pending` 可见；中文下六列显示“排队中 / 运行中 / 待审核 / 已完成 / 失败 / 已取消”。发现隔离 DB 直接改状态后 daemon 内存缓存仍返回旧值，重启 daemon 后验收通过；这是测试环境的缓存行为，不是看板缺陷。
- [x] 门禁：全仓 typecheck 0；67 文件 / 755 tests 全部通过；Studio build 1661 modules 成功，主 chunk 298.39 kB，CSS 67.59 kB。
- [x] 本轮提交：`796bf52 feat(studio): add a task status board`。
- [ ] 未做：看板没有分页/虚拟滚动，任务量很大时仍会一次渲染当前任务全集；卡片不提供独立详情抽屉，详情统一回列表；看板内不能直接执行/取消任务。

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
- [ ] 未做：成本只有上报 usage 时才有数字；卡点不含“被驳回的 lane 等待重跑”这类更细的状态。原“看板仍是列表式”的缺口已由上方 `Studio 任务看板`（2026-11-21）关闭。

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
- [x] Studio 预算输入（2026-11-21）：RolesView 与 TeamsView 的表单新增 Budget fieldset（USD / input tokens / output tokens），经 `lib/budget.ts` 合成 `CostBudget` 并随 create/update 提交；编辑时回填既有上限。浏览器实测：创建带 $1 的临时角色并回查 `/api/roles` 得到 `budget.maxCostUsd = 1`；创建/编辑临时团队 `$2 + 100000 input tokens` 回查一致、编辑表单回填正确，探针角色与团队均已删除。
- [ ] 未做：预算是“任务内”口径（同一 Role/Team 在不同任务里各自计算，不跨任务累计）；只在 Run 启动前阻断，不中断正在跑的 Run；API 不支持清空已配置的预算（表单留空只会省略 `budget` 字段，已有上限保留）；真实 CLI 不报 usage 时预算实际不生效。

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

## F6-06 并行 DAG — 已完成（内核版，2026-11-20；多依赖合并已在 2026-11-21 补齐）

- [x] pipeline step 增加 `dependsOn`：显式 `[]` 表示 DAG 根，未写则沿用串行“上一步”语义；`normalizePipeline` 校验依赖存在、禁自依赖、禁环。
- [x] `KernelStore.executeDagPipeline(taskId, { runner?, maxConcurrency? })`：按依赖层级调度 ready steps，`maxConcurrency`（默认 2，1–8）分波执行；每步独立 worktree `tasks/<taskId>/dag/<stepId>`，从**最后一个依赖的 commit** 检出。
- [x] 失败步骤的依赖者标记 `skipped`，其余分支继续跑；任务最终状态：任一 completed → `review`，全部失败 → `failed`。
- [x] 每步成功后 accept 并 pin 到 `refs/agent-ops/tasks/<taskId>/lanes/dag-<stepId>`；`pipeline.results` 落库（skipped 记为 failed + error）。
- [x] 新增 `evidenceBase`：DAG step 的 diff 以它自己的 branch base 为准，避免把上游依赖的文件算成本步改动（否则 join 的 changedFiles 会重复上游文件并制造假冲突）。
- [x] 多依赖时记录 warning（只从最后一个依赖检出，其它依赖 commit 不合并）— 已被 2026-11-21 “DAG 多依赖合并”取代；跨步骤 changedFiles 交集作为 conflicts 报告，不自动合并回任务。
- [x] DAG 中的 `requiresApproval` 已于 2026-11-21 补齐：gated step 单独执行，Run 到 `review` 时暂停整张 DAG；approve 接受 lane Run 后从已完成 results 续跑，reject 将该步与所有未完成下游标 failed。pipeline 持久化 `executionMode: 'dag'` 与 `maxConcurrency`，暂停/恢复写 `pipeline.dag.paused` / `pipeline.dag.resumed`。
- [x] server：`POST /api/tasks/:id/pipeline/dag`；MCP：`agent_ops_execute_dag`，`create_task` 的 step 接受 `dependsOn`。
- [x] 测试：两个根并发（实测 maxActive=2）、join 从 right 检出（可见 RIGHT.md、不可见 LEFT.md）、冲突报告 `SHARED.md`、warning 说明 left 未合并；失败根导致 child skipped 而 other 完成；环 / 未知依赖在 createTask 被拒；DAG 审批门覆盖批准续跑、连续两道门、驳回并失败下游；全仓 68 文件 / 776 tests 绿，typecheck 0。
- [x] 本轮提交：`30f09ff feat(storage-core): run pipelines as a DAG`、`8f4688a feat(server-core): expose DAG pipeline runs`、`3b307cd feat(cli): add the DAG run tool`。
- [ ] 未做：多依赖合并已由 2026-11-21 章节补齐；Studio 的 DAG 运行入口与真实 CodeBuddy 验收已在后续章节完成。

## 真实模型 Run（CodeBuddy）— 已完成（API + UI，2026-11-20）

- [x] 阻塞复盘：Claude Code / Codex 仍被 CC Switch 的 `base_url` 缺失挡住，但本机已安装并登录的 **CodeBuddy v2.185.0** 在 registry 中是 `verified` adapter，可直接使用。
- [x] 真实执行路径：内核 daemon（`npx tsx apps/cli/src/index.ts start`，端口 3737，DB 落仓库 `.agent-ops/`）→ 建任务 “Real model acceptance” → provision → `agentId: codebuddy` 建 Run → `POST /api/runs/:id/execute`。
  - 结果：`status=review`、`exitCode=0`、`durationMs=15064`、`runtimeId=codebuddy`、`runtimeVersion=2.185.0`、`changedFiles=['REAL_MODEL.md']`，diff 恰为 `hello from codebuddy` 一行。
- [x] 内容与提交验收：worktree 中 `REAL_MODEL.md` 精确为 `hello from codebuddy`；`accept` 后 commit `202033823e4ad7f7f12dcbc47717718016688c8a`，worktree clean，任务 `done`。
- [x] 证据导出：`GET /api/tasks/<id>/export` 确认 `runs=1 / acceptedCommits=1 / changedFiles=1 / durationMs=15064`；usage 三字段为 `null`、tool audit 为 `unknown`（CodeBuddy 不上报），按“不伪造”口径记录。
- [x] `.agent-ops/` 加入 `.gitignore`（daemon 从仓库根启动时 DB 与任务 worktree 都落在这里）。
- [x] Studio UI 验收（2026-11-20）：Roles 页新建角色 `UI CodeBuddy`（base agent `codebuddy`）→ Tasks 页新建任务 “UI real model run”（pipeline 一步 `Implement` 绑定该角色）→ 点 `Run pipeline` → 真实 CodeBuddy 执行 → 任务 `done`。
  - 结果：run `669f2e22-abc2-4432-a22a-5265b3205398`、`codebuddy` 2.185.0、exit 0、14.7s、`changedFiles=['UI_REAL.md']`、commit `ea4553f7d2`；文件内容精确为 `hello from the studio UI`。
  - UI 中可见：step “Implement / ui-codebuddy / Completed / ea4553f7d2”，Run 列表 “codebuddy Done UI_REAL.md | untracked”。
- [x] UI 验收过程中发现并修复两个真实缺陷：① 新建任务表单不 provision worktree，`Run pipeline` 直接 409 “no worktree”；② 执行后不刷新已展开任务的 Run 列表（显示 “No runs yet”）。提交 `902d864 fix(studio): provision and refresh pipeline runs`。
- [ ] 剩余：Claude Code / Codex 仍受 CC Switch `base_url` 阻塞；CodeBuddy 不上报 usage 与工具调用（记录为 null / unknown）；M1 的“4 步串行完整组合”此前由确定性 runner 验收。

## F10-01/F10-02 Dogfood（3 个真实任务 + 3 次团队运行）— 已完成（2026-11-21）

> 方法：在本仓为每个任务建一条一步 Pipeline（角色 `ui-codebuddy` → CodeBuddy 2.185.0）；执行后审阅 agent 的 commit，把 diff 应用到 `dev`，再用本仓自己的检查验收。Pipeline 步骤由系统自动 accept，人对最终 diff 负责。

| # | 任务 | agent commit | 落入 dev | 文件 | 运行时长 | 验收 | 返工 |
|---|---|---|---|---|---|---|---|
| 1 | Studio 失败 Run 的 Keep/Fresh 重跑策略 | `dbb14d2` | `4784db0` | 3 | 199.9 s | Studio tsc + 257 tests + build 全过 | 0 |
| 2 | 任务详情预算面板（role / team 两个 scope） | `ddd49a4` | `fc69c9e` | 5 | 291.7 s | 同上 | 0 |
| 3 | `agent-ops export --summary` | `fef3658` | `27c47be` | 1 | 360.0 s | CLI typecheck + 实跑命令；审阅发现 `5m 60.0s` 取整缺陷 | 1 次人工小修（`bbeb927`） |

- 接受率：**3/3**（三条全部应用进 `dev`）。
- 检查通过率：**3/3**（改动应用后本仓检查全绿；检查由验收方执行，不是 agent 自证）。
- 返工率：**1/3**（dogfood 3 的时长取整缺陷由人修复，未回退给 agent 重跑）。
- CodeBuddy 不上报 usage，成本记为未上报；工具调用审计为 `unknown`。
- 局限：任务都较小（1–5 文件、约 3–6 分钟）；固定使用 CodeBuddy；受限工具策略在 CodeBuddy 上无法执行（adapter `toolPolicy: unsupported`，受限角色会被直接拒绝）。
- [ ] 未做：M2 退出标准还有一条“5 角色团队完成一个真实仓库任务（架构→实现→审查→测试→汇总）”，尚未用真实模型跑；现有 3 条 dogfood 不覆盖 5 角色串行。

### Dogfood 4：五角色团队串行（2026-11-21）

- 团队 `CB Delivery`（5 个角色，全部绑定 CodeBuddy），任务 “Dogfood 4: five-role team run”；Coordinator 按交接边推导出 5 步 Pipeline，全部在 `dev` 的同一 worktree 串行执行。
- 结果：5 步全部 `completed`、5 个 agent commit（`2086d1f` → `a15a624` → `2caf8e3` → `e260347` → `fc0b54e`）、4 条 handoff 收据（artifacts 1→2→3→4）、总耗时 420 s；产物整体应用为 `c36df4d`。
- 产物：`docs/dogfood/team-run/01-plan.md` … `05-summary.md`（385 行）。
- 关键发现：五步只产出「笔记」，**落盘 owner 从未被指派**；summarizer 明确拒绝把本轮写成“通过”，并列出 reviewer/tester 一致确认的缺口（预算上限漏 `maxOutputTokens`、分桶字段说明不足、证据表述需区分单 Run 与汇总指标）。这是“不无证据声称通过”的约束在真实链路里生效的证据。
- 结论：5 角色串行在真实模型下跑通（本轮交付物为 docs 目录）；但“团队任务需要一个落盘 / 最终集成 step 的 owner”此前是缺口，已由下方「Coordinator 落盘 owner」补齐。
- [ ] 未做：没有让这 5 个角色产出真实代码改动（worktree 无 node_modules，跑测试不可行）；这一轮已完成的历史运行没有 owner，需要人工/重跑才能产出可验收的落盘。

### Dogfood 5：owner 落盘验证（2026-11-21）

- 团队 `CB Owner Team`（planner → writer，`ownerRoleId = writer`）；Coordinator 计划把 writer 置于最后并标记 `ownsDeliverable: true`。
- 结果：2 步全部 `completed`（agent commit `05c0c74`、`2d1ec25`），总耗时 50 s；`coordinatorSummary` 返回 `owner: { stepId: 'cb-writer', status: 'completed' }`。
- 产出：writer 写出的 `02-final.md` 内容精确为 `owner wrote this.`，并按指令向 `01-plan.md` 追加写入说明；整体应用为 `9ff5aa5`。这是 owner 机制“真的会写”的实测证据，而不只是计划标记。
- 运维提示：daemon 是长驻进程，**改完内核代码必须重启 daemon**；本轮第一次 apply 跑在旧代码上，旧 schema 静默丢弃了 `ownerRoleId`，重启并 PUT owner 后才正确标记。写进这里避免复现。

### Dogfood 6：带 owner 的五角色交付（2026-11-21）

- 团队 `CB Delivery`（5 角色，`ownerRoleId = summarizer`）；任务 “Dogfood 6: owned five-role delivery”，Coordinator 推导的 5 步中 owner 步骤置末并标记 `ownsDeliverable`。
- 结果：5 步全部 `completed`（agent commit `d6148fb` → `f0f8565` → `92187be` → `2130471` → `e38c83b`）、4 条 handoff、总耗时 430 s；`coordinatorSummary.owner = { stepId: 'cb-summarizer', status: 'completed' }`。
- 落盘：owner 真的写出 `05-final.md`（5.5 KB，按 reviewer 修订后的 README-ready「报告指标」小节）并附 `05-summary.md`；6 个文件共 440 行，应用为 `4065cca`。
- 对比 Dogfood 4（未配 owner、只产笔记）：本轮满足 M2 退出标准「5 角色团队完成一个真实仓库任务（架构→实现→审查→测试→汇总）」——交付物是真实仓库文档而非代码；owner 也自己列出贴入 README 前仍需处理的缺口（`--summary` 未进 README 命令节、Team 预算证据映射缺一项、SSE 仅源码引用无运行时验证）。
- [x] `05-final.md` 已贴入 README「报告指标」小节（运行证据 / 工具审计 / 成本预算三张表），并按 owner 列出的缺口做了三处修正：命令节补 `--summary`；预算来源指向 `roles.ts` / `teams.ts`；SSE 措辞改为 stdout/stderr 以事件落库（每 Run 最近 500 条）可回放，并在 README「已知限制」补上未做压测的说明。
- [ ] 未做：交付物是文档；worktree 依赖已可链接（见 Dogfood 7），但“五角色产出真实代码”本身仍未试。

### Dogfood 7：worktree 依赖与测试执行（2026-11-21）

- 任务 `d71b8b62`（角色 `cb-test-runner` → CodeBuddy），objective 只要求“在 workspace 里跑 `npx vitest run packages/storage-core/test/worktree.test.ts` 并报告结果，不改文件”。
- 结果：11.4 s、exit 0、**`Tests 5 passed (5)`**、`changedFiles = []`；accept 后 commitSha 回写为当前 HEAD（无改动不伪造提交）。
- 意义：worktree 里真的有依赖可用，agent 能在隔离环境跑项目检查——这是把 dogfood 从“文档任务”升级成“代码任务”的前提。
- 首轮（`2162cc26` / `0418b424`）暴露缺陷：`node_modules` 符号链接不被目录式 `.gitignore` 匹配，被计成 changedFiles；已修复并 reject 该轮，复跑得到干净证据。

### Dogfood 8：五角色真实代码交付（2026-11-21）

- 团队 `CB Code Team`（architect → implementer → reviewer → tester → owner，owner 置末）；任务 “Dogfood 8: five-role code delivery”，目标为新增 `KernelStore.listTasksByTeam(teamId)` 与一条单测。
- 结果：5 步全部 `completed`（`ae0bc9e` → `018ea48` → `1490bd5` → `3aa7738` → `d2c4f80`），320 s；`owner.changedFiles = 2`、`warnings = []`。
- 交付：`packages/storage-core/src/index.ts` +5（复用 `eq` / `TaskRow` / `toTaskRecord`）；`task-run.test.ts` 新增用例覆盖两个 Team、未分配任务、未知 teamId。tester 在链接依赖的 worktree 实跑 `Tests 9 passed (9)`。
- **真实链路价值**：reviewer 发现 implementer 的断言 `not.toContain('B1')` 恒真（拿标题字符串对比 UUID 列表），owner 在最终步把断言改成 `not.toContain(b1.id)` 并补充未分配任务断言——这是多角色链路里“审查 → 修正”第一次真实发生。
- 验收：diff 应用进 `dev` 后 typecheck 0、全仓 **62 文件 / 737 tests 绿**；提交 `14125ef feat(storage-core): list tasks by team`、`0e5bb4a docs(dogfood): record the five-role code run`。
- [x] 已暴露：`GET /api/teams/:teamId/tasks`（未知 Team 404）与 MCP `agent_ops_list_team_tasks`；测试覆盖两条任务的过滤与 404。
- [ ] 未做：未加显式排序（与 `listTasks` 一致，测试不依赖顺序）；Studio 团队详情仍用客户端过滤，尚未改用该接口。

## Coordinator 落盘 owner — 已完成（2026-11-21）

- [x] Team 增加 `ownerRoleId`：必须是花名册成员，且不得再交接给其它角色（否则 owner 不可能是最后一步）；create/update schema 与 JSON store 同步。
- [x] `planTeamPipeline`：owner 步骤被移到末尾、标记 `ownsDeliverable: true`，prompt 追加 “You own the final deliverable…”；未配置 owner 时计划给出 warning `Team has no owner role`；owner 不在花名册时也给出 warning。
- [x] `applyTeamPipeline` 保留 `ownsDeliverable`；`coordinatorSummary` 新增 `owner: { stepId, status, changedFiles }` 与 `warnings`。
- [x] 事后校验：`TaskPipelineStepResult` 记录每步**自己的**变更集（该步 base commit → 该步 commit，而不是任务全量 diff）；summary 对 owner 的四种情形分别告警：没有 owner、owner 尚未运行、owner 完成但 0 改动（“the final write may be missing”）、owner 非 completed 结束。Dogfood 4 那种“只产笔记”的场景现在会被自动抓到。
- [x] server team schema 自动接受 owner（越界 400）；MCP 团队工具新增 `ownerRoleId`；Studio 团队表单新增「落盘角色」选择（角色离开花名册会自动清空），详情面板展示 owner。
- [x] 测试：owner 越界 / owner 仍有 outgoing handoff 被拒；合法 owner 持久化；plan owner 置末 + `ownsDeliverable` + prompt 后缀；无 owner 时 warning；summary owner 状态；owner 完成后 0 改动触发 warning；无 owner 的 pipeline summary 告警；owner 真的写了文件时 `changedFiles = 1`；server 往返 + 400 + plan 暴露。全仓 typecheck 0，62 文件 / 733 tests 绿；Studio 257 tests 与 `vite build` 通过。
- [x] 本轮提交：`f3aea53 feat(teams): name a team owner role`、`e0b115b feat(storage-core): mark the owner step in a team plan`、`c1b0f93 test(server-core): cover team owners over HTTP`、`6038f0d feat(cli): accept a team owner field`、`640faa1 feat(studio): set a team owner`、`80c1f33 feat(storage-core): verify the owner wrote something`。
- [ ] 未做：校验是启发式的（只看该步改动文件数，不校验内容与路径）；历史五角色运行（Dogfood 4）没有 owner，要重跑才能产出可验收的落盘。
- [x] Studio 表单已在真实浏览器验证：`CB Owner Team` 的 owner 下拉只列花名册角色，并正确显示 `cb-writer`，提示文案也在。

## Worktree 依赖策略 — 已完成（2026-11-21）

- [x] `linkNodeModules(repo, worktreePath)`：把主仓 `node_modules` 以符号链接放进新 worktree；接入 `provisionTask`、并行 lane、DAG step 与 fresh 重跑的重建路径。`AGENT_OPS_LINK_NODE_MODULES=0` 关闭；仓库无依赖或 worktree 已有 `node_modules` 时 no-op。
- [x] 防止污染证据：符号链接不会被目录式 `node_modules/` 匹配，所以同时向仓库共享 `info/exclude` 写一条无斜杠的 `node_modules` 规则（用 `git rev-parse --path-format=absolute --git-common-dir` 定位）。
- [x] 真实模型验收见 Dogfood 7：CodeBuddy 在链接后的 worktree 实跑 5 个测试通过，`changedFiles = []`。
- [x] 测试：链接一次生效、二次 no-op；无依赖与 opt-out 均不链接；链接后 `git status --porcelain` 为空；`provisionTask` 自动链接。全仓 typecheck 0，62 文件 / 736 tests 绿。
- [x] 本轮提交：`6321055 feat(storage-core): link dependencies into worktrees`。
- [ ] 未做：只链接根 `node_modules`（npm workspaces 的 `@agent-ops/*` 由 worktree 自己的 vitest alias 解析，tsc 跨包类型仍可能指回主仓源码）；仓库本身没装依赖时仍需先 `npm ci`；策略生效前创建的旧 worktree 不会自动补链。
