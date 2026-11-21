# 03-review.md — CB Code Reviewer 评审

评审对象：`git show 018ea48`（`task: accept Dogfood 8: five-role code delivery`）。
改动范围仅两处，符合 01-plan 的约定（不碰 schema / 迁移 / webapp 链路）：

- `packages/storage-core/src/index.ts`（+5）
- `packages/storage-core/test/task-run.test.ts`（+24）

## 验证证据（评审时实测）

- `npx vitest run packages/storage-core/test/task-run.test.ts` → 9/9 通过（含新增用例）。
- `npm run typecheck -w @agent-ops/storage-core` → 通过，无类型错误。
- `git status` 工作树干净，改动已提交于 `018ea48`。

## 正确性发现

1. **实现正确**：`listTasksByTeam` 与 `listTasks` / `getTask` 完全同构，复用已导入的 `eq`、`tasks`、`TaskRow`、`toTaskRecord`，无新依赖、无迁移。参考 `packages/storage-core/src/index.ts:894-897`。

2. **过滤口径正确**：`eq(tasks.teamId, teamId)` 精确匹配；未分配任务在 `tasks` 表以 `''` 存储，`toTaskRecord` 已把 `''` 归一为 `null`（`index.ts:171`），因此给定 `teamId` 的查询天然排除未分配任务与其它 Team，不会把空串任务误命中。参考 `index.ts:868-872`（写入侧）。

3. **同步只读**：方法不 `await`、不触发 `persist`，与 `listTasks()` 一致；无副作用，正确。

4. **（测试质量）`expect(ids).not.toContain('B1')` 是恒真断言**：`'B1'` 是任务的 `title`，而 `ids` 里是随机 UUID，标题字符串永远不等于 UUID，所以这一行无论查询是否正确排除 Team B 都会通过。真正的「排除 Team B」是由 `expect(ids).toHaveLength(2)` + `expect(ids).toEqual(expect.arrayContaining([a1.id, a2.id]))` 隐式保证的。参考 `packages/storage-core/test/task-run.test.ts:189-192`。

   建议（非阻塞）：捕获 `const b1 = await store.createTask(...)`（以及未分配任务），改为 `expect(ids).not.toContain(b1.id)`，让排除断言非恒真、可自证。当前测试结论仍成立（长度 + arrayContaining 已足够），仅断言写法不够严谨。

## 风格发现

1. **中文行内注释**：`// 未分配`（`test/task-run.test.ts:187`）出现在其余全英文的测试文件里，建议改 `// unassigned` 保持一致。低优先级。

2. **方法位置合理**：紧接 `listTasks()` 之后（`index.ts:894`），与 plan 一致，可读性好。

3. **无排序保证**：`listTasksByTeam` 未加 `ORDER BY`（与 `listTasks` 相同）；测试用 `arrayContaining` + `toHaveLength`，未依赖顺序，无脆断。若未来调用方需要确定性顺序，可复用已导入的 `asc/desc`。属观察项，非缺陷。

4. **未分配任务未被显式断言**：测试建了 `title: 'U'` 的未分配任务，但其排除仅靠 `toHaveLength(2)` 隐式覆盖，未直接 `not.toContain(u.id)`。与正确性发现 #4 同源，建议一并显式化。

## 结论

- 生产代码 `listTasksByTeam` 实现正确、口径正确、无迁移/依赖风险。
- 测试通过且能证明核心行为（Team 过滤 + 空结果 + 排除其它 Team / 未分配），但存在一处恒真断言与一处可显式化的断言，属测试写法质量改进项，非阻塞。
- 未发现需返工的正确性缺陷；风格项均为低优先级。
