# Agent Ops — handoff

## 待办登记（标准）

> 本段是本产品唯一活跃待办入口；详细背景见下方原有章节。完成一项改 `[x]`，并在“最近变更 / Recently shipped”留证据。
> 最近同步：2026-11-19
>
> 产品规划（非活跃待办，不计入上方待办）：多 Agent 角色与团队 v0.2/v0.3，PRD 见 `docs/prd/Agent-Ops-多Agent角色与团队-PRD-2026-11-19.md`，实施拆解见 `docs/prd/Agent-Ops-多Agent角色与团队-实施拆解-2026-11-19.md`；后续方向备忘（Tier 0 能力包 / 自有 Harness）见 PRD §12.1。

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

## 技术债 — 已完成

- [x] 去重 health/doctor/runtime 路由：`createKernelApp` 新增 `diagnostics` 开关（默认 `true`，独立内核模式不变），webapp 模式 daemon 以 `diagnostics: false` 只挂 task/run，health/doctor/runtime 继续由 webapp 路由拥有；不再依赖“后挂载遮蔽内核副本”。
- [x] 测试：server-core 断言 `diagnostics: false` 下四个诊断端点 404 且 `/api/tasks` 仍 200；delivery-server 的 `/api/health` 断言带 `version`（证明响应来自 webapp 路由）。
- [x] 门禁：typecheck 0、44 文件 / 602 tests 绿。