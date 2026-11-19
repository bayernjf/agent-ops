# Agent Ops 多 Agent 角色与团队 — 实施拆解

> 状态：Draft，待评审  
> 日期：2026-11-19  
> 上游 PRD：`Agent-Ops-多Agent角色与团队-PRD-2026-11-19.md`  
> 用途：把 PRD 拆成可落码的 Epic / 功能点 / 里程碑 / 验收；本文件不替代 `handoff.md` 的活跃待办入口。

---

## 0. 使用方式

1. 先读 PRD §2 目标与 §12 当前不做，确认范围没有漂移。
2. 按 §3 Epic map 看依赖顺序；按 §4 功能点表拆 issue。
3. 每个里程碑只做 §5 列出的范围，不提前做后续里程碑。
4. 完成一个功能点，必须同时更新：代码、测试、API/CLI、UI（如适用）、证据、文档。
5. 活跃待办仍登记在 `agent-ops/handoff.md`；本文件只做拆解与验收，不维护第二份活跃清单。

---

## 1. 拆解原则

| 原则 | 说明 |
|---|---|
| 先闭环，再角色 | accept 丢改动、reject 污染 worktree 没修之前，不做多角色 |
| 先串行，再并行 | v0.2 一条 worktree 串行；v0.3 才多 worktree 并行 |
| 复用优先 | 复用 `AgentProfile`、`FeatureTaskPipeline`、`commitAgentChanges`，不重写 |
| 角色与 Runtime 解耦 | Role 是产品概念；Runtime 是 adapter；Profile 是绑定配置 |
| 权限要可执行 | `allowedTools/blockedTools` 必须落到命令/策略；不支持的标 `unsupported` |
| 人审是边界 | 不自动 merge/push；accept 只 commit |
| 单机单用户 | 不引入多租户、真人席位、云依赖 |
| 证据先行 | 每个 Run 有 role/runtime/worktree/diff/exit code/commit |

---

## 2. 现状资产与改造点

### 2.1 可直接复用

| 资产 | 位置 | 复用方式 |
|---|---|---|
| `AgentProfile` | `packages/agent-runtime/src/profiles.ts` | Role 的底层绑定；保留兼容 |
| `FeatureTaskPipeline` | `packages/agent-runtime/src/pipeline.ts` | 上移到内核 Task；每步 `profileId` 复用 |
| `commitAgentChanges` | `plugins/webapp-delivery/packages/storage-webapp/src/index.ts` | 抽取到共享模块；保留 `.env`/软链防护 |
| `RunArtifacts` | `packages/storage-core/src/index.ts` | 扩展 role/runtime/commit/version/cost |
| Task/Run API | `packages/server-core/src/index.ts` | 增加 role/team/pipeline 路由 |
| Studio TasksView | `plugins/webapp-delivery/apps/studio/src/views/TasksView.tsx` | 增加创建/角色/逐文件审 |
| worktree | `packages/storage-core/src/worktree.ts` | 继续 `git worktree add --detach`；v0.3 多 worktree |
| SSE/cancel | `packages/storage-core`、`packages/server-core` | 复用事件与取消 |

### 2.2 必须新增/改造

| 模块 | 改造 |
|---|---|
| `storage-core` | RoleStore / TeamStore；`roles`、`teams`、`team_roles`、`team_handoffs` 表；Task/Run 新字段；commit/reset |
| `agent-runtime` | RuntimeRegistry；RoleResolver；PolicyEngine；PipelineRunner 内核化 |
| `server-core` | `/api/roles`、`/api/teams`、`/api/tasks/:id/steps`、`/api/runs` 扩展 |
| `workflow` | Pipeline step 状态；暂停/恢复；失败重跑 |
| `apps/cli` | MCP 增加 role/team/pipeline/assign 工具 |
| `apps/daemon` | 双模下挂载新路由；不破坏 webapp 模式 |
| `studio` | RolesView、TeamsView、TasksView 扩展、逐文件 diff |
| `storage-webapp` | 兼容旧 `FeatureTaskPipeline`；逐步改用内核 pipeline |
| `README/AGENTS` | 同步 5 个内核 package、daemon 双模、角色/团队说明 |

---

## 3. Epic map

```text
E0 基础闭环修复
  └─ E1 Role 模型
       └─ E2 Runtime Registry
            └─ E3 Policy 执行
                 └─ E4 Task/Run 扩展
                      └─ E5 Team / Assignment / Handoff
                           └─ E6 内核串行 Pipeline
                                └─ E7 Studio UI
                                     └─ E8 证据与审计
                                          └─ E9 Adapter 扩展
                                               └─ E10 Dogfood / 发布
```

