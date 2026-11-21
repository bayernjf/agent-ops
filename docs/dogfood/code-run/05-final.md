# 05-final.md — CB Code Owner 最终交付

Dogfood 8：五角色代码交付。最终交付物由 CB Code Owner 汇总：新增 API、所在位置、测试结果，以及本步对上游产物的最小修正。

## 新增 API

- **方法**：`KernelStore.listTasksByTeam(teamId: string): TaskRecord[]`
- **位置**：`packages/storage-core/src/index.ts:894-897`，紧接 `listTasks()` 之后。
- **实现**：`this.kernelOrm.select().from(tasks).where(eq(tasks.teamId, teamId)).all()`，再 `map(toTaskRecord)`。复用既有 `eq`、`tasks`、`TaskRow`、`toTaskRecord`，无新依赖、无迁移、同步只读（与 `listTasks()` 同构，不触发 `persist`）。
- **口径**：`teamId` 精确 `eq` 过滤；未分配任务在 `tasks` 表以 `''` 存储，`toTaskRecord` 已把 `''` 归一为 `null`，因此天然排除未分配任务与其它 Team。

## 单元测试

- **位置**：`packages/storage-core/test/task-run.test.ts:176-199`，`it('lists tasks by team and excludes other teams', ...)`。
- **覆盖**：建两个 Team（Alpha / Beta）+ 一个未分配任务，断言 `listTasksByTeam(teamA.id)` 仅返回 Team A 的两条、排除 Team B 与未分配任务，并对未知 `teamId` 返回空数组。

## 测试结果（本步实测）

```
 RUN  v4.1.12 .../work

 ✓ packages/storage-core/test/task-run.test.ts (9 tests) 96ms

 Test Files  1 passed (1)
      Tests  9 passed (9)
```

- `npx vitest run packages/storage-core/test/task-run.test.ts` → **9/9 通过**（含新增用例）。
- `npm run typecheck -w @agent-ops/storage-core` → **通过**，无类型错误。

## 本步（CB Code Owner）对上游产物的修正

上游 implementer 严格按 01-plan 落地，生产代码正确、测试通过。03-review 发现一处测试质量缺陷：`expect(ids).not.toContain('B1')` 用标题字符串 `'B1'` 与 UUID 列表比较，属恒真断言，无法真正自证「排除 Team B」；另有中文注释 `// 未分配` 与全英文测试不一致。

本步做了最小修正（仅 `packages/storage-core/test/task-run.test.ts`）：

1. 捕获 `b1`（Team B 任务）与 `unassigned`（未分配任务）的返回值。
2. 将 `expect(ids).not.toContain('B1')` 改为 `expect(ids).not.toContain(b1.id)`，并新增 `expect(ids).not.toContain(unassigned.id)`，使「排除其它 Team 与未分配任务」的断言非恒真、可自证。
3. 注释 `// 未分配` → `// unassigned`。

修正后重跑测试与 typecheck，均通过（见上）。

## 改动文件汇总

| 文件 | 改动 | 角色 |
| --- | --- | --- |
| `packages/storage-core/src/index.ts` | +5：新增 `listTasksByTeam` | implementer（已提交于 `018ea48`） |
| `packages/storage-core/test/task-run.test.ts` | +24：新增用例；本步 +2/-2 修正恒真断言与注释 | implementer + owner |
| `docs/dogfood/code-run/01-plan.md` | 计划 | architect |
| `docs/dogfood/code-run/03-review.md` | 评审 | reviewer |
| `docs/dogfood/code-run/04-test-report.md` | 测试报告 | tester |
| `docs/dogfood/code-run/05-final.md` | 本文件 | owner |

## 剩余风险

1. **排序无保证**：`listTasksByTeam` 未加 `ORDER BY`（与 `listTasks()` 一致）。当前测试用 `arrayContaining` + `toHaveLength`，不依赖顺序，无脆断。若未来调用方需要确定性顺序，可复用已导入的 `asc/desc` 显式排序。属观察项，非缺陷。
2. **未并入 `dev` 主线**：本任务改动提交于工作树内的独立提交，尚未合入 `dev`/`main`（按仓库约定 `main` 经 PR 合入）。落地到主线时需走常规 review + CI。
3. **范围受限**：本次仅新增只读查询，未接入任何上层调用方（server-core / daemon 尚未消费 `listTasksByTeam`），也未改 schema / 迁移 / webapp 链路。是否需要在控制面暴露该查询，属后续任务，不在本任务验收范围内。
