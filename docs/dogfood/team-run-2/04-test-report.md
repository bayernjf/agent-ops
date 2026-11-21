# 04-test-report.md — 表述—证据交叉核对记录（CB Tester）

输入：`01-plan.md`（Architect）、`02-implementation.md`（Implementer）、`03-review.md`（Reviewer）。
方法：逐条对照 `02` 第 2 节 README 终稿与第 3 节证据映射、以及 `03` 的五个缺口，读源码与测试核实，并实跑相关测试套件。

结论：三段字段名/类型名/行号基本与源码一致；`03` 提出的五个缺口全部成立。owner 落盘前必须按 `03` 的修订建议改措辞（尤其缺口 1/2/3），否则终稿不得称「与源码逐字一致」。

---

## 0. 测试执行证据

实跑与「报告指标」直接相关的三个测试文件，全绿：

```
npx vitest run \
  packages/agent-runtime/test/tool-audit.test.ts \
  packages/storage-core/test/metrics.test.ts \
  packages/storage-core/test/budget.test.ts

Test Files  3 passed (3)
Tests       13 passed (13)
```

- `tool-audit.test.ts`：6 tests（ok/denied 抽取、去重、pretty-print、source=unknown、坏 JSON 跳过、上限截断）。
- `metrics.test.ts`：4 tests（空库零值/null 率、聚合、时间窗、team 过滤）。
- `budget.test.ts`：3 tests（role 超限阻断 createRun、team 超限阻断 execute-run、未上报不阻断）。

---

## 1. 逐段核对表（claim → 证据）

### 1.1 运行证据

| 声称（02 第 2 节） | 证据 | 结论 |
|---|---|---|
| Run 持久化 stdout/stderr、diff、exit code、耗时 | `packages/storage-core/src/index.ts:224-244`（`RunArtifacts`） | 部分不精确，见缺口 2 |
| `output` 为合并字段 + `outputTruncated`，上限 `RUN_OUTPUT_LIMIT = 64_000` | `index.ts:224-227`、`:258` | ✅ 字段/常量存在 |
| `diff` + `diffTruncated`，上限 `RUN_DIFF_LIMIT = 256_000` | `index.ts:228-230`、`:259` | ✅ |
| 分离的 stdout/stderr 仅作流式 `RunEvent` | `index.ts:246-256`（`RunEventType` 含 `stdout`/`stderr`；`RunEvent.data` 为原始 chunk） | ✅（但不单独持久化，见缺口 2） |
| 汇总指标 `KernelMetrics` 字段表 | `index.ts:495-545` | ✅ 字段名逐字一致 |
| `successRate` 无执行时为 `null` | `index.ts:1885`；`metrics.test.ts:38`、`:118` | ✅ |
| `reworkRate` 为 `(retries + rejections) / executed` 启发式 | `index.ts:1853-1855`（审计事件计数）、`:1886` | ✅ |
| `usage` 仅统计已上报 run，无上报为 `null` | `index.ts:1812-1818`、`:1887-1893` | ⚠️ 措辞不精确，见缺口 1 |
| `byRuntime` 含 `costUsd`（无上报为 `null`）、`byRole` 无 `costUsd` | `index.ts:528-544`、`:1857-1878`（byRuntime costUsd 置 null 在 `:1865`） | ✅ |
| `getMetrics()` 支持 `since`/`until`/`teamId` 过滤 | `index.ts:1765`、`:1775`、`:1882-1883` | ✅ |
| `export <taskId> --summary` | `apps/cli/src/index.ts:97`（usage 串含 `[--summary]`）、`:113`（`includes('--summary')`）、`:116`（`formatSummary` 分支）、`formatSummary` 定义 `:47` | ✅ flag 存在，但 README「命令」节未同步，见缺口 4 |

### 1.2 工具审计

| 声称（02 第 2 节） | 证据 | 结论 |
|---|---|---|
| `ToolCallAudit` = `name` + `status` + `reason`（可空） | `packages/agent-runtime/src/tool-audit.ts:2-6` | ✅（但 `status` 联合含 `unknown`，抽取器不产出，见缺口 3） |
| `ToolAudit` = `calls[]` + `source` + `reason`（可空） | `tool-audit.ts:9-13` | ✅ |
| `TOOL_AUDIT_LIMIT = 100`，去重键 `name\|status\|reason` | `tool-audit.ts:15`、`:30` | ✅ |
| `ok` 识别集 `{tool_use, tool_call, function_call, mcp_tool_call}` | `tool-audit.ts:17`（`TOOL_CALL_TYPES`）、`:52-54`（push `ok`） | ✅ |
| `denied` 缺名字缺省 `unknown-tool` | `tool-audit.ts:56-67`（`:64` 缺省）、push `denied` `:66` | ✅ |
| Runtime 未报工具调用时 `source = 'unknown'`，不猜测 | `tool-audit.ts:95-96`（`source:'unknown'` + 固定文案） | ✅ |
| `reason` 在 `source='unknown'` 时为固定文案 | `tool-audit.ts:96`（`'The runtime output did not report tool calls.'`） | ✅（与 `03` 次要备注一致） |
| 测试覆盖 | `tool-audit.test.ts:7-19`（ok/denied）、`:21-24`（去重）、`:26-29`（pretty-print）、`:31-38`（unknown）、`:40-46`（坏 JSON 跳过）、`:48-51`（上限） | ✅ 无任何测试产出 `status:'unknown'`，佐证缺口 3 |