| Epic | 目标 | 优先级 | 依赖 |
|---|---|---|---|
| E0 基础闭环 | 不丢改动、可重跑、验收标准可用 | P0 | 无 |
| E1 Role | 角色一等概念，可 CRUD/绑定 Runtime | P0 | E0 |
| E2 Runtime Registry | adapter 可扩展，能力矩阵 | P0 | E1 |
| E3 Policy | 角色工具权限真正生效 | P0 | E1/E2 |
| E4 Task/Run | 任务带角色/优先级/验收；Run 带 commit | P0 | E1/E0 |
| E5 Team | 团队、派活、交接 | P1 | E1/E4 |
| E6 串行 Pipeline | 内核多角色串行流水线 | P0 | E1/E4 |
| E7 Studio UI | 建任务、角色/团队页、逐文件审 | P1 | E4/E5/E6 |
| E8 证据/审计 | 角色/团队/交接可回放 | P1 | E4/E5 |
| E9 Adapter | Claude/OpenCode 稳定；Pi/DSH 实验；自有 Harness 不投入（PD-9） | P0/P2 | E2/E3 |
| E10 Dogfood/发布 | 3–5 真实任务；文档/回归 | P1 | 全部 |

---

## 4. 功能点清单

> 规模：S ≤ 0.5 人日，M 1–2 人日，L 3–5 人日，XL >5 人日（必须再拆）。  
> 验收为最低判定，详细测试在 §7。

### E0 基础闭环

| ID | 功能点 | 优先级 | 模块/改动 | 依赖 | 验收 | 规模 |
|---|---|---|---|---|---|---|
| F0-01 | accept 落 commit | P0 | `storage-core` `acceptRun`；共享 commit 模块 | 无 | accept 后 worktree 有 commit；Run 记录 `commitSha`；无改动时记录 null | M |
| F0-02 | release 脏 worktree 保护 | P0 | `storage-core` `releaseTask` | F0-01 | 有未提交改动时 release 返回 409/明确错误；不删 worktree | S |
| F0-03 | reject 重置 worktree | P0 | `storage-core` `rejectRun` | 无 | reject 后 `git status --porcelain` 为空；重跑不继承上一轮改动 | M |
| F0-04 | Task 增加验收标准/优先级 | P0 | schema/migration、`server-core`、CLI、prompt | 无 | 创建/详情可见；prompt 注入；review 可逐条勾选；旧 Task 兼容 | M |
| F0-05 | commit 安全检查 | P0 | 共享 commit 模块 | F0-01 | `.env`/`.env.*` 不进入 commit；workspace 外软链不进入 commit | M |
| F0-06 | Run 证据扩展 role/runtime/commit | P0 | `RunRecord`/`RunArtifacts`、API、Studio | F0-01/F1-01 | 新 Run 有 roleId/runtimeId/commitSha；旧 Run 为 null 不崩 | M |

### E1 Role

| ID | 功能点 | 优先级 | 模块/改动 | 依赖 | 验收 | 规模 |
|---|---|---|---|---|---|---|
| F1-01 | Role schema | P0 | `agent-runtime` 新 `roles.ts`；`storage-core` 表 | E0 | 字段校验；`runtimePolicy`/`acceptanceCriteria` 可存 | M |
| F1-02 | Role CRUD API | P0 | `server-core` `/api/roles` | F1-01 | 创建/列表/详情/更新/删除；404/400 明确 | M |
| F1-03 | Role CLI/MCP | P0 | `apps/cli/mcp.ts` | F1-02 | 4 个以上 role 工具；与 API 一致 | S |
| F1-04 | RoleResolver | P0 | `agent-runtime` | F1-01（Registry 可并行） | Role → Profile/Runtime 解析；候选 Runtime 可校验 | M |
| F1-05 | 同一 Agent 多角色 | P0 | Role + Profile 组合 | F1-04 | 同一 baseAgent 建 3 角色；prompt/tools 独立 | S |
| F1-06 | Role 模板 | P1 | 内置 JSON/常量 | F1-02 | 实现/审查/测试/架构/调研模板可复制 | S |
| F1-07 | Role 测试运行 | P1 | API/Studio | F1-04 | 不建 Task 可 dry-run 或小任务验证 | M |

### E2 Runtime Registry

