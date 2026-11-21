# 02-implementation.md — 实施笔记：README「报告指标」小节

本文件是「Dogfood 6：owned 五角色交付」的第二步（CB Implementer 产出）。输入为 `01-plan.md`（CB Architect）。本文档给出可直接贴入 `README.md` 的「报告指标」小节终稿文本，并附上证据来源映射，供后续角色（reviewer / tester / owner）核对与落盘。

## 0. 变更范围

- 只改文档，不改代码。
- 只新增 `README.md` 的 `## 报告指标` 一节；不动其他段落。
- 所有字段名与语义均以源码/测试为准；拿不到证据的（Runtime 不上报 token / 工具调用）写为“取决于 Runtime 是否上报”，不写成已实现。

## 1. 插入位置

在 `README.md` 中：

- **之前**：`## 内核能力` 表格的最后一行（`重跑 hygiene`，第 27 行）。
- **之后**：`## 目录`（第 29 行）。

即：在「重跑 hygiene」行与 `## 目录` 之间插入新节，不改变任何现有章节标题顺序。

## 2. README-ready 终稿（可直接贴入）

> 以下为「报告指标」小节的**逐字终稿**。owner 落盘 `05-final.md` 时应以本块为准，不得改动措辞后仍称“与源码一致”。

````markdown
## 报告指标

内核从三类口径报告任务与运行的证据指标：运行证据、工具审计、成本预算。字段与语义以源码和测试为准，见下方各节。

### 运行证据

每个 Run 持久化 `stdout`/`stderr`、完整 diff（含未跟踪 patch）、exit code、耗时与 usage，并通过 SSE 实时输出、支持取消。证据落在 `packages/storage-core`（SQLite + JSON store）；单任务可用 `export <taskId> --summary` 导出。

汇总指标（`getMetrics()` 返回的 `KernelMetrics`）：

| 分组 | 字段 | 语义 |
|---|---|---|
| `tasks` | `total` / `done` / `failed` / `cancelled` / `open` | 任务计数 |
| `runs` | `total` / `executed` / `succeeded` / `failed` / `cancelled` / `inFlight` | Run 计数 |
| `runs.successRate` | `succeeded / executed` | 无执行时为 `null` |
| `rework` | `retries` / `rejections` / `reworkRate` | `(retries + rejections) / executed`，启发式 |
| `usage` | `reportingRuns` / `inputTokens` / `outputTokens` / `costUsd` | 仅统计已上报用量的 run；无上报时为 `null` |
| `timing` | `totalDurationMs` / `averageDurationMs` | 总耗时 / 平均耗时 |
| `byRuntime` | `runtimeId` + 计数 / 耗时 / `costUsd` | 按运行时分桶 |
| `byRole` | `roleId` + 计数 / 耗时 | 按角色分桶 |

> 单 Run 的原始证据字段（stdout/stderr、diff、exit code、usage）在 `RunRecord` / `RunArtifacts`；`getMetrics()` 返回的是**汇总指标**（`KernelMetrics`），不直接暴露单 Run 的 stdout/diff。

### 工具审计

工具审计从 Run 的输出中抽取实际工具调用（`packages/agent-runtime/src/tool-audit.ts`）：

| 类型 | 字段 | 语义 |
|---|---|---|
| `ToolCallAudit` | `name` / `status` / `reason` | 单次工具调用；`status ∈ {ok, denied, unknown}`，`reason` 可空 |
| `ToolAudit` | `calls[]` / `source` / `reason` | 一次 Run 的工具使用；`source ∈ {runtime, unknown}`，`reason` 可空 |
| 常量 | `TOOL_AUDIT_LIMIT = 100` | 去重键 `name|status|reason`，达到上限即停 |

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
| `spend.costUsd` / `spend.inputTokens` / `spend.outputTokens` | 已上报用量；无上报时为 `null` |
| `spend.reportingRuns` | 至少上报一个用量字段的 run 数 |
| `spend.totalRuns` | 全部 run 数 |

两条口径：预算为**任务内**口径，不跨任务累计，只在启动前阻断；Runtime 未上报用量时**不阻断**（`spend.costUsd = null`、`reportingRuns = 0`、`exceeded = false`）。

实测记录见 `handoff.md`。
````

## 3. 证据来源映射（供 reviewer / tester / owner 核对）

