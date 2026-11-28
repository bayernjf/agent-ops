# Agent Ops — Lanes 泳道视图 PRD（Draft）

> 日期：2026-11-28
> 状态：讨论定稿，未立项、未开工。本文固定讨论结论与开放问题，避免后续实现漂移。
> 活跃待办见 `../../handoff.md` 的 `## 待办登记（标准）`。

## 1. 背景与问题

当前 Studio 的任务侧有 `List / Board` 两种视图：List 看队列，Board（Kanban）按 `queued / running / review / done / failed / cancelled` 六状态分列。两者都回答「任务处在哪个阶段」，但都**不回答「正在跑的那几条谁和谁同时跑、谁快谁慢、谁卡在审批」**。

用户提出「泳道（Lanes）形态」：从左到右排开多条泳道，每条泳道是一个上下文窗口（session），实时往下滚各自的执行现场，一眼看清并行执行的全貌。

## 2. 定位

- **落在 Agent Ops，不新开产品**。底层并行能力（并行 lanes、DAG、SSE 实时输出、审批门）已存在，本特性是给并行能力补一个「实时执行现场」的展示层。
- 与 Orca ADE 的差异：Orca 用「分屏 pane」拼终端/浏览器/diff，画的是并列面板；Lanes 画的是**编排关系**——谁 ready、谁被谁 block、谁 waiting approval、谁跑完在等 join。

## 3. 已拍板决策

| # | 决策 | 结论 |
|---|---|---|
| D1 | 泳道粒度 | **一个 session 一条泳道**；一个 agent 可以同时开多个 session，即多条泳道。粒度不是 agent、也不是 step。 |
| D2 | 交互形态 | 第一版**只读直播 + 关键动作按钮**（暂停 / 取消 / 批准 / 驳回），不在泳道内打字发 prompt；可交互窗口后置。 |
| D3 | 与 TaskBoard 关系 | 新增 `Lanes` 视图，**不改 TaskBoard**；先上线看效果再迭代。 |
| D4 | 与 Kanban 关系 | Kanban 与泳道视觉同构（都是列式），列语义不同：Kanban 列 = 状态，泳道列 = 一个执行流。复用列式容器骨架。 |
| D5 | 入口 | 任务页头部 `List \| Board \| Lanes` 分段控件第三态；并推荐看板右上角加一个高对比 `Live lanes` pill 作第二入口（待拍板）。 |
| D6 | 视图配合 | Kanban 与 Lanes 双向跳转：Kanban 点 `running` 卡 → 进 Lanes 并 focus 该 lane；Lanes 点 lane 头 → 回 Kanban 定位该卡。 |
| D7 | 回放 | 历史 run 回放留作第二步，第一版只做实时直播。 |

## 4. 数据模型映射

- 一条泳道 = 一个 `Run`。`RunRecord`（`packages/storage-core/src/index.ts`）即「一个 agent 进程一次完整执行」，含 `id / agentId / roleId / taskId / laneId / command / usage / artifacts`。
- 泳道内容实时消费现有 `RunEvent` SSE 流（`started / stdout / stderr / completed / failed / cancelled`，带 `seq`）。
- 一个 agent 多个 session = 多个并行 `Run`，天然映射为多条泳道。
- **无需新增 session 实体**（第一版）。

## 5. 范围

### In scope（第一版）

- Studio 新增 `Lanes` 视图（实时执行现场）。
- 一条泳道 = 一个 active `Run`，lane 头展示 `agent · role · task · repo@ref · 已运行时长`。
- lane 内实时滚动 stdout/stderr，工具调用/审批门/交接/失败重跑作为内联标记。
- 关键动作按钮：暂停 / 取消 / 批准 / 驳回（复用现有 API，不动状态机）。
- 与 Kanban 双向跳转。

### Out of scope（第一版）

- 泳道内可交互输入（发 prompt、追加指令）。
- 历史 run 回放。
- 泳道内打字式多轮对话（`Run` 现为「单发单收」，非长驻多轮交互会话）。

## 6. 交互设计（草案）

- 泳道从左到右 = 并列的并发执行流；每条内部纵向滚动 = 时间推进。
- 并发超过屏宽时固定屏宽 + 横向滚动，focus 单条放大。
- `Lanes` 仅在存在 active run 时亮起（带 live 呼吸点），无 active run 时置灰或空态。

## 7. 开放问题（开工前须确认）

| # | 问题 | 状态 |
|---|---|---|
| Q1 | `Run` 是否已能表达「同一 agent 并发多 session」的完整语义，是否有约束（需逐文件核实 storage-core 的 run 创建/并发约束） | open |
| Q2 | 默认视图：Board，还是记住用户上次选择 | open |
| Q3 | 无 active run 但有历史 run 时，`Lanes` 是空态还是进入回放模式 | open |
| Q4 | 双入口（分段控件 + live pill）是否都做 | open |
| Q5 | 长驻多轮交互 session（持续对话、compaction）何时立项扩展 | open |

## 8. 建议里程碑

1. **M1 立项 + 核实 Q1**：确认 Run 并发语义，定稿本 PRD 状态为 Approved。
2. **M2 Lanes 只读直播**：新增视图、SSE 接入、lane 头、动作按钮、双向跳转。
3. **M3 看效果迭代**：根据实际使用决定是否做回放、可交互窗口。
