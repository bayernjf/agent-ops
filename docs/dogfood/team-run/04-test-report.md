# 04-test-report.md — CB Tester 验证报告

本文件是「Dogfood 4：五角色团队运行」的第四步（CB Tester 产出）。输入为 `01-plan.md`（CB Architect）、`02-implementation.md`（CB Implementer）、`03-review.md`（CB Reviewer）。本报告说明**如何验证** README「报告指标」一节所声称的三类指标，并给出本步骤已执行的验证证据。

## 0. 结论（先给结论，再给方法）

- 本步骤只产出本文件，未落盘 `README.md`（落盘 owner 尚未指派，见 `03-review.md` Finding 5）。
- 三类指标（运行证据 / 工具审计 / 成本预算）的**字段语义与阻断行为**已通过对源码类型 + 自动化测试双向核对，证据充分。
- 自动化测试已实际运行：`metrics.test.ts`（4 用例）+ `budget.test.ts`（3 用例）共 **7/7 通过**（vitest 4.1.12，运行时间 1.82s）。
- 验收判定：**指标的「语义」验证通过；但 README 落盘尚缺，故「README 与源码一致性」这一验收项仍未满足，不可整体判「通过」。** 落盘后须按第 4 节清单复跑一次。

## 1. 验证对象与范围

验证的是 README「报告指标」一节将写出的三类指标，来源为 `02-implementation.md` §2：

1. **运行证据**：Run 的 `output`/`diff`/`exitCode`/耗时/usage，SSE 实时输出，`export --summary` 导出，以及 `getMetrics()` 汇总指标。
2. **工具审计**：`ToolCallAudit` / `ToolAudit` / `TOOL_AUDIT_LIMIT` 的字段与语义。
3. **成本预算**：`CostBudget` 上限字段、`budgetStatus` 返回结构、超限阻断与 `budget.blocked` 审计事件。

## 2. 验证方法（两层）

验证一律不依赖真实模型 / 外部服务 / 生产数据，执行路径使用注入 runner（符合仓库 AGENTS.md 事实与验收约束）。

**层 A —— 自动化测试作为可执行 oracle**：直接运行 `packages/storage-core/test/` 下两个测试文件，用断言验证指标行为。

```sh
# 仓库根目录
npx vitest run packages/storage-core/test/metrics.test.ts packages/storage-core/test/budget.test.ts
# 或全量
npm test
```

**层 B —— 源码类型交叉核对**：逐字段比对 README 声称与源码类型定义，重点是字段名、可空性（`null` vs 缺省）、枚举取值，以及「是否阻断」。

判据：层 A 断言通过 + 层 B 字段逐字一致，两者同时成立才算「已验证」。

## 3. 逐项验证清单

### 3.1 运行证据

| 声称 | 验证步骤 | 预期结果 | 证据 |
|---|---|---|---|
| Run 持久化合并后的 `output`（stdout/stderr 合并）、完整 diff（含未跟踪 patch）、`exitCode`、`cancelled`、`durationMs`、`toolCalls`/`toolAudit` | 读 `RunArtifacts` 类型定义 | 字段名与 `02` §2.2 一致；注意 `output` 是合并后的单一字段，stdout/stderr 作为独立流只出现在 `RunEvent` | `packages/storage-core/src/index.ts:220-240`（`RunArtifacts`）、`:244-252`（`RunEvent`） |
| usage 字段 `inputTokens`/`outputTokens`/`costUsd` 可空，`null` 表示「未上报」而非 0 | 读 `RunRecord` 类型注释 | 三字段均 `number \| null`，注释明确「null means not reported」 | `packages/storage-core/src/index.ts:286-314` |
| `getMetrics()` 返回**汇总**指标 `KernelMetrics`，不暴露单 Run 原始证据 | 读 `KernelMetrics` 类型 + 空库用例 | 空库返回 0 计数、`successRate`/`reworkRate`/`averageDurationMs`/usage 各维度为 `null` | `metrics.test.ts:32-48`「reports zeros and null rates」；`index.ts:487-537` |
| 汇总成功/返工/耗时聚合正确 | 运行 `metrics.test.ts` 第 2 用例 | `tasks`/`runs`/`rework`/`timing`/`byRuntime`/`byRole` 断言通过 | `metrics.test.ts:50-108`「aggregates success, rework and timing」 |
| 时间窗口 / 团队过滤 | 运行第 3、4 用例 | 窗口外活动不计入；`getMetrics({teamId})` 只统计该 team | `metrics.test.ts:110-145` |
| `export <taskId> --summary` 存在 | 读 CLI 分支 | `--summary` flag 命中 `formatSummary`，`--out` 写文件 | `apps/cli/src/index.ts:94-116` |

**验证结果（层 A/B）**：7 用例通过（见 §0）；类型字段逐字一致。唯一措辞风险是「stdout/stderr」与持久化字段 `output` 的表述差异（`03-review.md` Finding 4），落盘时建议写「output（stdout/stderr 合并）」消除歧义。

### 3.2 工具审计