### 1.3 成本预算

| 声称（02 第 2 节） | 证据 | 结论 |
|---|---|---|
| Role 可设 `maxCostUsd` / `maxInputTokens` / `maxOutputTokens` | `packages/agent-runtime/src/roles.ts:20-24`（`CostBudget`） | ✅ |
| Team 同样可设预算 | `packages/agent-runtime/src/teams.ts:28`（`budget?: CostBudget`，类型从 `roles.ts:2` 导入） | ✅（但 02 证据映射漏引，见缺口 5） |
| `BudgetStatus` 结构（scope/scopeId/configured/exceeded/reasons/limits/spend） | `index.ts:471-486` | ✅ |
| `TaskBudgetStatus` = taskId + role + team | `index.ts:488-492` | ✅ |
| `budgetStatus(taskId, roleId)` 返回 role/team 两维 | `index.ts:1904-1922`（role `:1910-1913`、team `:1915-1919`） | ✅ |
| 超限判定为 `>=` | `index.ts:1943-1951`（含 `maxOutputTokens` `:1949`） | ✅ |
| 超限阻断 `createRun` | `index.ts:967`（`assertBudget(..., 'create-run')`） | ✅ |
| 超限阻断 `executeRun` | `index.ts:1225`（`assertBudget(..., 'execute-run')`） | ✅ |
| 写 `budget.blocked` 审计事件并抛错 | `index.ts:1956-1973`（`recordAudit` `:1961-1969`、`throw` `:1970-1972`） | ✅ |
| 未上报用量不阻断（`spend.costUsd = null`、`reportingRuns = 0`、`exceeded = false`） | `index.ts:1936-1937`（无 budget）、`:1925-1935`（逐字段 `sumReported`）；测试 `budget.test.ts:101-123` | ✅ |
| 测试覆盖 | `budget.test.ts:42-71`（role 超限阻断 createRun + `budget.blocked`）、`:73-99`（team 超限跨角色 + 阻断 execute-run）、`:101-123`（未上报不阻断） | ✅ |

---

## 2. 对 03 五个缺口的复核对（tester 独立确认）

| # | 缺口 | tester 结论 | 关键证据 |
|---|---|---|---|
| 1 | `usage` 与 `spend` 的 null 语义不同，终稿用同一句「无上报时为 null」 | **成立**。`usage` 是「任一字段非 null 即计入 reportingRuns，其余维 `?? 0` 累加，仅 `reportingRuns===0` 时三项全 null」；`spend` 是「逐字段无上报即 null」 | `usage`: `index.ts:1812-1818`、`:1887-1893`；`spend`: `index.ts:1925-1935` |
| 2 | 「完整 diff」「stdout/stderr」掩盖截断与合并 | **成立**。`output` 合并 + 截断、`diff` 截断、stdout/stderr 只作流式事件 | `index.ts:224-230`、`:246-256`、`:258-259` |
| 3 | 终稿列 `status ∈ {ok, denied, unknown}`，抽取器从不产出 `unknown` | **成立**。抽取器只 push `ok`/`denied`，`unknown` 只在类型联合与 `ToolAudit.source` | `tool-audit.ts:53`、`:66`、`:95-96`；`tool-audit.test.ts` 无 unknown status 用例 |
| 4 | `export <taskId> --summary` 与 README「命令」节不一致 | **成立**。CLI 有 `--summary`，README `:67` 只写 `[--out file]` | `apps/cli/src/index.ts:97,113,116`；`README.md:67` |
| 5 | Team 预算证据只引 roles.ts，未引 teams.ts | **成立**。Team 侧 `budget?: CostBudget` 出处未给 | `packages/agent-runtime/src/teams.ts:28`；`index.ts:1915-1919` |

---

## 3. 与「已知限制」的一致性（核对）

`README.md:78-83` 两条限制：

- `:80` — token/cost 与工具审计取决于 Runtime 是否上报，CodeBuddy 当前不报。
- `:82` — 预算为任务内口径、不跨任务累计、只在启动前阻断。

终稿三段（`usage` 的 null 语义、工具审计 `source='unknown'`、预算「未上报不阻断」）均指向「取决于 Runtime 是否上报」，未写成已保证上报；「成本预算」未写「跨任务累计」。不冲突、不重复承诺。

---

## 4. 无法在本步验证 / 遗留风险（blocked）

- **SSE 实时输出与取消**：源码层面 `RunEventType`（`index.ts:246`）与 `cancelled` 字段（`index.ts:235`）存在，但本步未起真实 daemon + SSE 客户端观察实时推送，仓库内亦无覆盖 SSE 投递的单元测试。README 该句沿袭自 `README.md:18` 旧表述，不新增事实错误，但「SSE 实时」属**源码引用、非运行时验证**。
- **真实 Runtime 上报 token/cost/工具调用**：无法在无真实模型的测试中验证（AGENTS.md 规定测试不得依赖真实模型/外部服务）。README 已按「取决于 Runtime 是否上报」表述，属正确写法。
- **本步未改任何代码**：以上均为只读核对 + 跑测试；`04-test-report.md` 是本步唯一落盘文件。

owner 落盘 `05-final.md` 前，需先按 `03` 缺口 1/2/3 的修订建议改 `02` 第 2 节终稿措辞，并按缺口 4 同步 README「命令」节的 `--summary`，再称「与源码逐字一致」。