| ID | 功能点 | 优先级 | 模块/改动 | 依赖 | 验收 | 规模 |
|---|---|---|---|---|---|---|
| F2-01 | Adapter Registry | P0 | `agent-runtime` `AGENT_ADAPTERS` → registry | 无 | 新增 adapter 不改内核 switch；可列出 | M |
| F2-02 | Capability matrix | P0 | registry 元数据 | F2-01 | 非交互/流式/结构化/恢复/工具策略/worktree 安全可查询 | M |
| F2-03 | 健康/版本/登录探测 | P1 | `doctor`/`catalog` | F2-01 | 每 Runtime 显示版本、auth hint、可用状态 | S |
| F2-04 | 启动超时/preflight | P1 | registry/runner | F2-01 | OpenCode 等启动有 timeout 和明确错误 | M |
| F2-05 | Adapter SDK | P2 | 新包/接口 | F2-02 | 第三方可按接口接入；自有 Harness 暂不投入（PD-9）；内核不依赖 | L |

### E3 Policy

| ID | 功能点 | 优先级 | 模块/改动 | 依赖 | 验收 | 规模 |
|---|---|---|---|---|---|---|
| F3-01 | allowed/blocked 进执行路径 | P0 | `buildAgentExecutionPlan` + adapter | E1/E2 | Claude 映射 `--allowedTools`；Codex 映射 sandbox/config；不支持标 `unsupported` | L |
| F3-02 | 只读角色测试 | P0 | 测试夹具 | F3-01 | 审查者跑完 `git status` 无写改动 | M |
| F3-03 | Hermes yolo 收敛 | P0 | Hermes adapter/策略 | F3-01 | 受限角色不使用全放行；或包装策略；文档标注 | M |
| F3-04 | 工具调用审计 | P1 | RunArtifacts/事件 | F3-01 | 记录实际工具/拒绝原因；拿不到标 unknown | M |
| F3-05 | 统一策略层 | P2 | `policy` 包 | F3-01 | 跨 Runtime allow/deny/approval；不依赖 CLI 方言 | L |

### E4 Task/Run

| ID | 功能点 | 优先级 | 模块/改动 | 依赖 | 验收 | 规模 |
|---|---|---|---|---|---|---|
| F4-01 | Task role/team | P0 | schema/API/CLI | E0/E1 | role/team 可存；criteria/priority 复用 F0-04；旧数据兼容 | M |
| F4-02 | Run role/runtime/commit | P0 | schema/API | F4-01 | Run 继承 role；记录 runtime/commit | S |
| F4-03 | prompt 注入 | P0 | `buildTaskPrompt` | F4-01 | 角色职责/验收标准/工具约束进入 prompt | S |
| F4-04 | 版本/命令/token/cost | P1 | RunArtifacts | F4-02 | 能拿到就记；拿不到 unknown；不伪造 | M |
| F4-05 | 重跑 hygiene | P1 | storage-core | F0-03 | 重跑前 reset；可选新 worktree | S |
| F4-06 | 成本预算 | P2 | Role/Team/Run | F4-04 | 超限阻断/告警；可配置 | L |

### E5 Team / Assignment / Handoff

| ID | 功能点 | 优先级 | 模块/改动 | 依赖 | 验收 | 规模 |
|---|---|---|---|---|---|---|
| F5-01 | Team schema | P1 | storage-core | E1 | team/roles/handoffs 可存；校验环/重复 | M |
| F5-02 | Team CRUD API | P1 | server-core | F5-01 | 创建/列表/详情/更新/删除 | M |
| F5-03 | Assignment | P1 | Task/API/UI | F5-02/E4 | Task 派给 Role/Team；可见 | S |
| F5-04 | Handoff | P1 | storage-core/runner | F5-03 | 上游 commit/artifact 交给下游；记录可查 | L |
| F5-05 | 团队视图 | P1 | Studio | F5-02/F5-03 | 花名册/任务队列/卡点 | M |
| F5-06 | Coordinator | P2 | 新 Role 类型 | F5-04 | 自动拆任务/派活/汇总；人工审批 | XL |
| F5-07 | 并行团队 | P2 | worktree/runner | F5-04 | 多角色独立 worktree；有界并发；冲突可见 | XL |

### E6 内核串行 Pipeline

| ID | 功能点 | 优先级 | 模块/改动 | 依赖 | 验收 | 规模 |
|---|---|---|---|---|---|---|
| F6-01 | Pipeline 模型进内核 | P0 | `agent-runtime`/`storage-core` | F4-01 | Task 有 steps；每步 role/profile | M |
| F6-02 | 串行执行 | P0 | runner | F6-01 | 上一步成功才进下一步；记录每步结果 | L |
| F6-03 | 每步 commit | P0 | storage-core | F6-02/F0-05 | 每步成功 commit；SHA 记录；下游基于上一步 | M |
| F6-04 | 每步审批 | P1 | workflow/Studio | F6-02 | `requiresApproval` 暂停/恢复 | M |
| F6-05 | 失败重跑 | P1 | runner | F6-03 | reset 到 step base；不污染下游 | M |
| F6-06 | 并行 DAG | P2 | runner | F6-02 | 非串行依赖；v0.3 后 | XL |

