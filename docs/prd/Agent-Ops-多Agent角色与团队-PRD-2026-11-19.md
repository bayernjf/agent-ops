# Agent Ops 多 Agent 角色与团队 PRD

> 状态：Draft，待 owner 评审  
> 日期：2026-11-19  
> 产品：Agent Ops（Tier 0）  
> 目标版本：v0.2（单机多角色串行工作台）、v0.3（多角色团队并行）  
> Owner：owner（单人自用）  
> 关联文档：[`Agent-Ops-多Agent角色与团队-实施拆解-2026-11-19.md`](./Agent-Ops-多Agent角色与团队-实施拆解-2026-11-19.md)、`bayjf/docs/tier0/Tier0-四项战略议题-2026-11-18.md`、`bayjf/docs/tier0/Tier0-Agent运行时与组织层评估-2026-11-16.md`、`bayjf/docs/tier0/Tier0-agent-dev并入AgentOps-迁移方案-2026-11-18.md`

---

## 0. 一句话结论

Agent Ops 不再只是“单 Agent 的 Task/Run 控制面”，而是升级为**本地多 Agent 的角色与团队控制面**：把 Codex、Claude Code、OpenCode、Hermes、Pi、DeepSeek Harness 以及自有 Harness 统一接入，把每个 Agent 配置成可复用的角色，让多个角色在同一个任务上串行交接，后续再支持并行团队。

不是再做一个 Multica 克隆，不是新 harness，不是新 IDE。Agent Ops 负责“管人、派活、隔离、取证、验收”，执行仍交给本机现成的 Agent。

---

## 1. 背景与问题

### 1.1 现状

- Agent Ops 已完成从 `agent-dev` 的迁移，具备 Task/Run、worktree 隔离、diff/日志/退出码证据、SSE 实时输出、取消、人审 accept/reject、MCP 工具链。
- 现有 `AgentProfile` 已经支持“同一个 Agent 派生多个配置”：`name + baseAgentId + systemPrompt + model + allowedTools/blockedTools + env`。
- 现有 `FeatureTaskPipeline` 已经支持“每个 step 绑定一个 Profile”的串行多角色流水线，但目前只在 `webapp-delivery` 插件内使用，内核任务板没有暴露。
- 现有 `AGENT_ADAPTERS` 已支持 Codex、OpenCode、CodeBuddy、Hermes 为 `verified`，Claude Code、Aider、OpenClaw 为 `candidate`；Pi 没有 adapter。

### 1.2 用户问题

用户希望：

1. 用自己本机的 Agent，而不是被平台绑定的托管 Agent。
2. 同一个 Agent 可以扮演多个角色，例如实现者、审查者、测试者。
3. 不同角色可以来自不同 Agent，例如 Codex 实现、Claude Code 架构、Hermes 调研。
4. 角色之间可以交接，任务可以被派给某个角色，产出可审、可追、可复用。
5. 后续可以组成团队并行工作，而不是只有一个“万能 Agent”聊天。

### 1.3 市场参照与边界

| 产品 | 借鉴 | 不照搬 |
|---|---|---|
| Multica | issue/任务板、角色化小队、skill 沉淀、人审 | 多租户、云工作区、29 家 adapter 的广度 |
| T3 Code | thread → worktree、本地 server、多客户端 | 桌面/移动多端、ACP 全量接入 |
| Orca | coordinator → worker、并行 worktree、任意 CLI | 云 VM、IDE 式重客户端、实验性 fan-out 全量 |

Agent Ops 的差异化：**本地优先 + BYO 订阅 + 角色/团队模型 + 证据链 + 人审闸门**。

---

## 2. 目标与非目标

### 2.1 产品目标

| ID | 目标 | 说明 |
|---|---|---|
| G1 | Role 成为一等概念 | 角色有职责、提示词、工具权限、Runtime 策略、验收标准 |
| G2 | 同一个 Agent 可派生多个角色 | 同一 `baseAgentId`，不同 prompt/tool policy，独立会话 |
| G3 | 不同 Agent 可进入同一团队 | Codex/Claude/OpenCode/Hermes/Pi/DSH/自有 Harness 统一 adapter |
| G4 | 任务可派给角色并交接 | Task → Role → Run → Handoff，产物可审计 |
| G5 | 角色权限可执行 | `allowedTools/blockedTools` 不只声明，要进入实际执行路径 |
| G6 | 人审闭环不丢改动 | accept 落 commit；reject 清理 worktree；release 有保护 |
| G7 | 单机可运营 | 单人、本地 SQLite、无云依赖、崩溃可恢复 |

### 2.2 本期不做

见 §12。核心原则：**先把“单机多角色串行”做稳，再谈并行团队、多用户、云端和全量 adapter。**

### 2.3 成功指标

首版以“可用、可审、不丢改动”为主，不以规模为目标。

