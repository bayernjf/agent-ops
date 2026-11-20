# 01-plan.md — 文档化 Agent Ops 报告指标

本文件是「Dogfood 4：五角色团队运行」的第一步（CB Architect 产出）。后续角色据此在 `README.md` 中补充一节面向使用者的「报告指标」说明。

## 目标

在 `README.md` 新增「报告指标」小节，用一段可读文字 + 一张字段表，说明内核如何报告三类指标：

1. **运行证据（Run evidence）**
2. **工具审计（Tool audit）**
3. **成本预算（Budgets）**

只改文档，不改代码。所有表述必须能对上源码与测试，拿不到证据的（如 CodeBuddy 不上报 token）写为“取决于 Runtime 是否上报”，不写成已实现。

## 位置与结构

在 `README.md` 的「内核能力」表格之后、`## 目录` 之前，插入 `## 报告指标`，包含三个子小节（`### 运行证据`、`### 工具审计`、`### 成本预算`），末尾一句指向 `handoff.md` 中的实测记录。

## 每项要写的内容

### 运行证据

- Run 持久化 `stdout`/`stderr`、完整 diff（含未跟踪 patch）、exit code、耗时、usage。
- 通过 SSE 实时输出，支持取消。
- 证据来源：`packages/storage-core`（SQLite + JSON store），单任务可 `export --summary` 导出。
- 证据字段与语义以 `packages/storage-core/test/metrics.test.ts` 中 `getMetrics()` 的结构为准。

### 工具审计

- 语义来自 `packages/agent-runtime/src/tool-audit.ts`：
  - `ToolCallAudit`：`name` + `status`（`ok` / `denied` / `unknown`）+ `reason`（可空）。
  - `ToolAudit`：`calls[]` + `source`（`runtime` / `unknown`）+ `reason`（可空）。
  - 上限 `TOOL_AUDIT_LIMIT = 100`，去重按 `name|status|reason`。
- 明确写出：Runtime 不报工具调用时，`source` 为 `unknown`，而非猜测；被拒原因拿不到标 `unknown`。

### 成本预算

- Role / Team 可设 cost / token 上限（`maxCostUsd` / `maxInputTokens`）。
- `budgetStatus(taskId, roleId)` 返回 `role` / `team` 两个维度：`configured`、`exceeded`、`limits`、`spend`（`reportingRuns` / `totalRuns` / `costUsd` / `inputTokens`）、`reasons`。
- 超限阻断 `createRun` 与 `executeRun`，并写 `budget.blocked` 审计事件。
- 明确写出两条口径：预算为“任务内”口径、不跨任务累计；Runtime 未上报用量时**不阻断**（`spend.costUsd = null`、`reportingRuns = 0`）。

## 验收口径

- 文档新增段落与实际代码/测试一致：`tool-audit.ts`、`metrics.test.ts`、`budget.test.ts`。
- 「已知限制」小节已有两条（token/cost 与工具审计取决于 Runtime 上报；预算任务内口径）与本小节保持一致，不冲突、不重复承诺。
- 完成后由后续角色（reviewer / tester）交叉核对 README 表述与证据，禁止无证据写成“通过”。