### E7 Studio UI

| ID | 功能点 | 优先级 | 模块/改动 | 依赖 | 验收 | 规模 |
|---|---|---|---|---|---|---|
| F7-01 | 任务创建/编辑 | P1 | TasksView/App | F4-01 | 建 Task、选 Role、填验收/优先级 | M |
| F7-02 | 角色页 | P1 | RolesView | F1-02 | 角色卡/编辑/Runtime/工具权限 | M |
| F7-03 | 团队页 | P1 | TeamsView | F5-02 | 团队/角色/交接图/审批 gate | M |
| F7-04 | 逐文件接受/拒绝 | P1 | diff 组件 | F4-01 | 文件级勾选；部分接受生成 patch/commit | L |
| F7-05 | Run 详情扩展 | P1 | TasksView | F4-02 | role/runtime/version/command/commit/cost | S |
| F7-06 | 团队看板 | P2 | Studio | F5-05 | 花名册/队列/卡点/成本 | L |

### E8 证据与审计

| ID | 功能点 | 优先级 | 模块/改动 | 依赖 | 验收 | 规模 |
|---|---|---|---|---|---|---|
| F8-01 | 证据字段扩展 | P0 | RunArtifacts | F4-02 | role/runtime/commit/version 可查 | S |
| F8-02 | 审计事件 | P1 | run_events/新表 | F5-04 | 角色/派活/交接/accept/reject 可回放 | M |
| F8-03 | 证据导出 | P1 | API/CLI | F8-01 | 单任务导出 diff/日志/测试/commit/cost | M |
| F8-04 | 指标 | P2 | observability | F8-02 | 成功率/返工/成本/时长 | L |

### E9 Adapter

| ID | 功能点 | 优先级 | 模块/改动 | 依赖 | 验收 | 规模 |
|---|---|---|---|---|---|---|
| F9-01 | Codex 真实 E2E | P0 | adapter/测试 | E2/E3 | 登录后真实写任务；diff/测试通过 | M |
| F9-02 | Claude Code 验证 | P0 | adapter | E2/E3 | 登录后 candidate→verified；工具策略生效 | M |
| F9-03 | OpenCode 稳定 | P0 | adapter/driver | E2/E3 | preflight/timeout；真实写任务 | M |
| F9-04 | Hermes 收敛 | P0 | adapter | E2/E3 | 保持 verified；`--yolo` 受限 | S |
| F9-05 | Pi 实验 | P2 | adapter | F2-05 | 只读/小任务可跑；能力标 experimental | L |
| F9-06 | DSH 实验 | P2 | adapter | F2-05 | 小任务可跑；能力标 experimental | L |
| F9-07 | 自有 Harness（暂不投入） | — | — | — | PD-9：先不自研；仅保留 adapter 契约 | — |
| F9-08 | Aider/OpenClaw | P2 | 暂不投入 | 无 | 保持 candidate；不阻塞主线 | — |

### E10 Dogfood / 发布

| ID | 功能点 | 优先级 | 模块/改动 | 依赖 | 验收 | 规模 |
|---|---|---|---|---|---|---|
| F10-01 | 3–5 真实任务 | P1 | dogfood | 全部 | 记录 diff/测试/接受率/返工率 | L |
| F10-02 | 验收报告 | P1 | docs | F10-01 | 任务、证据、结论、问题 | M |
| F10-03 | 文档同步 | P2 | README/AGENTS/handoff | 全部 | 5 package/双模/角色/团队一致 | S |
| F10-04 | 打包/回归 | P2 | scripts | 全部 | typecheck/test/build 全绿 | M |

---

## 5. 里程碑与执行顺序

> 建议窗口，按实际评审调整；每个里程碑结束必须有可验收产物，不以“代码写完”作为完成。

### M0 基础闭环（2026-11-20 → 2026-11-26）— 已完成 2026-11-20

**目标**：先把“不丢改动、可重跑、验收标准可用”做对。

| 顺序 | 功能点 | 产物 |
|---|---|---|
| 1 | F0-01/F0-05 accept commit + 安全检查 | `commitRun` 共享模块；Run `commitSha` |
| 2 | F0-02 release guard | release 脏 worktree 拒绝 |
| 3 | F0-03 reject reset | reject 后 worktree 干净 |
| 4 | F0-04 Task criteria/priority | migration/API/prompt |
| 5 | 测试 | storage-core/server-core 新增用例；typecheck 0 |

