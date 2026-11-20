# 03-review.md — 核对意见（CB Reviewer）

输入：`01-plan.md`（Architect）、`02-implementation.md`（Implementer）。
核对范围：`02-implementation.md` 第 2 节 README 终稿与第 3 节证据映射，逐条对照源码与测试。

结论：终稿整体与源码一致，三段的字段名、类型名、行号引用基本准确；未发现「写成已实现、实际未实现」的硬伤。以下为事实性缺口（含措辞误导与证据映射缺口），owner 落盘前需修订或确认，否则不得称「与源码逐字一致」。

---

## 缺口 1：`usage` 与 `spend` 的 null 语义不同，但终稿用同一句话「无上报时为 null」描述

- 位置：`02-implementation.md` 第 2 节「运行证据」表（`usage` 行）与「成本预算」表（`spend.*` 行）。
- 声称：两处都写「无上报时为 `null`」。
- 源码事实：
  - 指标 `usage`（`packages/storage-core/src/index.ts:1812-1818`、`:1887-1893`）：一个 run 只要三个用量字段（input/output/cost）**任一**非 null 即计入 `reportingRuns`；随后各维累加 `run.x ?? 0`。因此一旦 `reportingRuns > 0`，未上报的那一维变成 `0`，**不是 `null`**；只有 `reportingRuns === 0` 时三项才全为 `null`。
  - 预算 `spend`（`packages/storage-core/src/index.ts:1925-1935` 的 `sumReported`）：是**逐字段**判断——某个字段没有任何 run 上报时该字段为 `null`，与其它字段无关。
- 影响：两段语义不对称，但终稿用同一措辞。若照贴入 README，读者会把「某维未上报」与「整段无上报」混为一谈。
- 建议：`usage` 行改为「仅统计至少上报一个用量字段的 run；无任何 run 上报用量时三项全为 `null`，否则未上报维度为 `0`」；`spend` 行保持「逐字段：该字段无上报时为 `null`」，并明确与 `usage` 的差异。

## 缺口 2：「完整 diff」与「持久化 stdout/stderr」措辞掩盖了截断与合并

- 位置：`02-implementation.md` 第 2 节「运行证据」首句。
- 声称：「持久化 `stdout`/`stderr`、完整 diff（含未跟踪 patch）」。
- 源码事实：
  - `RunArtifacts` 持久化的是**合并后的单个 `output`**（非分离的 stdout/stderr），并带 `outputTruncated` 标志，上限 `RUN_OUTPUT_LIMIT = 64_000`（`index.ts:224-244`、`:258-261`）。
  - `diff` 同样带 `diffTruncated`，上限 `RUN_DIFF_LIMIT = 256_000`（`index.ts:229-230`、`:259`）。
  - 分离的 `stdout`/`stderr` 只作为流式 `RunEvent` 存在（`index.ts:246-256`），不单独持久化。
- 影响：「完整 diff」与「stdout/stderr」均不准确——都会截断、且 output 是合并字段。此措辞沿袭自 `README.md:18` 的旧表述，但 README-ready 小节本可更精确。
- 建议：改为「持久化合并的 `output`（stdout/stderr，超限截断）与 `diff`（含未跟踪 patch，超限截断），均带 `*Truncated` 标志」；或至少删去「完整」。

## 缺口 3：README 终稿列出 `status ∈ {ok, denied, unknown}`，但抽取器从不产出 `unknown`

- 位置：`02-implementation.md` 第 2 节「工具审计」表（`ToolCallAudit` 行）；第 4 节澄清 2 已承认此点，但第 4 节不会贴入 README。
- 声称：`status ∈ {ok, denied, unknown}`。
- 源码事实：`ToolCallAudit.status` 的类型联合含 `'unknown'`（`tool-audit.ts:4`），但 `extractToolAudit` 只 push `'ok'` 与 `'denied'`（`tool-audit.ts:53`、`:66`），从不产出 `unknown`。「未识别」的信号落在 `ToolAudit.source = 'unknown'`（`tool-audit.ts:95-96`），而非 `ToolCallAudit.status`。
- 影响：照贴入 README 的句子会让人误以为单次调用可能出现 `status: 'unknown'`；终稿自身分析（第 4 节）与正文（第 2 节）不一致。
- 建议：终稿改为「`status ∈ {ok, denied}`（类型联合含 `unknown`，但抽取器不产出；未识别时整次 Run 的 `ToolAudit.source = 'unknown'`）」。

