# 05-final.md — README-ready「报告指标」终稿（CB Summarizer / owner）

本文件是「Dogfood 6：owned 五角色交付」的第五步（owner 落盘）。输入为 `01-plan.md`（Architect）、`02-implementation.md`（Implementer）、`03-review.md`（Reviewer）、`04-test-report.md`（Tester）。

已按 `03-review.md` 的缺口 1/2/3 修订措辞，并采纳「次要备注」中 `ToolAudit.reason` 的说明；以下为可直接贴入 `README.md` 的「报告指标」小节**逐字终稿**。

---

## 报告指标

内核从三类口径报告任务与运行的证据指标：运行证据、工具审计、成本预算。字段与语义以源码和测试为准，见下方各节。

### 运行证据

每个 Run 持久化合并后的 `output`（stdout/stderr 合并，超限截断）与 `diff`（含未跟踪 patch，超限截断），均带 `outputTruncated` / `diffTruncated` 标志（上限 `RUN_OUTPUT_LIMIT` / `RUN_DIFF_LIMIT`），同时记录 exit code、耗时与 usage；分离的 stdout/stderr 经 SSE 实时输出、支持取消，但不单独持久化。证据落在 `packages/storage-core`（SQLite + JSON store）；单任务可用 `export <taskId> --summary` 导出。

汇总指标（`getMetrics()` 返回的 `KernelMetrics`）：

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

> 单 Run 的原始证据字段（output、diff、exit code、usage）在 `RunRecord` / `RunArtifacts`；`getMetrics()` 返回的是**汇总指标**（`KernelMetrics`），不直接暴露单 Run 的 output/diff。

### 工具审计

工具审计从 Run 的输出中抽取实际工具调用（`packages/agent-runtime/src/tool-audit.ts`）：

| 类型 | 字段 | 语义 |
|---|---|---|
| `ToolCallAudit` | `name` / `status` / `reason` | 单次工具调用；`status ∈ {ok, denied}`（类型联合含 `unknown`，但抽取器不产出），`reason` 可空 |
| `ToolAudit` | `calls[]` / `source` / `reason` | 一次 Run 的工具使用；`source ∈ {runtime, unknown}`，未识别时整次 Run 的 `source = 'unknown'` 且 `reason` 为固定说明文案 |
| 常量 | `TOOL_AUDIT_LIMIT = 100` | 去重键 `name\|status\|reason`，达到上限即停 |

识别规则：`tool_use` / `tool_call` / `function_call` / `mcp_tool_call` 记为 `ok`；`permission_denials` 记为 `denied`（名字取 `tool_name`/`name`，缺省为 `unknown-tool`）。Runtime 未报工具调用时不猜测，整次 Run 标记 `source = 'unknown'`。

### 成本预算

Role / Team 可设成本与 token 上限（`maxCostUsd` / `maxInputTokens` / `maxOutputTokens`），超限阻断 `createRun` 与 `executeRun`，并写入 `budget.blocked` 审计事件。`budgetStatus(taskId, roleId)` 返回 `role` / `team` 两个维度：

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

实测记录见 `handoff.md`。

---

## 已应用的修订（对照 03 缺口）

- **缺口 1（usage/spend null 语义）**：`usage` 行改为「无任何 run 上报时三项全为 `null`，否则未上报维度为 `0`」；`spend.*` 行明确为「逐字段：该字段无上报时为 `null`」，并注明与 `usage` 差异。
- **缺口 2（截断与合并）**：首句删去「完整」，改为「合并后的 `output` / `diff` 超限截断，均带 `*Truncated` 标志（`RUN_OUTPUT_LIMIT` / `RUN_DIFF_LIMIT`）」，并注明 stdout/stderr 仅作流式事件、不单独持久化。
- **缺口 3（status unknown）**：`ToolCallAudit.status` 改为 `∈ {ok, denied}`，并注明类型联合含 `unknown` 但抽取器不产出、未识别落在 `ToolAudit.source = 'unknown'`。
- **次要备注**：`ToolAudit.reason` 在 `source = 'unknown'` 时为固定说明文案，已并入工具审计表。

## 剩余缺口（本小节正文外，贴入 README 前处理）

`--summary` 未同步进 README「命令」节（缺口 4）；Team 预算证据映射缺 `teams.ts:28`（缺口 5）；SSE 实时投递仅为源码引用、无运行时验证（见 04 第 4 节）。