**退出标准**：

- Given 带验收标准的 Task，Run 后 prompt 含标准。
- accept 后有 commit SHA；release 脏 worktree 被拒绝。
- reject 后重跑无上一轮残留。
- `.env`/外部软链不被 commit。
- `npm run typecheck` 0、相关测试绿。

**完成记录（2026-11-20）**：`73026db feat(storage-core): close the task acceptance and commit loop`、`60ec8dd fix(storage-core): keep accepted commits reachable`。accept 落 commit + `commit_sha`，并 pin 到 `refs/agent-ops/tasks/<taskId>`；release 脏 worktree 拒绝；reject 回到 `base_commit` 并可重跑；Task `acceptanceCriteria` / `priority` / `baseCommit` 经 migration `0010_task_closure` 落库并进入 prompt。全仓 typecheck 0、44 文件 / 614 tests 绿。真实模型 UI E2E 仍受登录阻塞，未计入 M0 完成证据。

### M1 角色与串行（2026-11-27 → 2026-12-10）

**目标**：单机多角色串行工作台可用。

| 顺序 | 功能点 | 产物 |
|---|---|---|
| 1 | F1-01/F1-02/F1-03 Role schema/API/CLI | `/api/roles`；MCP 工具 |
| 2 | F1-04/F1-05 RoleResolver + 同 Agent 多角色 | 3 个 Codex 角色 |
| 3 | F0-06 证据扩展 | role/runtime/commit 字段 |
| 4 | F2-01/F2-02 Registry + capability matrix | 可查询能力 |
| 5 | F3-01/F3-02/F3-03 Policy 执行 | 审查者只读；Hermes 受限 |
| 6 | F4-01/F4-02/F4-03 Task/Run role/prompt | 派活到角色 |
| 7 | F6-01/F6-02/F6-03 内核串行 Pipeline | 架构→实现→审查→测试 |
| 8 | F7-01/F7-05 Studio 建任务/Run 详情 | UI 可建任务 |
| 9 | F9-02/F9-03 Claude/OpenCode 稳定 | 真实写任务 |

**退出标准**：

- 同一 Codex 3 角色 + Claude/Hermes 角色可创建。
- 4 步串行 Pipeline 跑通；每步 Role/Profile/Runtime 正确。
- 审查者无写操作；Hermes 受限角色不全放行。
- 每步 commit SHA 可查；失败可暂停/重跑。
- 至少 1 条真实模型 Run 从 UI 跑通（不再用确定性 runner 冒充）。

**M1-A 完成记录（2026-11-20，部分）**：F1-01 Role schema、F1-02 `/api/roles` CRUD、F1-03 5 个 MCP role 工具、F1-04 RoleResolver、F1-05 同 Agent 多角色（RoleStore + Profile 解耦）、F2-01 Runtime Registry、F2-02 capability matrix 已落码；`RuntimeRegistry` 替换内核 `AGENT_ADAPTERS` switch，7 个默认 adapter 状态与能力可查询。Role 暂存 `agent-roles.json`（原子替换 + corrupted 拒写），candidate adapter 在 Role API 直接拒绝。F6、F7、F9 未完成，M1 整体仍未达退出标准。

**F0-06 完成记录（2026-11-20）**：migration `0011_run_identity` 给 `runs` 增加 `role_id` / `runtime_id`；`RunRecord` 增加 `roleId` / `runtimeId`，旧 Run 空值映射为 `null`；`createRun` 可选 `roleId` 并校验 Role 存在，`executeRun` 写入实际 base adapter；server 与 MCP 透传 `roleId`；Studio Run 行展示 Role / Runtime / Commit。全仓 typecheck 0、47 文件 / 630 tests 绿。

**F3-01/F3-02/F3-03 完成记录（2026-11-20）**：Role `allowedTools/blockedTools` 经 `resolveToolPolicy` 进入 `CodexExecutionPlan`；Codex 只读 allowlist 映射 `--sandbox read-only`，写 allowlist 标记 `coarse` 并告警；Claude Code 映射 `--allowedTools`；Hermes 等不支持工具策略的 Adapter 对受限 Role 直接拒绝，不再全放行。只读审查者在 Codex 上执行后 worktree clean。全仓 typecheck 0、48 文件 / 637 tests 绿。F3-04 工具审计、F3-05 统一策略层未做。

