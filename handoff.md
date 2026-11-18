# Agent Ops — handoff

> 本仓库从 agent-dev 迁移而来（move 阶段已闭环），当前处于**功能裁剪**阶段。
> 迁移方案与执行记录见 `bayjf/docs/tier0/Tier0-agent-dev并入AgentOps-迁移方案-2026-11-18.md`。

## 迁移（move 阶段）— 已完成

- [x] agent-dev → agent-ops 命名清零（45 文件 / 414 处，commit `4899dae`）
- [x] 内核 4 package（agent-runtime / workflow / policy / storage-core）+ 2 app（cli / daemon）抽取
- [x] webapp-delivery 插件隔离（blueprint / storage-webapp / delivery-server / provider-core / provider-cli / deployment-composer + studio）
- [x] 数据目录 `~/.agent-dev` → `~/.agent-ops`，环境变量 `AGENT_DEV_*` → `AGENT_OPS_*`
- [x] typecheck 0 错误、42 文件 / 589 tests 全绿

## 功能裁剪 — 进行中

- [x] ① 15 态 delivery machine 迁出内核 → 新建 `@agent-ops/delivery-workflow` 插件包（commit `feaacc2`）；内核 `workflow` 只留 5 态 task-run
- [ ] ③ 拆 delivery-server：内核路由（health/doctor/credentials/connectors/runtime/profiles）回归内核 daemon，模板路由（/api/projects/* 云链路）留插件；云链路改为可选加载
- [ ] ② blueprint 收敛 preset：6 类 Blueprint 对外收敛为 preset 命名空间 + `task.recipe`（方案 B：保留 6 类 generator 实现，不物理删除）；storefront 作为独立 preset

## 收尾 — 待做

- [ ] dogfood：用 agent-ops 在真实仓库跑通一条 Task/Run（diff 可审阅、可接受/打回）
- [ ] 确认 daemon / studio / cli 独立启动，不读任何 `~/.agent-dev` 路径
- [ ] 删除本地 `/Users/jiangfeng/000mycodes/agent-dev` + `~/.agent-dev`（前置：裁剪 + dogfood 完成；删前备份到 `~/000mycodes-backups/agent-dev`）
