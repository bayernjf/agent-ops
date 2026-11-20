# 03-review.md — CB Reviewer 复核

本文件是「Dogfood 4：五角色团队运行」的第三步（CB Reviewer 产出）。输入为 `01-plan.md`（CB Architect）与 `02-implementation.md`（CB Implementer）。本复核不落盘 `README.md`，只记录风险与缺口，供后续角色（tester / 落盘者）修正后执行。

## 结论

计划与实施笔记整体可执行、证据链完整，绝大多数字段名/行号都能对上工作区内的源码与测试。**但存在一处事实性缺口（预算上限漏列 `maxOutputTokens`）**，必须在写入 `README.md` 前修正；另有若干精度与流程问题需一并处理。

结论：**有条件通过 —— 修正 Finding 1 后即可落盘。**

## 已核对（证据充分，无需改动）

| 声称 | 证据 | 结果 |
|---|---|---|
| `ToolCallAudit` = `name`+`status`(`ok/denied/unknown`)+`reason`；`ToolAudit` = `calls[]`+`source`(`runtime/unknown`)+`reason` | `packages/agent-runtime/src/tool-audit.ts:2-13` | 一致 |
| `TOOL_AUDIT_LIMIT = 100`，去重键 `name\|status\|reason`，达到上限即停 | `tool-audit.ts:15,30-34` | 一致 |
| `getMetrics()` 汇总指标字段（`tasks`/`runs`/`rework`/`usage`/`timing`/`byRuntime`/`byRole`） | `packages/storage-core/src/index.ts:487-537`（`KernelMetrics`） | 02 §2.2 字段表逐项一致 |
| `BudgetStatus` = `scope`/`scopeId`/`configured`/`exceeded`/`reasons`/`limits`/`spend`，`spend` 含 `costUsd`/`inputTokens`/`outputTokens`/`reportingRuns`/`totalRuns` | `index.ts:463-478` | 一致（02 已补 `outputTokens`，正确） |
| `budgetStatus(taskId, roleId)` 返回 `{taskId, role, team}` | `index.ts:1895-1913` | 一致 |
| 超限阻断 `createRun` 与 `executeRun`，写 `budget.blocked` 审计事件 | `index.ts:958,1216,1947-1964` | 一致 |
| `export <taskId> --summary` 存在 | `apps/cli/src/index.ts:94-116` | 一致 |
| README 行号：`重跑 hygiene`=27、`## 目录`=29、`已知限制`=78-83（两条款在 80、82） | 工作区 `README.md` | 一致 |
| 测试文件 `metrics.test.ts`、`budget.test.ts` 存在且覆盖 `getMetrics`/`budgetStatus` | `packages/storage-core/test/` | 一致 |

## 发现（缺口 / 风险）

### Finding 1（高 · 事实性缺口）预算上限漏列 `maxOutputTokens`

`01-plan.md` §成本预算 与 `02-implementation.md` §2.4 都把上限写作 `maxCostUsd / maxInputTokens` 两项，但源码 `CostBudget` 实际是三个可选字段：

```
packages/agent-runtime/src/roles.ts:20-24
export type CostBudget = {
  maxCostUsd?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;   // ← 两份文档均遗漏
};
```

且 `budgetFor` 会针对 `maxOutputTokens` 生成超限原因（`index.ts:1940-1941`），即 output token 超限同样会置 `exceeded=true` 并触发阻断。若 README 照两份文档落盘，会把预算能力少报一个维度。

**要求**：README 与 `02` §2.4 的 `limits` 字段表改为 `maxCostUsd / maxInputTokens / maxOutputTokens`（三者均可选）。

### Finding 2（中 · 字段表不完整）`byRuntime` / `byRole` 表过粗

`02` §2.2 把 `byRuntime` 概括为「runtimeId + 计数/耗时/costUsd」、`byRole` 为「roleId + 计数/耗时」。实际 `KernelMetrics`（`index.ts:520-536`）里两个分桶各含 `runs`/`succeeded`/`failed`/`cancelled`/`durationMs`，且 `byRuntime` 多一个 `costUsd`、`byRole` 没有 `costUsd`。既然 README 声称「语义以 `getMetrics()` 为准」，分桶字段应逐项列出，并点明 `byRole` 无 `costUsd`，否则表与类型不一致。

**要求**：README 的 `byRuntime`/`byRole` 行补全分桶字段，并标注 `byRole` 不含 `costUsd`。

### Finding 3（中 · 措辞需沿用澄清，勿照抄 01）`getMetrics()` 混入「运行证据」

`01-plan.md` §运行证据 写「证据字段与语义以 `getMetrics()` 的结构为准」，这是错的：`getMetrics()` 返回聚合的 `KernelMetrics`，不暴露单条 Run 的 stdout/diff 原始证据。`02` §2.2 注释与 §6 已正确澄清（单 Run 证据在 `RunRecord`/`RunArtifacts`）。**风险**：落盘者若直接复制 `01` 措辞会写错。必须沿用 `02` 的「单 Run 证据 vs 汇总指标」二分表述。

### Finding 4（低 · 措辞精度）「stdout/stderr」与持久化字段不完全一致

`RunArtifacts` 持久化的是合并后的单一 `output` 字段（`index.ts:221-222`），stdout/stderr 作为独立流只出现在 `RunEvent`（SSE）里（`index.ts:242-252`）。两份文档都沿用 README 现有的「stdout/stderr」写法（README 第 18 行本就是这个说法），故不算冲突，但若要严格对上 `RunArtifacts`，README 可写为「output（stdout/stderr 合并）」以消除歧义。

### Finding 5（流程缺口）谁真正落盘 README 未指派

`02` §6 明确「未实际写入 README.md，真实落盘由后续角色执行」，但 `01`/`02` 都没指定五步里哪一步负责编辑 `README.md`。reviewer 之后剩余角色（tester 及最后一步）需有明确落盘 owner，否则文档运行停在「笔记」阶段、验收无对象。**要求**：tester 交接前确认落盘步骤归属。

### Finding 6（低 · 维护风险）绝对行号会漂移

`01`/`02` 的证据映射依赖绝对行号（README 27/29/78-83；`index.ts:487/:463/:473/:1895/:1946`；`cli:94-116`）。本复核时全部准确，但任何前序编辑都会让行号失效。落盘时插入定位应以「`## 目录` 之前」这类标题锚点为主、行号为辅（`02` §1 已这么做，证据映射部分仍建议降级为标题/符号引用）。

### Finding 7（信息）去重键细节，可不写进 README

`tool-audit.ts:30` 的去重键实为 `${name}|${status}|${reason ?? ''}`，即 `reason:null` 与 `reason:''` 归一为同键；另有 `depth > 6` 截断（`tool-audit.ts:37`）。这些是实现细节，README 不必展开，但若 tester 声称「去重键为 name|status|reason」需知道 null/空串归一这一层。

## 给后续角色（tester / 落盘者）的交接清单

1. 落盘前先修 Finding 1（补 `maxOutputTokens`），否则 README 与源码不一致。
2. README 字段表补全 Finding 2 的 `byRuntime`/`byRole` 分桶字段。
3. 运行证据措辞采用 `02` 的二分表述（Finding 3），不照抄 `01` 的 `getMetrics()` 说法。
4. 确认落盘 owner 与最后一步的验收动作（Finding 5）。
5. 验收时以源码类型与测试为准，禁止无证据写成「通过」（沿用 `01` §验收口径）。