| 指标 | 目标 |
|---|---|
| 角色覆盖 | 同一 Codex 至少 3 个角色；至少 1 个 Claude 角色、1 个 Hermes 角色 |
| 任务闭环 | 3–5 个真实仓库任务完成 Task→Role→Run→Review→Accept |
| 证据完整 | 100% Run 有 role、runtime、worktree、diff、exit code、commit（如适用） |
| 权限违规 | 审查者/只读角色的写操作 = 0 |
| 数据丢失 | accept 后 release 丢改动 = 0 |
| 人工返工 | 首版观察 diff 接受率、测试通过率、返工率，不设硬门槛 |

---

## 3. 用户与场景

### 3.1 目标用户

单人开发者/产品负责人，本机已安装多个 Agent CLI，使用自己的订阅与账号，希望把“多个 Agent”组织成可重复的工作方式，而不是每次手工开终端。

### 3.2 核心场景

| ID | 场景 | 验收焦点 |
|---|---|---|
| S1 | 同一 Codex 派生实现者、审查者、测试者 | 独立 prompt/工具权限/会话；审查者不能写 |
| S2 | Codex 实现 + Claude Code 架构 + Hermes 调研 | 不同 runtime 进入同一任务；统一证据 |
| S3 | 任务串行交接：架构 → 实现 → 审查 → 测试 | 每步产物/commit 可追溯；失败可暂停/重跑 |
| S4 | 人审：看 diff、逐文件接受/拒绝、accept/reject | 不自动 merge；accept 落 commit |
| S5 | 后续团队并行：多个角色独立 worktree，coordinator 汇总 | v0.3；有界并发；冲突可见 |

---

## 4. 术语与产品模型

### 4.1 术语

| 术语 | 含义 | 与现有代码的关系 |
|---|---|---|
| Agent | 本机安装的 CLI Agent，如 Codex、Claude Code、Hermes | `AGENT_ADAPTERS` 的 key |
| Runtime | Agent 的执行适配器/能力描述 | `AgentAdapter` + `catalog.ts` |
| Profile | 某个 Runtime 上的一组配置覆盖 | `AgentProfile`，当前已存在 |
| Role | 产品级“岗位”：职责 + 提示词 + 工具权限 + Runtime 策略 + 验收标准 | 新增；可引用一个或多个 Profile |
| Team | 一组 Role + 交接规则 + 审批 gate | 新增 |
| Assignment | Task 派给 Role | 新增 |
| Handoff | 上游 Role 把产物交给下游 Role | 新增；以 commit/artifact 为单位 |
| Run | 一次角色执行 | 现有 `RunRecord` 扩展 role/runtime/commit |
| Evidence | 运行证据：stdout/stderr/diff/测试/commit/成本 | 现有 `RunArtifacts` 扩展 |

### 4.2 Role 模型

Role 是产品概念，Profile 是 Runtime 绑定。一个 Role 可以：

- 绑定一个首选 Runtime，并配置备选 Runtime；
- 在同一个 Runtime 上使用不同 systemPrompt / tools / model；
- 有默认验收标准，Task 可以覆盖；
- 有成本/并发预算（v0.3 起）。

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 稳定标识，小写字母/数字/连字符 |
| `name` | 是 | 显示名，如“前端实现者” |
| `responsibility` | 是 | 一句话职责，用于团队视图和派活 |
| `systemPrompt` | 是 | 角色行为约束 |
| `allowedTools` | 否 | 允许使用的工具；进入实际命令/策略 |
| `blockedTools` | 否 | 显式禁止；优先级高于 allowed |
| `runtimePolicy.preferred` | 是 | 首选 Runtime，如 `codex` |
| `runtimePolicy.fallbacks` | 否 | 备选 Runtime 列表；v0.2 仅手动切换 |
| `model` | 否 | 模型偏好；不同 Runtime 可不同 |
| `acceptanceCriteria` | 否 | 角色默认验收标准；Task 可覆盖 |
| `costBudget` | 否 | v0.3：token/USD 上限 |
| `icon/color` | 否 | 团队视图标识 |

### 4.3 Team 模型

| 字段 | 说明 |
|---|---|
| `roles` | 团队包含的 Role 列表 |
| `handoffRules` | `fromRole → toRole`，触发条件、交付物、是否需审批 |
| `approvalGates` | 哪些步骤必须人工确认 |
| `defaultRuntimePolicy` | 团队级默认；Role 可覆盖 |
| `concurrency` | v0.3：最大并行角色数；v0.2 固定串行 |

### 4.4 兼容策略

- 保留 `AgentProfile`，不立即重命名，避免破坏现有 API/Studio。
- 新增 `Role` 作为产品层；Role 可以引用一个 `profileId`，也可以内联配置。
- UI 先展示 Role；底层仍可落到 Profile，渐进迁移。
- 现有 `FeatureTaskPipeline` 的 `profileId` 保持兼容；新增 `roleId` 为可选字段。

---

## 5. 核心流程

### 5.1 单角色任务