| 声称 | 验证步骤 | 预期结果 | 证据 |
|---|---|---|---|
| `ToolCallAudit` = `name`+`status`(`ok/denied/unknown`)+`reason`(可空) | 读类型 | 一致 | `packages/agent-runtime/src/tool-audit.ts:2-6` |
| `ToolAudit` = `calls[]`+`source`(`runtime/unknown`)+`reason`(可空) | 读类型 | 一致 | `tool-audit.ts:9-13` |
| `TOOL_AUDIT_LIMIT = 100`，去重键 `name\|status\|reason`，达到即停 | 读常量与 `push` | 一致；注意实现里 `reason` 用 `?? ''` 归一（`null` 与 `''` 同键） | `tool-audit.ts:15,30-34` |
| Runtime 未报工具调用时 `source = 'unknown'` 且带原因，不猜测 | 读 `extractToolAudit` 结尾 | 返回 `{ calls: [], source: 'unknown', reason: 'The runtime output did not report tool calls.' }` | `tool-audit.ts:95-96` |

**验证结果**：类型/常量逐字一致。`03-review.md` Finding 7 提醒去重键有 `null`/空串归一与 `depth > 6` 截断（`tool-audit.ts:37`），README 不必展开，但验收时若声称「去重键为 name|status|reason」需知道归一这一层。

### 3.3 成本预算

| 声称 | 验证步骤 | 预期结果 | 证据 |
|---|---|---|---|
| 上限字段为**三个可选**：`maxCostUsd` / `maxInputTokens` / `maxOutputTokens` | 读 `CostBudget` 类型 | 三字段均可选；缺任一也可通过 schema（至少一个非空） | `packages/agent-runtime/src/roles.ts:20-24,26-33` |
| `budgetStatus(taskId, roleId)` 返回 `{ taskId, role, team }`，`role`/`team` 各为 `BudgetStatus` | 读函数与类型 | 一致；`role`/`team` 可 `null` | `packages/storage-core/src/index.ts:480-484,1895-1913` |
| `BudgetStatus` 含 `scope`/`scopeId`/`configured`/`exceeded`/`reasons`/`limits`/`spend`，`spend` 含 `costUsd`/`inputTokens`/`outputTokens`/`reportingRuns`/`totalRuns` | 读类型 | 一致（含 `outputTokens`，02 已补） | `index.ts:463-478` |
| `maxOutputTokens` 超限同样置 `exceeded=true` 并生成原因 | 读 `budgetFor` | 三个维度分别比较，`reasons` 任一非空即 `exceeded` | `index.ts:1934-1942` |
| 超限阻断 `createRun` 与 `executeRun`，写 `budget.blocked` | 运行 `budget.test.ts` 第 1、2 用例 | `createRun`/`executeRun` 均 `rejects.toThrow('Budget exceeded')`；审计含 `budget.blocked` | `budget.test.ts:42-99`；`index.ts:1946-1964` |
| Runtime 未上报用量时**不阻断**（`spend.costUsd=null`、`reportingRuns=0`、`exceeded=false`） | 运行 `budget.test.ts` 第 3 用例 | 断言通过，且 `team` 为 `null`、`budgetStatus('missing-task')` 为 `null` | `budget.test.ts:101-123` |
| 预算为任务内口径，不跨任务累计 | 读 `budgetStatus` 实现 | 只对 `this.listRuns(taskId)` 聚合，未跨任务 | `index.ts:1898-1910` |

**验证结果**：`budget.test.ts` 3 用例通过（见 §0）；类型逐字一致。`01-plan.md`/`02` §2.4 漏列 `maxOutputTokens` 这一缺口（`03-review.md` Finding 1）**已在本步骤用源码证实存在**，README 落盘必须补上。

## 4. 落盘后复验清单（交接给落盘者 / 最后一步验收）

README 落盘后，须按以下清单逐条复跑，全部满足才可判「通过」：

1. `## 报告指标` 只出现在「内核能力」表与 `## 目录` 之间；三个子小节标题为 `### 运行证据` / `### 工具审计` / `### 成本预算`。
2. 成本预算 `limits` 写 **`maxCostUsd / maxInputTokens / maxOutputTokens`** 三项（修正 Finding 1）。
3. `byRuntime`/`byRole` 分桶字段逐项列出，并标注 **`byRole` 无 `costUsd`**（修正 Finding 2）。
4. 运行证据采用「单 Run 证据（`RunRecord`/`RunArtifacts`）vs 汇总指标（`KernelMetrics`）」二分表述，不照抄 `01` 的 `getMetrics()` 说法（修正 Finding 3）。
5. 无证据表述（CodeBuddy 不上报 token/工具调用）写为「取决于 Runtime 是否上报」，未写成已实现。
6. 与「已知限制」两条口径（Runtime 上报依赖；预算任务内口径）不冲突。
7. 落盘后复跑 `npx vitest run packages/storage-core/test/metrics.test.ts packages/storage-core/test/budget.test.ts` 与 `npm run typecheck`，结果全绿（纯文档改动不应影响）。

## 5. 剩余风险 / 不可验证项

- **README 落盘 owner 未指派**（`03-review.md` Finding 5 延续）：本步骤验证的是「指标语义」，不是「README 已写对」；在有人真正落盘并复跑第 4 节清单前，整个验收缺对象。
- **绝对行号漂移**（`03-review.md` Finding 6）：本报告第 3 节证据映射用了行号，任何前序编辑都会使其失效；复验时应以标题/符号锚点为主、行号为辅。
- **Runtime 上报依赖**：usage / 工具审计是否真实有数据，取决于具体 Runtime 是否上报，本报告不保证线上有值（对应 `01` 的「取决于 Runtime 是否上报」口径）。

## 6. 本步骤结论

三类指标的字段语义与阻断行为**已验证**（源码类型 + 7/7 测试通过），但 README 尚未落盘，因此**整体验收仍为「未完成」，不可判「通过」**；待落盘者按第 4 节清单复验后方可收口。