**F4-01/F4-02/F4-03 完成记录（2026-11-20）**：migration `0012_task_role` 给 `tasks` 增加 `role_id`；`createTask` 校验 Role 存在且启用；`createRun` 默认继承 Task Role，显式 role 可覆盖，并校验 Role baseAgent 与 run agent（含 `local-*` 前缀和 Profile base）一致。`buildAgentExecutionPlan` 追加 Role 职责、systemPrompt、验收标准、allowed/blocked tools 与 approval mode。server 与 MCP Task 创建支持 roleId；MCP create_task 同时开放 acceptanceCriteria/priority。全仓 typecheck 0、48 文件 / 639 tests 绿。Team 字段、F4-04 版本/成本、F4-05 重跑 hygiene、F4-06 预算未做；Run 不会自动采用 Role 的 profileId 作为执行 Profile。

### M2 团队与狗粮（2026-12-11 → 2026-12-24）

**目标**：团队/交接/逐文件审可用，开始真实狗粮。

| 顺序 | 功能点 | 产物 |
|---|---|---|
| 1 | F5-01/F5-02/F5-03 Team/Assignment | 团队 + 派活 |
| 2 | F5-04 Handoff | 上游产物/commit 交给下游 |
| 3 | F5-05/F7-03/F7-04 团队视图/逐文件审 | UI 可用 |
| 4 | F8-02/F8-03 审计/导出 | 可回放/导出 |
| 5 | F10-01/F10-02 3–5 dogfood | 报告 |
| 6 | F1-06 Role 模板 | 内置模板 |

**退出标准**：

- 5 角色团队完成一个真实仓库任务：架构→实现→审查→测试→汇总。
- 团队视图可见角色/任务/卡点；交接记录可查。
- 逐文件接受至少可用；accept 后 commit；reject 干净。
- 3–5 个 dogfood 完成，记录接受率/测试通过率/返工率。
- 无 P0 数据丢失/权限违规。

### M3 并行与扩展（2026-12-25 → 2027-01-14）

**目标**：多角色并行 + 实验 Runtime。

| 顺序 | 功能点 | 产物 |
|---|---|---|
| 1 | F5-07 并行 worktree | 每角色独立 worktree |
| 2 | F5-06 Coordinator | 拆任务/派活/汇总 |
| 3 | F9-05/F9-06 Pi/DSH 实验 adapter；自有 Harness 不投入 | 实验 adapter |
| 4 | F4-04/F4-06 版本/成本/预算 | 证据/预算 |
| 5 | F8-04 指标 | observability 接入 |
| 6 | F1-07 Role 测试运行 | 角色 dry-run |

**退出标准**：

- 3 个角色并行、各自 worktree；冲突可见；有界并发。
- Coordinator 可拆任务/汇总；人工保留审批。
- Pi/DSH 至少各跑通一个小任务，标 experimental；自有 Harness 不要求。
- 成本能记录则记录，不能则标 unknown。

### M4 稳定与发布（2027-01-15 → 2027-01-21）

**目标**：文档、回归、打包、日常可用。

| 顺序 | 功能点 | 产物 |
|---|---|---|
| 1 | F10-03 文档同步 | README/AGENTS/handoff 一致 |
| 2 | F10-04 打包/回归 | 全门禁绿 |
| 3 | 发布说明 | 版本/已知限制/下一步 |
| 4 | 复盘 | 数据/问题/决策 |

**退出标准**：

- 全仓 typecheck 0；测试全绿；Studio build 成功。
- 文档无“4 package / daemon 只挂 delivery-server / P2 待做”等漂移。
- 至少 3 个真实任务在日常使用中完成。
- 无 P0 数据丢失/权限违规。

---

## 6. 关键方案拆解

### 6.1 Role / Profile 兼容

**方案**：

- 新增 `Role` 表/类型；`Role` 可以：
  - 引用现有 `AgentProfile`（`profileId`）；
  - 或内联 `baseAgentId + overrides`。
- `RoleResolver` 把 Role 解析成 `{ baseAgentId, profile, runtimePolicy }`。
- 保持 `AgentProfile` API 不变；Studio 先展示 Role，底层写 Profile。
- 后续 v0.4 再决定是否把 `AgentProfile` 重命名为 `RoleBinding`。

**避免**：不要同时维护两套完全独立的角色/配置，导致 UI 和 API 不一致。

### 6.2 Runtime Registry

**方案**：

- 把 `AGENT_ADAPTERS` 从常量改为 `RuntimeRegistry`：
  - `register(adapter)`；
  - `get(id)`；
  - `list()`；
  - `capabilities(id)`。
- Adapter 接口扩展：

```ts
interface RuntimeAdapter {
  id: string;
  status: 'verified' | 'candidate' | 'experimental';
  capabilities: {
    nonInteractive: boolean;
    streaming: boolean;
    structuredOutput: boolean;
    sessionResume: boolean;
    toolPolicy: 'native' | 'wrapper' | 'unsupported';
    worktreeSafe: boolean;
  };
  buildCommand(input: RunInput): string[];
  detect(): Promise<RuntimeInfo>;
}
```