```text
创建 Task（标题/目标/仓库/验收标准/优先级）
  → 选择 Role
  → Provision worktree
  → Run（Role 的 Runtime + Profile）
  → 证据落库（diff/日志/测试/exit code）
  → 人工 Review
  → Accept（commit + 记录 SHA） / Reject（reset + 回 queued）
  → Release（有未提交改动则拒绝）
```

### 5.2 串行多角色（v0.2）

```text
Task
  → Step 1: 架构 Role → 产物/commit
  → Step 2: 实现 Role → 产物/commit
  → Step 3: 审查 Role（只读）→ 审查报告
  → Step 4: 测试 Role → 测试报告/commit
  → 人工最终 Accept
```

规则：

- 同一个 Task 默认一个 worktree，串行执行；每步成功后 commit，下一步基于上一步 commit。
- 每步可有 `requiresApproval`；未批准则暂停。
- 失败可重跑当前 step；重跑前 reset 到该 step 的 base commit。
- 最终 accept 只记录最后 commit SHA 并置 done，不自动 merge/push。

### 5.3 并行团队（v0.3）

```text
Coordinator Role
  → 拆子任务
  → 分配给多个 Role（各自独立 worktree）
  → 并行执行（有界并发）
  → Coordinator 汇总/冲突检查
  → 人工审批
```

规则：

- 并行角色必须独立 worktree，禁止共享同一工作目录。
- 冲突由 Coordinator 或人审处理；不做自动 merge。
- 并发上限、仓库锁、资源预算在 v0.3 实现。

### 5.4 Commit / Reset 语义

| 场景 | 何时 commit | 谁 commit | Accept 做什么 |
|---|---|---|---|
| 单 Run 任务 | 人审通过后 | 系统 | 在 worktree commit，记录 SHA |
| 串行 Pipeline step | 每步成功后 | 系统 | 最终 accept 记录最后 SHA，不再重复 commit |
| Reject（单 Run） | 不 commit | 系统 | reset + clean 到 task base |
| Reject（Pipeline step） | 不 commit | 系统 | reset 到该 step base，回到 pending |
| Release | 不 commit | 系统 | 有未提交改动则拒绝 release |

安全要求：

- commit 前检查 `.env` / `.env.*` 与指向 workspace 外的软链，避免把密钥/死链提交进仓库。
- commit 使用独立本地身份（如 `agent-ops@localhost`），不冒用用户 git 身份。
- 不自动 push、不自动开 PR、不自动 merge。

---

## 6. 功能需求

优先级：P0 = v0.2 必须；P1 = v0.2/v0.3 应该；P2 = v0.3/v0.4 可选。

### 6.1 Role 与 Runtime

| ID | 优先级 | 需求 | 验收 |
|---|---|---|---|
| FR-1.1 | P0 | Role CRUD（API + CLI/MCP） | 可创建/编辑/删除/列出角色；字段校验；同名冲突处理 |
| FR-1.2 | P0 | 同一 Agent 多角色 | 同一 `baseAgentId` 创建 3 个角色，prompt/tools 独立 |
| FR-1.3 | P0 | 不同 Agent 多角色 | Codex/Claude/OpenCode/Hermes 角色可在同一团队 |
| FR-1.4 | P0 | `runtimePolicy` | preferred/fallbacks 可配置；v0.2 手动切换，不自动降级 |
| FR-1.5 | P1 | Role 模板 | 内置实现/审查/测试/架构/调研模板；可复制 |
| FR-1.6 | P1 | Role 测试运行 | 不建 Task 也能用 dry-run/小任务验证角色配置 |

### 6.2 Runtime Registry

| ID | 优先级 | 需求 | 验收 |
|---|---|---|---|
| FR-2.1 | P0 | Adapter registry 替代硬编码 | 新增 adapter 不改内核 switch；能力矩阵可查询 |
| FR-2.2 | P0 | 能力矩阵 | 至少描述：非交互、流式、结构化输出、会话恢复、工具策略、worktree 安全 |
| FR-2.3 | P1 | 健康/版本/登录探测 | `doctor` 能显示每个 Runtime 的版本、auth hint、可用状态 |
| FR-2.4 | P1 | 启动超时与错误提示 | OpenCode 等启动慢的 Runtime 有 preflight/timeout/明确错误 |
| FR-2.5 | P2 | Adapter SDK | 自有 Harness/第三方按接口接入，不污染内核 |

### 6.3 工具权限（Policy）

| ID | 优先级 | 需求 | 验收 |
|---|---|---|---|
| FR-3.1 | P0 | `allowedTools/blockedTools` 进入执行路径 | Claude 映射 `--allowedTools`；Codex 映射 sandbox/config；不支持的原生能力标 `policy: wrapper/unsupported` |
| FR-3.2 | P0 | 只读角色不可写 | 审查者角色跑完，worktree 无新增/修改文件；测试断言 |
| FR-3.3 | P0 | Hermes `--yolo` 风险收敛 | 受限角色不使用全放行；或加 policy wrapper；文档标注能力差异 |
| FR-3.4 | P1 | 工具调用审计 | Run 记录实际工具调用/拒绝原因（能拿到就记，拿不到标 unknown） |
| FR-3.5 | P2 | 跨 Runtime 统一策略层 | 统一 allow/deny/approval，不依赖各 CLI 方言 |

