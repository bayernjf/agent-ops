# 02-implementation.md — 实施笔记：README「报告指标」小节

本文件是「Dogfood 4：五角色团队运行」的第二步（CB Implementer 产出）。输入为 `01-plan.md`（CB Architect）。本文档描述要写入 `README.md` 的具体段落内容，供后续角色（reviewer / tester）据此落盘或核对。

## 0. 变更范围

- 只改文档，不改代码。
- 只新增 `README.md` 的 `## 报告指标` 一节；不动其他段落。
- 所有字段名与语义均以源码/测试为准，证据来源见第 3 节。

## 1. 插入位置

在 `README.md` 中：

- **之前**：`## 内核能力` 表格的最后一行（第 27 行「重跑 hygiene」）。
- **之后**：`## 目录`（第 29 行）。

即：在「重跑 hygiene」行与 `## 目录` 之间插入新节，不改变现有任何章节标题顺序。

## 2. 要新增的 README 内容（草稿，供落盘/核对）

### 2.1 `## 报告指标` 引导段

一段可读文字，点明内核从三类口径报告指标：运行证据、工具审计、成本预算；并说明「字段以源码与测试为准」。

### 2.2 `### 运行证据`

正文要点（全部可对上 `packages/storage-core` 与 `apps/cli`）：

- Run 持久化 `stdout`/`stderr`、完整 diff（含未跟踪 patch）、exit code、耗时、usage；见 `RunRecord` / `RunArtifacts`（`packages/storage-core/src/index.ts`）。
- 通过 SSE 实时输出，支持取消。
- 证据来源：`packages/storage-core`（SQLite + JSON store）；单任务可用 `export <taskId> --summary` 导出（`apps/cli/src/index.ts:94-116`）。

汇总指标字段表（语义以 `getMetrics()` 返回的 `KernelMetrics` 为准，`packages/storage-core/src/index.ts:487`）：

| 分组 | 字段 | 语义 |
|---|---|---|
| `tasks` | `total` / `done` / `failed` / `cancelled` / `open` | 任务计数 |
| `runs` | `total` / `executed` / `succeeded` / `failed` / `cancelled` / `inFlight` | Run 计数 |
| `runs.successRate` | `succeeded / executed` | 无执行时为 `null` |
| `rework` | `retries` / `rejections` / `reworkRate` | `(retries + rejections) / executed`，启发式 |
| `usage` | `reportingRuns` / `inputTokens` / `outputTokens` / `costUsd` | 仅统计已上报用量的 run；无上报时为 `null` |
| `timing` | `totalDurationMs` / `averageDurationMs` | 总耗时 / 平均耗时 |
| `byRuntime` | `runtimeId` + 计数/耗时/`costUsd` | 按运行时分桶 |
| `byRole` | `roleId` + 计数/耗时 | 按角色分桶 |

> 注意（对 01-plan 的澄清）：`getMetrics()` 返回的是**汇总指标**（`KernelMetrics`），不是单条 Run 的原始证据字段。单条 Run 的证据字段在 `RunRecord` / `RunArtifacts`。README 措辞须把「单 Run 证据」与「汇总指标」分开表述，避免读者误以为 `getMetrics()` 直接暴露 stdout/diff。

### 2.3 `### 工具审计`

正文要点（可对上 `packages/agent-runtime/src/tool-audit.ts`）：

- `ToolCallAudit`：`name` + `status`（`ok` / `denied` / `unknown`）+ `reason`（可空）。
- `ToolAudit`：`calls[]` + `source`（`runtime` / `unknown`）+ `reason`（可空）。
- 上限 `TOOL_AUDIT_LIMIT = 100`，去重键为 `name|status|reason`。
- 明确写出：Runtime 不报工具调用时 `source = 'unknown'`（不猜测）；被拒原因拿不到时标 `unknown`。

字段表：

| 类型 | 字段 | 语义 |
|---|---|---|
| `ToolCallAudit` | `name` / `status` / `reason` | 单次工具调用（或被拒）；`status ∈ {ok, denied, unknown}`，`reason` 可空 |
| `ToolAudit` | `calls[]` / `source` / `reason` | 一次 Run 的工具使用；`source ∈ {runtime, unknown}`，`reason` 可空 |
| 常量 | `TOOL_AUDIT_LIMIT = 100` | 去重键 `name|status|reason`，达到上限即停 |

### 2.4 `### 成本预算`