- 内核不直接 import 具体 adapter；通过 registry 解析。
- Pi/DSH 作为 experimental adapter 注册，不阻塞主线；自有 Harness 不投入（PD-9）。

### 6.3 Policy 执行

**方案**：

- `PolicyEngine.resolve(role, runtime)` 返回：
  - `allowedTools`；
  - `blockedTools`；
  - `approvalMode`；
  - `unsupported` 列表。
- 各 adapter 映射：
  - Claude：`--allowedTools` 动态生成；
  - Codex：`--sandbox workspace-write` + 配置/包装；
  - OpenCode：driver 参数/配置；
  - Hermes：`--yolo` 仅用于低风险角色，或包装成受限执行；
  - Pi/DSH：按 capability 标注；自有 Harness 不投入（PD-9）。
- 不支持工具策略的 Runtime，Role 创建时警告；只读角色禁止绑定该 Runtime，除非有 wrapper。

### 6.4 内核串行 Pipeline

**方案**：

- 把 `FeatureTaskPipeline` 的模型上移到 `storage-core`/`agent-runtime` 内核：
  - `TaskPipelineStep`：`roleId`/`profileId`、prompt、dependsOn、requiresApproval；
  - `TaskPipelineResult`：step status、runId、commitSha、output、error。
- `PipelineRunner`：
  1. 取 next step；
  2. resolve Role；
  3. 在同一 worktree 执行；
  4. 成功后 commit；
  5. 记录 step result；
  6. 失败/需审批则暂停。
- 旧 `FeatureTaskPipeline` 保留兼容；webapp 插件可逐步切到内核。

### 6.5 Commit / Reset

**方案**：

- 抽取 `commitWorkspaceChanges(worktree, message)`：
  - `git add -A`；
  - 检查 `.env`/`.env.*`；
  - 检查指向 workspace 外的软链；
  - `git commit`；
  - 返回 SHA。
- `acceptRun`：
  - 单 Run：commit；记录 SHA；置 done。
  - Pipeline 最后一步：记录最后 SHA；不再重复 commit。
- `rejectRun`：
  - reset 到 task base 或 step base；
  - `git clean -fd`；
  - 回 queued/pending。
- `releaseTask`：
  - `git status --porcelain` 非空则拒绝；
  - 否则 remove worktree。

### 6.6 Team / Handoff

**方案**：

- Team 只存关系，不存执行状态；执行仍是 Task/Run。
- `Handoff` 以 `commitSha`/`artifactPath` 为交付物，不共享 chat。
- 串行 handoff 共用一个 worktree；并行 handoff 各自 worktree + coordinator 汇总。
- 交接规则先手动配置，v0.3 才做 Coordinator 自动派活。

### 6.7 Studio UI

**页面**：

- `RolesView`：角色列表/详情/新建/编辑；Runtime 策略；工具权限；测试运行。
- `TeamsView`：团队列表/详情；角色成员；交接边；审批 gate。
- `TasksView` 扩展：
  - 新建任务：标题/目标/仓库/baseRef/优先级/验收标准/角色/团队；
  - 任务详情：角色、步骤、Run 证据；
  - diff：文件级勾选；accept/reject；
  - Run 详情：role/runtime/version/command/worktree/commit/cost。
- 保持现有 Task 看板只读/gate 的兼容，逐步替换。

### 6.8 证据与审计

**RunArtifacts 扩展**：

```ts
type RunArtifacts = {
  // existing...
  roleId?: string;
  runtimeId?: string;
  runtimeVersion?: string;
  command?: string[];
  commitSha?: string | null;
  tokenUsage?: { input?: number; output?: number; total?: number } | null;
  costUsd?: number | null;
};
```

规则：能拿到就记；拿不到 `null`/`unknown`；不伪造。

---

## 7. 测试策略

### 7.1 单元测试

| 模块 | 覆盖 |
|---|---|
| `agent-runtime` | RoleResolver、RuntimeRegistry、PolicyEngine、PipelineRunner、prompt 注入 |
| `storage-core` | RoleStore/TeamStore、Task/Run 字段、commit/reset、release guard |
| `server-core` | 新路由、校验、错误码、旧 API 兼容 |
| `workflow` | Pipeline step 状态、暂停/恢复 |
| `cli` | MCP role/team/pipeline/assign 工具 |

### 7.2 集成测试