### 6.4 Task / Run 模型

| ID | 优先级 | 需求 | 验收 |
|---|---|---|---|
| FR-4.1 | P0 | Task 增加 `priority`、`acceptanceCriteria` | 创建/编辑/详情可见；prompt 注入；review 可逐条勾选 |
| FR-4.2 | P0 | Task 增加 `roleId` / `teamId` | 派活到角色/团队；Run 继承 role |
| FR-4.3 | P0 | Run 增加 `roleId`、`runtimeId`、`commitSha` | 证据里可查；旧 Run 兼容 null |
| FR-4.4 | P1 | Run 增加 agent 版本、实际命令、token/cost | 能拿到就记；拿不到 `unknown`；不伪造 |
| FR-4.5 | P1 | Run 重跑 hygiene | reject 后 reset/clean；重跑不继承上一轮文件 |
| FR-4.6 | P2 | 成本预算 | Role/Team 级 token/USD 上限；超限阻断或告警 |

### 6.5 Team / Assignment / Handoff

| ID | 优先级 | 需求 | 验收 |
|---|---|---|---|
| FR-5.1 | P1 | Team CRUD | 创建团队、加角色、设交接规则/审批 gate |
| FR-5.2 | P1 | Task 派给 Role/Team | 手动派活；团队视图可见 |
| FR-5.3 | P1 | Handoff | 上游产物/commit 交给下游；交接记录可查 |
| FR-5.4 | P1 | 团队视图 | 花名册、角色状态、任务队列、卡点 |
| FR-5.5 | P2 | Coordinator Role | 自动拆任务/派活/汇总；人工只保留审批 |
| FR-5.6 | P2 | 并行团队 | 多角色独立 worktree；有界并发；冲突可见 |

### 6.6 串行 Pipeline（内核）

| ID | 优先级 | 需求 | 验收 |
|---|---|---|---|
| FR-6.1 | P0 | Pipeline 模型进内核 | Task 可有 steps；每步 `roleId`/`profileId` |
| FR-6.2 | P0 | 串行执行 + 每步 commit | 上一步成功才进下一步；commit SHA 记录 |
| FR-6.3 | P1 | 每步人工审批 | `requiresApproval` 可暂停/恢复 |
| FR-6.4 | P1 | 失败重跑 | 重置到 step base；不污染下游 |
| FR-6.5 | P2 | 并行 DAG | 非串行依赖；v0.3 以后 |

### 6.7 Studio UI

| ID | 优先级 | 需求 | 验收 |
|---|---|---|---|
| FR-7.1 | P1 | 任务创建/编辑 | UI 可建 Task、选 Role、填验收标准/优先级 |
| FR-7.2 | P1 | 角色/团队页 | 角色卡、Runtime、工具权限、团队交接图 |
| FR-7.3 | P1 | 逐文件接受/拒绝 | diff 文件级勾选；部分接受生成 patch/commit |
| FR-7.4 | P1 | Run 详情 | 显示 role/runtime/version/command/worktree/commit/cost |
| FR-7.5 | P2 | 团队看板 | 花名册/任务队列/卡点/成本 |

### 6.8 证据与审计

| ID | 优先级 | 需求 | 验收 |
|---|---|---|---|
| FR-8.1 | P0 | 证据扩展 | role/runtime/commit 进 RunArtifacts/RunRecord |
| FR-8.2 | P1 | 审计事件 | 角色创建/派活/交接/accept/reject 可回放 |
| FR-8.3 | P1 | 证据导出 | 单任务导出 diff/日志/测试/commit/成本 |
| FR-8.4 | P2 | 指标 | 成功率、返工率、成本、时长；接 observability |

### 6.9 Adapter 支持面

| ID | 优先级 | Runtime | 目标 |
|---|---|---|---|
| FR-9.1 | P0 | Codex | 保持 verified；真实写任务 E2E |
| FR-9.2 | P0 | Claude Code | 登录后从 candidate 升 verified；工具策略生效 |
| FR-9.3 | P0 | OpenCode | 修启动稳定性；真实写任务 E2E |
| FR-9.4 | P0 | Hermes | 保持 verified；限制 `--yolo` 使用面 |
| FR-9.5 | P2 | Pi | 实验 adapter；先只读/小任务 |
| FR-9.6 | P2 | DeepSeek Harness | 实验 adapter；能力矩阵标注 |
| FR-9.7 | P2 | 自有 Harness | 实验 adapter；要求非交互 CLI 或本地 JSON 接口 |
| FR-9.8 | P2 | Aider/OpenClaw | 暂不投入；保持 candidate，不阻塞主线 |