正文要点（可对上 `packages/storage-core/test/budget.test.ts` 与 `packages/storage-core/src/index.ts:1895` 的 `budgetStatus`）：

- Role / Team 可设 cost / token 上限（`maxCostUsd` / `maxInputTokens`）。
- `budgetStatus(taskId, roleId)` 返回 `TaskBudgetStatus { taskId, role, team }`，其中 `role` / `team` 各为 `BudgetStatus`：

| 字段 | 语义 |
|---|---|
| `scope` / `scopeId` | `role` 或 `team` |
| `configured` | 是否配置了上限 |
| `exceeded` | 是否已超限 |
| `reasons` | 超限原因列表（字符串数组） |
| `limits` | `maxCostUsd` / `maxInputTokens`（预算配置） |
| `spend.costUsd` / `spend.inputTokens` / `spend.outputTokens` | 已上报用量；无上报时为 `null` |
| `spend.reportingRuns` | 至少上报一个用量字段的 run 数 |
| `spend.totalRuns` | 全部 run 数 |

> 注意（对 01-plan 的澄清）：`BudgetStatus.spend` 实际含 `outputTokens`（`index.ts:473`），01-plan 只列了 cost/input 四项，README 字段表按源码补上 `outputTokens`，保持与类型一致。

- 超限阻断 `createRun` 与 `executeRun`，并写 `budget.blocked` 审计事件。
- 明确写出两条口径：
  1. 预算为**任务内**口径，不跨任务累计；只在启动前阻断。
  2. Runtime 未上报用量时**不阻断**：`spend.costUsd = null`、`reportingRuns = 0`、`exceeded = false`。

### 2.5 结尾一句

节末一句指向 `handoff.md` 的实测记录（本次 dogfood 的完成记录与提交号），不重复罗列证据。

## 3. 证据来源映射（供 reviewer / tester 核对）

| 段落 | 声称 | 证据 |
|---|---|---|
| 运行证据 | stdout/stderr、diff、exit code、耗时、usage、SSE、取消 | `packages/storage-core/src/index.ts`（`RunRecord` / `RunArtifacts` / `RunEvent`） |
| 运行证据 | 汇总指标字段 | `packages/storage-core/test/metrics.test.ts` 的 `getMetrics()` + `KernelMetrics`（`index.ts:487`） |
| 运行证据 | `export --summary` | `apps/cli/src/index.ts:94-116`（`--summary` flag 存在） |
| 工具审计 | 字段/常量 | `packages/agent-runtime/src/tool-audit.ts` |
| 成本预算 | 字段/阻断/口径 | `packages/storage-core/src/index.ts:463`（`BudgetStatus`）+ `:1895`（`budgetStatus`）+ `:1946`（阻断）+ `test/budget.test.ts` |

## 4. 与「已知限制」的一致性

`README.md` 现有「已知限制」（第 78-83 行）已包含两条：

- token/cost 与工具审计取决于 Runtime 是否上报（第 80 行）；
- 预算为任务内口径、不跨任务累计、只在启动前阻断（第 82 行）。

新增小节必须与这两条一致、不冲突、不重复承诺：

- 「运行证据」的 usage / 「工具审计」的 `unknown` / 「成本预算」的「未上报不阻断」都应指向「取决于 Runtime 是否上报」这一条，不写成已保证上报。
- 「成本预算」不写「跨任务累计」。

## 5. 落盘后自检清单（交接给后续角色）

1. `## 报告指标` 只出现在「内核能力」表与 `## 目录` 之间。
2. 三个子小节标题为 `### 运行证据` / `### 工具审计` / `### 成本预算`。
3. 字段表字段名与第 3 节的源码类型逐字一致（含 `outputTokens`）。
4. 无证据的表述（CodeBuddy 不上报 token）写为「取决于 Runtime 是否上报」，未写成已实现。
5. 与「已知限制」两条口径不冲突。
6. `npm run typecheck && npm test` 不受影响（纯文档改动，无需跑；若要跑，结果应仍全绿）。

## 6. 遗留风险

- `01-plan.md` 将 `getMetrics()` 的汇总指标结构挂在「运行证据」下的表述略有混用；本笔记已在 2.2 用「单 Run 证据 vs 汇总指标」澄清，落盘时需按此分开措辞。
- 本步骤只产出本文件，未实际写入 `README.md`；真实落盘由后续角色执行并交叉核对，禁止无证据写成「通过」。