## 缺口 4：`export <taskId> --summary` 与 README「命令」节不一致

- 位置：`02-implementation.md` 第 2 节「运行证据」与第 3 节证据映射（`apps/cli/src/index.ts:97,113,116`）。
- 声称：单任务可用 `export <taskId> --summary` 导出。
- 源码事实：CLI 确实支持 `--summary`（`apps/cli/src/index.ts:97` usage 串、`:113` `includes('--summary')`、`:116` 分支）。但 `README.md:67` 的「命令」节只写了 `export <taskId> [--out file]`，未提及 `--summary`。
- 影响：owner 贴入新节后，README 会在「报告指标」出现 `--summary`，而「命令」节仍无此 flag，两处不一致。
- 建议：owner 落盘时同步在 `README.md`「命令」节补上 `[--summary]`，或在 review 中明确此项为已知待办。

## 缺口 5：Team 预算的证据映射只引了 roles.ts，未引 teams.ts

- 位置：`02-implementation.md` 第 3 节「成本预算 | `CostBudget` 上限字段」行（仅 `roles.ts:20-24`）。
- 声称：第 2 节写「Role / Team 可设成本与 token 上限」，但证据只给了 Role 侧的 `CostBudget`。
- 源码事实：`Team` 同样有 `budget?: CostBudget`（`packages/agent-runtime/src/teams.ts:28`），类型从 `roles.ts:2` 导入；`budgetStatus` 对 team 维度用 `task.teamId` 取 team 预算（`index.ts:1915-1919`）。
- 影响：`CostBudget` 类型引用本身没错（定义在 roles.ts），但 Team 侧的字段出处未给，证据链不完整。
- 建议：证据映射补 `packages/agent-runtime/src/teams.ts:28` 与 `index.ts:1915-1919`。

---

## 次要备注（不阻塞，供 owner 判断）

- `ToolAudit.reason` 在 `source='unknown'` 时是固定文案 `'The runtime output did not report tool calls.'`，`source='runtime'` 时为 `null`（`tool-audit.ts:95-96`）。终稿写「`reason` 可空」在类型上成立，但与实际取值略不一致，可注明「unknown 时带说明文案」。
- `KernelMetrics` 顶层还有 `generatedAt` / `window` / `teamId` 三个字段，且 `getMetrics({ since, until, teamId })` 支持过滤（`index.ts:495-499`、`:1765`）。终稿字段表未列，属简化而非错误；若 README 想完整，可补一行「按时间窗 / team 过滤」。

## 核对通过项（未发现缺口，供 tester 复用）

- 工具审计字段与常量：`ToolCallAudit`/`ToolAudit`/`TOOL_AUDIT_LIMIT = 100`、去重键 `name|status|reason`、`ok` 识别集 `{tool_use, tool_call, function_call, mcp_tool_call}`、`denied` 缺省 `unknown-tool` —— 均与 `tool-audit.ts:1-96` 一致。
- 成本预算：`maxCostUsd`/`maxInputTokens`/`maxOutputTokens`（`roles.ts:20-24`）、`BudgetStatus`/`TaskBudgetStatus` 结构（`index.ts:471-492`）、`budgetStatus` 返回 role/team 两维（`index.ts:1904-1922`）、超限 `>=` 判定并写 `budget.blocked`（`index.ts:1943-1973`）、`createRun`/`executeRun` 均在启动前 `assertBudget`（`index.ts:967`、`:1225`）。
- 未上报不阻断：`budget.test.ts:101-123` 断言 `spend.costUsd = null`、`reportingRuns = 0`、`exceeded = false`，与终稿一致。
- 指标字段名与 `metrics.test.ts:31-146`、`KernelMetrics`（`index.ts:495-545`）逐字一致（含 `successRate` 无执行时为 `null`、`reworkRate` 启发式）。