- 创建 3 个同 Agent 角色 → 串行 Pipeline → 每步 commit → 最终 accept。
- 审查者角色 → 跑完无写操作。
- reject → reset → 重跑无残留。
- release 脏 worktree → 拒绝。
- `.env`/外部软链 → 拒绝 commit。
- 旧 Task/Run/Profile → 新 API 不崩。

### 7.3 E2E / 真实模型

- Codex 登录后真实写任务。
- Claude Code 登录后真实写任务；工具策略生效。
- OpenCode preflight/真实任务。
- Hermes 受限角色。
- 3–5 个真实仓库 dogfood。

### 7.4 门禁

```bash
npm run typecheck
npm test
# 涉及 Studio
npm --workspace @agent-ops/studio run build
```

安全测试：

- `.env` 不进 commit。
- 外部软链不进 commit。
- 只读角色无写操作。
- release 不丢改动。

---

## 8. 风险与依赖

| 风险 | 影响 | 应对 | Owner |
|---|---|---|---|
| Claude 未登录 | Claude 角色不可用 | `/login`；adapter 保持 candidate | owner |
| OpenCode 启动慢 | 真实 E2E 阻塞 | preflight/timeout；明确错误 | 工程 |
| 工具策略方言 | 权限不能统一 | capability matrix；不支持标 unsupported | 工程 |
| 同 Agent 会话污染 | 角色行为串味 | 独立进程/会话；测试隔离 | 工程 |
| 并行 worktree 冲突 | 文件互相踩 | v0.2 串行；v0.3 独立 worktree + 锁 | 工程 |
| accept 丢改动 | 数据丢失 | M0 先修；release guard | 工程 |
| 成本数据缺失 | 无法计费 | 标 unknown；不伪造 | 工程 |
| 范围膨胀 | 做成 Multica 克隆 | PRD §12 非目标；先串行后并行 | owner |

---

## 9. 当前不做与触发条件

> 与 PRD §12 一致；这里只列“什么时候重新考虑”。

| 不做项 | 触发条件 |
|---|---|
| 多用户/真人席位 | 需要第二个人共享看板/审批 |
| 云/远程 daemon | 本机不能常开或需要移动触发 |
| 桌面/移动端 | 日常使用需要通知/手机审批 |
| 29+ adapter | 4 稳定 + 2 实验（Pi/DSH）狗粮通过 |
| 完整 IDE/终端/浏览器 | 用户明确需要内置编辑/终端 |
| 自动 merge/push/PR | 不做自动；最多显式“一键 PR” |
| 自研 harness | 自有 Agent 内核产品立项 |
| 角色记忆/技能库 | v0.4，角色/团队稳定后 |
| Coordinator 自动派活 | v0.3，串行 handoff 狗粮通过 |
| 并行多 worktree | v0.3，冲突测试通过 |
| 成本预算/计费 | model-hub usage 可按 role/task 归集 |
| ACP/MCP 全协议 | 有明确外部客户端需求 |
| 插件/模板市场 | 有第三方贡献 |
| 企业 SSO/多租户 | 产品转团队版 |

---

## 10. 开放问题

| ID | 问题 | 建议 | 需要谁拍板 |
|---|---|---|---|
| Q1 | Role 与 Task 验收标准冲突 | Role 默认，Task 覆盖；review 展示合并结果 | owner |
| Q2 | Runtime fallback 是否自动 | v0.2 手动；v0.3 可选自动，需显式开启 | owner |
| Q3 | 串行 Pipeline 是否共用一个 worktree | 是；每步 commit，下游基于上一步 | 工程 |
| Q4 | 逐文件接受实现方式 | 文件级 patch + 部分 commit；先不做 hunk 级 | 工程 |
| Q5 | 是否重命名 `AgentProfile` | 暂不；Role 作为上层，Profile 作为绑定 | owner |
| Q6 | 团队 handoff 交付物格式 | commit SHA + artifact 路径 + 摘要 | 工程 |
| Q7 | 是否把 `FeatureTaskPipeline` 完全迁出插件 | 先双读兼容，v0.3 再收敛 | 工程 |
| Q8 | D7 支持面 | 已拍板 2026-11-19：4 稳定（Codex/Claude/OpenCode/Hermes）+ 2 实验（Pi/DSH）；自有 Harness 不投入（PD-9） | 已拍板 |

---

## 11. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-11-19 | 初稿：E0–E10 拆解、M0–M4 里程碑、功能点验收、非目标触发条件 |
| 2026-11-19 | 同步 PD-1～PD-9：自有 Harness 不投入；Pi/DSH 保留实验；Q8 关闭 |
| 2026-11-20 | M0 完成：accept commit/SHA、release guard、reject reset、Task criteria/priority；614 tests 绿 |
