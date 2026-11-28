# Agent Ops — Lanes 泳道视图 实施拆解（Draft）

> 日期：2026-11-29
> 配套 PRD：`Agent-Ops-Lanes泳道视图-PRD-2026-11-28.md`
> 状态：开工前施工图，随实现进展更新；活跃待办仍以 `../../handoff.md` 的 AO-02 为准。

## 0. 开工门（已核实）

- **Q1（2026-11-29 核实）**：`Run` 已能表达「同一 agent 并发多 session」，**无 agent 级互斥**。
  - `KernelStore.createRun()` 每次生成新 `id`，只校验任务存在与预算，不检查同一 `agentId` 是否已有 active run。
  - 并行 lanes 每 role 一条 `createRun`，多个 role 绑同一 agent 时天然产生同 `agentId` 的多条并行 Run。
  - `activeRuns` 是 `Map<run.id, AbortController>`，按 run 记取消句柄，不是按 agent 加锁。
  - 结论：**第一版泳道 = 一个 active `Run`，无需改数据层**。

## 1. Epic 与范围

- **Epic AO-LANES**：Studio 新增 Lanes 只读直播视图。
- **范围**：M2（只读直播 + 关键动作按钮）。不含历史回放、不含泳道内可交互输入。

## 2. 功能点

| id | 功能点 | 依赖 | 验收口径 |
|---|---|---|---|
| FE-1 | 视图壳 + 分段控件第三态（`List / Board / Lanes`） | 无 | 三态可切、Lanes 选中态与 live 呼吸点正确 |
| FE-2 | active Run 数据源（列出正在跑的 run） | 开工前调研 T0 | 泳道条数与 active run 一一对应，无 active 时显示空态 |
| FE-3 | SSE 实时流接入（`RunEvent` stdout/stderr） | T0、FE-2 | 泳道随事件滚动，`seq` 去重、断线重连 |
| FE-4 | 泳道头 + token 用量条 | FE-2 | lane 头展示 agent/role/task/repo@ref/时长；token 条按 usage 渲染 |
| FE-5 | 内联标记（工具调用 / `awaiting approval` / 错误行 / diff） | FE-3 | 审批门黄色横幅、错误红色行、工具调用高亮、diff 可展开 |
| FE-6 | 动作按钮（暂停 / 取消 / 批准 / 驳回） | FE-2 | 复用现有 API，不破坏状态机 |
| FE-7 | 与 Kanban 双向跳转 | FE-1、FE-2 | Kanban `running` 卡 → focus lane；lane 头 → 回 Kanban 定位卡 |
| FE-8 | 空态 + 深色工业风样式 + 横向滚动/focus 单条 | FE-1 | 无 active 时引导文案；窄屏横向滚动，focus 放大 |

## 3. 依赖与顺序

1. **T0 调研（开工前必查）**：确认 Studio 现有 SSE 订阅方式与 active run 查询端点，读 `plugins/webapp-delivery/apps/studio` 与 `packages/storage-webapp`、`packages/delivery-server`。
2. 实现顺序：`FE-1 → FE-2 → FE-3 → FE-4/FE-5 → FE-6/FE-7 → FE-8`。
3. FE-6 复用现有 API（`cancelRun` / `approvePipelineStep` / `rejectPipelineStep` / 暂停恢复），不动状态机。

## 4. 测试策略

- 组件测试：视图三态切换、泳道头渲染、状态→颜色映射、空态。
- SSE 重放：用 `RunEvent` 序列 mock 重放，验证滚动、`seq` 去重、断线重连。
- 交互测试：动作按钮调用正确 API；Kanban ↔ Lanes 双向跳转。
- 回归：全仓 `npm run typecheck` + `npm test`；Studio build 通过。

## 5. 里程碑

1. M2-1：FE-1 + FE-2（视图壳 + 数据源）。
2. M2-2：FE-3 + FE-4 + FE-5（实时流 + 泳道渲染）。
3. M2-3：FE-6 + FE-7 + FE-8（交互 + 收尾 + 样式）。
4. M2 验收：真实 CodeBuddy 并行任务在 Lanes 里能看到多条泳道实时滚动、审批门与动作按钮可用、双向跳转正常。

## 6. 开放问题（不阻塞 M2，按默认值推进）

| # | 问题 | 默认值 |
|---|---|---|
| Q2 | 默认视图 | Board |
| Q3 | 无 active 但有历史时：空态 or 回放 | 空态（回放后置） |
| Q4 | 双入口（分段控件 + live pill） | 先做分段控件第三态，live pill 后看效果 |
| Q5 | 长驻多轮交互 session | 后置，不在 M2 |