---

## 7. 非功能需求

| 类别 | 要求 |
|---|---|
| 本地优先 | 默认 localhost、SQLite、无云依赖；不读取用户密码/浏览器会话 |
| 单用户 | v0.2/v0.3 单机单用户；不做真人席位/权限/组织 |
| 安全 | worktree 隔离；`.env`/软链 commit 防护；工具权限；不自动 push/merge |
| 可靠性 | Run 终态落库后再发事件；daemon 重启可回放；有界输出 |
| 兼容 | 旧 Task/Run/Profile API 保持；新增字段可空；旧 Studio 不崩 |
| 性能 | 单机 1–3 并发（v0.3）；单 Run 输出/事件有上限；不阻塞 UI |
| 可观测 | 每次 Run 有 role/runtime/exit code/duration/diff；能拿到的成本不丢 |

---

## 8. 里程碑

> 以下为建议窗口，按实际评审/登录/狗粮结果调整；里程碑以“可验收产物”为单位，不以日期为硬承诺。

| 里程碑 | 建议窗口 | 范围 | 退出标准 |
|---|---|---|---|
| **M0 基础闭环** | 2026-11-20 → 2026-11-26 | accept commit、release guard、reject reset、Task 验收标准/优先级、Run commit 证据 | 不丢改动；prompt 含验收标准；重跑干净；测试绿 |
| **M1 角色与串行** | 2026-11-27 → 2026-12-10 | Role CRUD、Runtime Registry、工具权限、内核串行 Pipeline、Studio 任务创建 | 同一 Codex 3 角色 + Claude/Hermes 角色；串行 4 步跑通；审查者只读 |
| **M2 团队与狗粮** | 2026-12-11 → 2026-12-24 | Team/Assignment/Handoff、逐文件审、团队视图、3–5 dogfood | 5 角色团队完成真实任务；证据完整；dogfood 报告 |
| **M3 并行与扩展** | 2026-12-25 → 2027-01-14 | 并行 worktree、Coordinator、Pi/DSH/自有 Harness 实验、成本 | 3 角色并行；冲突可见；实验 adapter 可跑小任务 |
| **M4 稳定与发布** | 2027-01-15 → 2027-01-21 | 文档同步、指标、打包、回归 | 文档无漂移；全门禁绿；可日常使用 |

---

## 9. 验收标准

### 9.1 产品级验收（v0.2）

| ID | 验收 | 判定 |
|---|---|---|
| A1 | 同一 Codex 派生 3 个角色：实现者、审查者、测试者 | 三个角色有独立 prompt/tools；同一任务可依次运行 |
| A2 | 跨 Agent 角色 | 至少 1 个 Claude Code 架构角色、1 个 Hermes 调研角色参与同一任务 |
| A3 | 串行交接 | 架构 → 实现 → 审查 → 测试；每步有产物/commit；失败可暂停/重跑 |
| A4 | 权限 | 审查者角色运行后 worktree 无写改动；越权工具被拒绝 |
| A5 | 人审 | diff 可读；可 accept/reject；逐文件接受至少可用 |
| A6 | 不丢改动 | accept 后有 commit SHA；release 有未提交改动时拒绝 |
| A7 | 证据 | 每个 Run 有 role/runtime/worktree/diff/exit code/duration；旧 Run 兼容 |
| A8 | 真实狗粮 | 3–5 个真实仓库任务完成闭环；记录接受率/测试通过率/返工率 |

### 9.2 里程碑验收

| 里程碑 | 验收 |
|---|---|
| M0 | Given 一个带验收标准的 Task，When Run 完成，Then prompt 含该标准；When accept，Then 生成 commit 并记录 SHA；When release 有脏文件，Then 拒绝；When reject 后重跑，Then 无上一轮残留 |
| M1 | Given 3 个同 Agent 角色 + Claude/Hermes 角色，When 串行执行，Then 每步使用正确 Role/Profile/Runtime，审查者无写操作，最终有完整证据 |
| M2 | Given 一个 5 角色 Team，When 派发真实任务并交接，Then 任务队列/卡点可见，逐文件审可用，3–5 个 dogfood 有报告 |
| M3 | Given 3 个并行角色，When 各自独立 worktree 执行，Then 冲突可见、有界并发、Coordinator 可汇总，实验 adapter 可跑小任务 |
| M4 | 全仓 typecheck 0、测试绿、Studio build 成功、文档与代码一致、无 P0 数据丢失缺陷 |

### 9.3 质量门禁

- `npm run typecheck` 0 错误。
- `npm test` 全绿；新增功能必须有单元/集成测试。
- Studio `tsc + vite build` 成功（涉及 UI 时）。
- 真实模型 E2E 至少 1 条；不能用确定性 runner 替代验收。
- 安全测试：`.env` 不入 commit、外部软链不入 commit、只读角色不能写。
- 文档：PRD/拆解/handoff 三处状态一致，不双写活跃待办。