| 段落 | 声称 | 证据 |
|---|---|---|
| 运行证据 | stdout/stderr、diff、exit code、耗时、usage、SSE、取消 | `packages/storage-core/src/index.ts`（`RunRecord` / `RunArtifacts` / `RunEvent`） |
| 运行证据 | 汇总指标字段 | `KernelMetrics`（`index.ts:495`）+ `packages/storage-core/test/metrics.test.ts` |
| 运行证据 | `export <taskId> --summary` | `apps/cli/src/index.ts:97,113,116`（`--summary` flag 存在） |
| 工具审计 | `ToolCallAudit` / `ToolAudit` / `TOOL_AUDIT_LIMIT` | `packages/agent-runtime/src/tool-audit.ts:1-15` |
| 工具审计 | `ok` / `denied` 识别规则、`unknown-tool` 缺省 | `packages/agent-runtime/src/tool-audit.ts:17-96` |
| 成本预算 | `CostBudget` 上限字段 | `packages/agent-runtime/src/roles.ts:20-24`（`maxCostUsd?` / `maxInputTokens?` / `maxOutputTokens?`） |
| 成本预算 | `BudgetStatus` / `TaskBudgetStatus` 结构 | `packages/storage-core/src/index.ts:471-492` |
| 成本预算 | `budgetStatus` 返回 role/team 两维度 | `packages/storage-core/src/index.ts:1904-1922` |
| 成本预算 | 超限阻断 createRun / executeRun + `budget.blocked` | `packages/storage-core/src/index.ts:967`（`create-run`）、`:1225`（`execute-run`）、`:1956-1973`（`assertBudget`）+ `test/budget.test.ts` |
| 成本预算 | 未上报不阻断 | `packages/storage-core/test/budget.test.ts:101-123`（`never blocks on usage the runtime did not report`） |

## 4. 对 01-plan 的两处澄清（已落入第 2 节终稿）

1. **`CostBudget` 还含 `maxOutputTokens`**：01-plan 只列了 `maxCostUsd` / `maxInputTokens`，但 `roles.ts:20` 还有可选的 `maxOutputTokens`，且 `budgetFor` 会对 `maxOutputTokens` 做超限判断（`index.ts:1949`）。终稿字段表与 `limits` 说明已按源码补上 `maxOutputTokens`。

2. **工具审计的“unknown”落在 `source`，而非 `status`**：01-plan 写“被拒原因拿不到标 `unknown`”，但源码里 `status: 'unknown'` 只在类型联合中存在，抽取器实际不产出该值——denied 缺名字时缺省 `unknown-tool`、缺原因时为 `null`；整次 Run 未报任何工具调用时是 `ToolAudit.source = 'unknown'`。终稿已改为准确表述，未沿用“被拒原因标 unknown”的说法。

## 5. 与「已知限制」的一致性

`README.md` 现有「已知限制」（第 78-83 行）含两条：

- token/cost 与工具审计取决于 Runtime 是否上报，CodeBuddy 当前不报（第 80 行）；
- 预算为任务内口径、不跨任务累计、只在启动前阻断（第 82 行）。

新增小节与这两条保持一致、不冲突、不重复承诺：

- 「运行证据」的 usage、「工具审计」的 `source = 'unknown'`、「成本预算」的「未上报不阻断」都指向「取决于 Runtime 是否上报」，未写成已保证上报。
- 「成本预算」不写「跨任务累计」。

## 6. 落盘后自检清单（交接给后续角色）

1. `## 报告指标` 只出现在「内核能力」表与 `## 目录` 之间。
2. 三个子小节标题为 `### 运行证据` / `### 工具审计` / `### 成本预算`，且与第 2 节终稿逐字一致。
3. 字段表字段名与第 3 节源码类型逐字一致（含 `outputTokens`、`maxOutputTokens`）。
4. 无证据的表述写为「取决于 Runtime 是否上报」，未写成已实现。
5. 与「已知限制」两条口径不冲突。
6. `npm run typecheck && npm test` 不受影响（纯文档改动）。

## 7. 遗留风险

- 本步骤只产出本文件，未实际写入 `README.md`；真实落盘由后续角色（owner）在 `05-final.md` 完成并交叉核对，禁止无证据写成“通过”。
- 本步骤未运行测试套件（纯文档改动、非必须）；若要验证，`npm test` 应仍全绿，但不在本步职责内执行。
- `budgetStatus` 对不存在的任务返回 `null`、对无 team 的任务 `team` 为 `null`、对未传 roleId 的调用 `role` 为 `null`（`index.ts:1904-1922`）。README 未展开这些边界，避免篇幅冗长；reviewer 若认为需要可补一句，但不得偏离源码语义。
