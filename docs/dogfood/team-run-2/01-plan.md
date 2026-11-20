# 01-plan.md — 五角色交付：README「报告指标」小节

本文件是「Dogfood 6：owned 五角色交付」的第一步（CB Architect 产出）。后续角色据此完成一次五角色文档运行，最终由 owner 产出 `05-final.md`，其中含一段可直接贴入 `README.md` 的「报告指标」小节。

## 目标

在 `docs/dogfood/team-run-2/` 内完成五角色文档运行（plan → implement → review → test-report → final），最终产物 `05-final.md` 给出 README-ready 的「报告指标」小节，覆盖三类指标：

1. **运行证据（Run evidence）**
2. **工具审计（Tool audit）**
3. **成本预算（Budgets）**

只改文档、不改代码。所有表述必须能对上源码与测试；拿不到证据的（如 Runtime 不上报 token）写为“取决于 Runtime 是否上报”，不写成已实现。

## 五角色与产出物

| 步 | 角色 | 产出 |
|---|---|---|
| 1 | CB Architect | `01-plan.md`（本计划） |
| 2 | Implementer | `02-implementation.md`（「报告指标」小节草稿） |
| 3 | Reviewer | `03-review.md`（对照源码/测试的核对意见） |
| 4 | Tester | `04-test-report.md`（表述—证据交叉核对记录） |
| 5 | Owner | `05-final.md`（README-ready 终稿） |

## 「报告指标」小节结构

建议三段（各含一句可读文字 + 一张字段表），末尾一句指向 `handoff.md` 的实测记录：

### 运行证据

- Run 持久化 `stdout`/`stderr`、完整 diff（含未跟踪 patch）、exit code、耗时、usage；SSE 实时输出、可取消。
- 证据来源：`packages/storage-core`（SQLite + JSON store），单任务可 `export --summary` 导出。
- 字段与语义以 `packages/storage-core/test/metrics.test.ts` 中 `getMetrics()` 结构为准。

### 工具审计

- 语义来自 `packages/agent-runtime/src/tool-audit.ts`：
  - `ToolCallAudit`：`name` + `status`（`ok` / `denied` / `unknown`）+ `reason`（可空）。
  - `ToolAudit`：`calls[]` + `source`（`runtime` / `unknown`）+ `reason`（可空）。
  - 上限 `TOOL_AUDIT_LIMIT = 100`，去重按 `name|status|reason`。
- 明确写出：Runtime 不报工具调用时 `source = unknown`，被拒原因拿不到标 `unknown`，不猜测。

### 成本预算

- Role / Team 可设 cost / token 上限（`maxCostUsd` / `maxInputTokens`）。
- `budgetStatus(taskId, roleId)` 返回 `role` / `team` 两维度：`configured`、`exceeded`、`limits`、`spend`（`reportingRuns` / `totalRuns` / `costUsd` / `inputTokens`）、`reasons`。
- 超限阻断 `createRun` 与 `executeRun`，并写 `budget.blocked` 审计事件。
- 两条口径：预算为“任务内”口径、不跨任务累计；Runtime 未上报用量时**不阻断**（`spend.costUsd = null`、`reportingRuns = 0`）。

## 验收口径

- 终稿 `05-final.md` 的「报告指标」小节与代码/测试一致，核对点：`packages/agent-runtime/src/tool-audit.ts`、`packages/storage-core/test/metrics.test.ts`、`packages/storage-core/test/budget.test.ts`。
- 与 `README.md`「已知限制」已有两条（token/cost 与工具审计取决于 Runtime 上报；预算任务内口径）保持一致，不冲突、不重复承诺。
- 五步产物齐全，最终由 owner 落盘 `05-final.md`；禁止无证据写成“通过”。