---

## 10. 风险与依赖

| 风险/依赖 | 影响 | 应对 |
|---|---|---|
| Claude Code 未登录 | Claude 角色不可用 | owner 先 `/login`；adapter 保持 candidate，不伪造 verified |
| OpenCode 启动慢/无产出 | 真实 Run 阻塞 | preflight + timeout + 明确错误；必要时降级到其他 Runtime |
| 工具权限各 CLI 方言不同 | 角色权限无法统一 | 能力矩阵标注 native/wrapper/unsupported；不承诺“全 Runtime 同等权限” |
| 同一 Agent 多角色会话污染 | 角色行为串味 | 每角色独立进程/会话；禁止共享 conversation；测试隔离 |
| worktree 冲突 | 并行团队互相踩文件 | v0.2 串行；v0.3 独立 worktree + 仓库锁/有界并发 |
| accept 不 commit | 数据丢失 | M0 必须先修；复用现有 `commitAgentChanges` 防护 |
| 成本数据不完整 | 无法准确计费 | 能拿到的记，拿不到 `unknown`；不伪造 |
| 范围膨胀 | 做成 Multica 克隆 | 按 PRD 非目标表拒绝；先串行后并行 |

外部依赖：

- D5：单机单用户（默认已按此实现，仍待 owner 确认）。
- D7：Agent 支持节奏；建议“4 稳定 + 3 实验”（Codex/Claude/OpenCode/Hermes；Pi/DSH/自有 Harness 实验）。
- D7-gate：Claude Code 登录。
- model-hub：后续成本/模型路由；本期不阻塞。

---

## 11. 决策记录

| ID | 决策 | 结论 | 状态 |
|---|---|---|---|
| PD-1 | 是否新开产品 | 否；Agent Ops 升级 | 建议 |
| PD-2 | 先串行还是先并行 | 先串行角色流水线，再并行团队 | 建议 |
| PD-3 | Role 与 Profile 关系 | Role 是产品概念，Profile 是 Runtime 绑定；兼容共存 | 建议 |
| PD-4 | accept 语义 | accept = commit + 记录 SHA；不 push/merge | 建议 |
| PD-5 | 支持面 | Codex/Claude/OpenCode/Hermes 稳定；Pi/DSH/自有 Harness 实验 | 建议，待 D7 |
| PD-6 | 单用户 | v0.2/v0.3 单机单用户 | 建议，待 D5 |
| PD-7 | 自动 merge | 永不做自动 merge；只做显式人工动作 | 建议 |
| PD-8 | 团队并行 | v0.3 起；每角色独立 worktree | 建议 |

---

## 12. 当前不做（Parking Lot）

> 这些不是“永远不做”，而是**当前 v0.2 不做**；标 v0.3 的项在 M3 才重新评估，后续满足触发条件再单独立项/评审。

| 不做项 | 为什么现在不做 | 重新考虑的触发条件 |
|---|---|---|
| 多用户/真人席位/权限/组织 | 目标是单人 + 一群 Agent；多人会引入权限/共享/审计复杂度 | 需要第二个人共享看板/审批时 |
| 云端执行/远程 daemon | 本地 Agent、本地订阅、本地文件是核心优势 | 本机不能常开，或需要移动端触发时 |
| 桌面/移动客户端 | Web + localhost 已够用；多端是重投入 | 日常使用需要通知/手机审批时 |
| 29+ adapter 全量接入 | 广度会稀释稳定性；先 4 稳定 + 3 实验 | 4 个稳定 adapter 狗粮通过后 |
| Tier 0 产品能力包（B 模式） | 先把 Agent Ops 自身闭环做稳；跨产品调用需要契约、权限、成本和版本治理 | Agent Ops v0.3 稳定 + 至少 1 个 Tier 0 产品有稳定 CLI/API/MCP + 能力包契约评审通过 |
| 完整 IDE/终端/浏览器 | 不是控制面职责；会变成 Orca 重客户端 | 用户明确需要内置编辑/终端时 |
| 自动 merge/push/PR | 人审闸门是产品边界；自动合并风险高 | 不做；最多做“一键创建 PR”显式动作 |
| 自研 harness / 模型推理 | Agent Ops 管执行，不做执行引擎；先验证外部 Runtime 是否足够 | Adapter 契约稳定 + 3 个外部 Runtime 狗粮通过 + 现有 Harness 无法表达角色/团队语义 + 接受长期维护 |
| 角色长期记忆/技能库 | 先解决角色/团队/证据；记忆是下一层 | v0.4，角色/团队稳定后 |
| Personal Agent Harness（含 Personal Host） | 先做工作控制面；个人 Harness 需要记忆、触发器、连接器、移动端和消费级审批 UX | v0.4 探索；至少 1 个 local-first Personal Agent Harness spike 通过 |
| Coordinator 自动派活 | 先手动派活，验证角色边界 | v0.3，串行 handoff 狗粮通过后 |
| 并行多 worktree | 先串行，避免冲突/资源问题 | v0.3，worktree 冲突测试通过后 |
| 成本预算/计费 | 先有证据，再谈预算；依赖 model-hub | model-hub usage 可按 role/task 归集时 |
| ACP/MCP 全协议 | 先 CLI 非交互；协议接入是扩展 | 有明确外部客户端需求时 |
| 插件市场/团队模板市场 | 先内置模板；市场需要治理 | 有第三方 adapter/模板贡献时 |
| 企业 SSO/多租户 | 与单机单用户定位冲突 | 产品转向团队版时 |

