# Agent Ops — handoff

> 本仓库从 agent-dev 迁移而来（move + 功能裁剪 + 收尾已闭环），当前处于**运行证据链补强**阶段。
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

- [x] cli 的 MCP server 补 11 个内核 task/run 工具（`list/get/create/provision/release` task，`list/create/get/execute/accept/reject` run），对应 server-core `/api/tasks`、`/api/runs`；与 webapp 面工具并行、不替换
- [x] delivery-server 组合内核路由：`createDaemonApp` 挂载 `createKernelApp`，webapp 模式 daemon 也暴露内核 task/run 控制面（外层 auth 中间件统一鉴权；health/doctor/runtime 由 webapp 路由拥有，内核侧以 `diagnostics: false` 不再挂载，见下“技术债 — 已完成”）
- [x] mcp.test.ts 补内核 task/run 端到端测试（create_task→list/get→create_run→list/get→404），全量 44 文件 / 601 tests 绿

## 运行证据链 — 已完成（2026-11-19）

- [x] `storage-core` 新增 `runs.artifacts`（migration `0008_run_artifacts`）：持久化 combined stdout/stderr、output 截断标记、完整 diff（tracked diff + untracked patch）、diff 截断标记、changedFiles、exitCode、signal、timedOut、startedAt/completedAt、durationMs。
- [x] `executeRun` 成功、失败、超时三条路径都采集并落库，不再只记录 `diffStat`；证据采集是 best-effort，git 异常不会把已完成的 run 变成未落库异常。
- [x] `GET /api/runs/:id` 与 `GET /api/tasks/:id/runs` 直接返回 `artifacts`；accept/reject 保留证据，不重写。
- [x] Studio Task 看板每个 Run 可展开“运行证据”，显示 exit code、耗时、变更文件、stdout/stderr、完整 diff 与截断提示。
- [x] 测试：storage-core `execute-run.test.ts` 10 例（含成功、未跟踪文件、失败、超时、超大输出截断、持久化重开）；server-core 7 例（含 API 返回 artifacts、accept 保留 artifacts）；全仓 44 文件 / 604 tests 绿，Studio `tsc + vite build` 成功。

## 技术债 — 已完成

- [x] 去重 health/doctor/runtime 路由：`createKernelApp` 新增 `diagnostics` 开关（默认 `true`，独立内核模式不变），webapp 模式 daemon 以 `diagnostics: false` 只挂 task/run，health/doctor/runtime 继续由 webapp 路由拥有；不再依赖“后挂载遮蔽内核副本”。
- [x] 测试：server-core 断言 `diagnostics: false` 下四个诊断端点 404 且 `/api/tasks` 仍 200；delivery-server 的 `/api/health` 断言带 `version`（证明响应来自 webapp 路由）。
- [x] 门禁：typecheck 0、44 文件 / 602 tests 绿。