### 12.1 后续方向备忘：控制面 / 能力包 / 自有 Harness

> 本段是方向备忘，不改变 PD-1～PD-8，也不代表已立项；用于后续排迭代时判断“先做什么、后做什么”。

**一句话：Agent Ops 做控制面，Tier 0 产品做能力包，Harness 做可替换执行器。**

#### 三层边界

| 层 | 职责 | 不做什么 |
|---|---|---|
| Agent Ops Core | Task / Run / Role / Team / Policy / Evidence | 不做模型推理，不做 IDE/终端 |
| Runtime Adapter | 把 prompt 跑成一次执行；统一 detect / execute / cancel / evidence | 不做任务板、角色、审批 |
| Capability Pack | 把 Tier 0 产品能力暴露为 CLI / HTTP / MCP | 不把产品内部实现 import 进核心 |

这条边界的目的：Agent Ops 加多少 Agent、多少产品，都不会把核心撑成一个大单体。

#### Tier 0 产品接入：先 A 后 B

| 模式 | 含义 | 时点 |
|---|---|---|
| **A. 管理开发任务** | Agent Ops 在 Tier 0 产品各自仓库开 Task/Run/worktree，审 diff、验收 | **现在就能做**；纳入 M2 的 3–5 个 dogfood |
| **B. 当能力调用** | 一个 Role 调用某个 Tier 0 产品的 CLI/API/MCP 来完成一件事 | **后置**；v0.3 稳定后先选 **1 个**产品试点，不一次性全接 |

B 模式不直接集成产品代码，而是先定 **Capability Pack 契约**：

- `manifest`：能力名、版本、owner、入口类型（CLI / HTTP / MCP）。
- `io`：输入/输出 schema、错误码。
- `permissions`：文件系统、网络、环境变量、凭据的最小权限。
- `limits`：超时、取消、重试、幂等。
- `evidence`：stdout/stderr、artifacts、exit code。
- `cost`：时间/ token / 费用估算。
- `health`：版本探测与可用性检查。

这样产品迭代只影响能力包，不影响 Agent Ops 内核。

#### 自有 Harness：可选 Runtime Adapter

定位：**自有 Harness 是 Agent Ops 的一个可选 Runtime Adapter，独立仓/独立版本，不是 `agent-ops` 核心的一部分。**

现在不做的原因：

- Codex / Claude Code / OpenCode / Hermes / DSH / Pi 仍在快速迭代，自研容易变成追版本。
- DSH 是“一切皆插件”，Pi 是“薄内核 + 扩展”，两种哲学；基于它们做自有 Harness，应选一条 lineage，不要同时继承两套抽象。
- fork 前要先做许可证、商用边界、上游治理和升级路径评估；能做 adapter/plugin 就不要 fork。

重新考虑的触发条件：

1. Adapter 契约稳定，且至少 3 个外部 Runtime 已接入并狗粮通过。
2. 现有 Harness 确实表达不了 Role/Team 语义（如角色权限、上下文隔离、handoff）。
3. 需要本地优先的权限、证据、上下文隔离，外部 Harness 给不了。
4. 接受长期维护成本和上游跟踪成本，而不只是“想试试”。

#### 建议顺序

1. **v0.2**：Agent Ops 做 Role + 串行 Pipeline；用 A 模式管理 Tier 0 产品开发任务。
2. **v0.3**：Team / 并行稳定后，选 1 个 Tier 0 产品做 B 模式能力包试点。
3. **并行观察**：DSH / Pi 作为实验 Runtime 接入，验证“同一角色可换 Runtime”。
4. **最后**：满足上述四条触发条件后，再单独立项自有 Harness。

### 12.2 Personal Agent：一种个人 Harness，不是第二套内核

> 这是相邻赛道备忘，不是 v0.2/v0.3 承诺，也不改变 PD-1～PD-8。跨产品讨论见 [Tier0-个人上下文层与PersonalAgent-讨论备忘-2026-11-19.md](../../../bayjf/docs/tier0/Tier0-个人上下文层与PersonalAgent-讨论备忘-2026-11-19.md)。

**一句话：Personal Agent 是一种 personal-purpose Harness，和 Codex / Pi Agent / Claude Code / Hermes / DSH 同一层；它以你为 principal，把 LLM 变成代表你行事的 Agent。LLM 是大脑，Harness 是身体/神经系统，Host 是入口，Agent Ops 是管理多个 Harness 的控制面。**

#### 和 Agent Ops 的关系

| | Agent Ops | Personal Agent（Harness） |
|---|---|---|
| 层 | 控制面 | 运行时 / Harness |
| 职责 | 管理多个 Harness/Agent：Task / Run / Role / Team / Evidence | 以你为 principal 的 Agent loop：context / tools / memory / permissions |
| 工作单元 | Task / Run / Role / Team | 目标 / 情景 / 触发 / 审批 |
| 护城河 | 执行、证据、审批、Adapter | 人格、记忆、上下文、信任 |
| 交互形态 | 本地 Web 控制台 | Chat / Inbox / 手机（Host） |
| 风险 | 改错代码 | 办错事、发错消息、付错钱 |

#### Harness 分层

```text
LLM（大脑）
  └─ Harness（身体 / 神经系统）
       ├─ Codex
       ├─ Pi Agent
       ├─ Claude Code
       ├─ Hermes
       └─ Personal Agent（以你为 principal）
            └─ Host（入口 / 外壳）

Agent Ops（控制面）──管理──▶ Harness / Agent
Work Learn / Zeus DataDomain（记忆 / 数据服务）
```

所以 Personal Agent 不是“Codex 里的一种 agent”，也不是“Pi 上的一个实例”；它和 Codex/Pi 是同一层，区别在 principal、目标、记忆、权限和 loop。

Personal Agent Harness 自带或外接 Host；具体是 Studio 的第二视图还是独立前端，v0.4 再定。Agent Ops 管理它，复用 Adapter 和 Evidence；但 Agent Ops 本身不是 Harness。

#### 现在不做

- v0.2/v0.3 不引入 Personal Agent Harness。它会强制引入记忆、触发器、连接器、移动端和消费级审批 UX，直接摊薄角色/团队主线。
- 不把 Personal Agent Harness 当成“聊天框”；它的核心是“它做完了，等你批”的收件箱体验。
- 不把个人数据、账号、支付能力放进当前单用户工作控制面；先保持边界。

#### v0.4 探索 Personal Agent Harness：2 周 spike

- 3 个角色：Chief of Staff / Researcher / Operator。
- 3 个只读连接器：日历、邮件、浏览器。
- 所有写操作进审批 Inbox；本机优先，数据不出机器。
- 同一套个人上下文 / 权限可挂到不同 Harness（Codex / Pi / Claude Code / Hermes）；v0.4 先做其中一个。
- 先用 20 个真实个人任务验证，不承诺产品化。

验收只看三件事：**能不能持续记住、能不能主动触发、能不能安全地等你批。**

#### 需要继续讨论的问题

1. Personal Agent Harness 是独立实现，还是基于 Codex / Pi 改？建议先做独立薄 Harness，借鉴它们的工具/模型适配经验，不 fork。
2. 记忆/数据放哪：Zeus DataDomain / Work Learn SQLite / 新 store；如何导出、删除、审计。
3. 触发器怎么接：cron、邮件、日历、文件变化、Webhook；先借 Hermes 的 cron 思路，不搬它的消息平台。
4. 权限怎么真正落地：读可以、写要批、付款绝对要批；`allowedTools/blockedTools` 必须进入实际执行命令。
5. 前台是 Chat 还是 Inbox：建议 Approval Inbox + Task Board，不做纯聊天壳。

---

## 13. 外部借鉴结论

| 来源 | 采用 | 否决/后置 |
|---|---|---|
| Multica | 任务板、角色小队、skill 沉淀、人审 | 多租户、云工作区、全量 adapter |
| T3 Code | thread→worktree、本地 server、多客户端思路 | 桌面/移动多端、ACP 全量 |
| Orca | coordinator→worker、并行 worktree、任意 CLI | 云 VM、IDE 重客户端、fan-out 全量 |
| DeepSeek Harness | 插件接口思想、能力矩阵 | Cordis 运行时、全插件化重构 |
| Pi | 薄内核、子 Agent 隔离、TEAM/PLAN/PIPELINE 参照 | pi-ai/pi-agent-core 依赖 |
| Hermes | 持久记忆、技能闭环、cron、子 Agent、轨迹 | 20+ 消息平台、全自动技能创建 |

---

## 14. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-11-19 | 初稿：确立 Agent Ops 多角色/团队方向；v0.2 串行、v0.3 并行；列出非目标与验收 |
| 2026-11-19 | 补充 §12.1 后续方向备忘：控制面 / 能力包 / 自有 Harness 三层；明确自有 Harness 是可选 Runtime Adapter，未立项 |
| 2026-11-19 | 补充 §12.2 Personal Agent 方向备忘：Personal Agent 是一种 personal-purpose Harness，与 Codex / Pi / Claude Code / Hermes / DSH 同层；Agent Ops 是控制面；v0.4 两周 spike |
