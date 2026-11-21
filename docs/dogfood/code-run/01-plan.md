# 01-plan.md — 五角色代码交付：KernelStore.listTasksByTeam

本文件是「Dogfood 8：五角色代码交付」的第一步（CB Architect 产出）。后续角色据此新增 `KernelStore.listTasksByTeam(teamId)` 并补一条 vitest 用例，最终由 owner 汇总改动文件与剩余风险。

## 目标

给内核存储层加一个按 Team 过滤任务的只读查询，并配一条单元测试证明其行为：

1. 在 `packages/storage-core/src/index.ts` 的 `KernelStore` 上新增 `listTasksByTeam(teamId: string): TaskRecord[]`。
2. 在 `packages/storage-core/test/task-run.test.ts` 的 `describe('KernelStore task/run')` 内新增一条 `it(...)` 用例。

只改这两处源码/测试；不改 schema、不改迁移、不碰 webapp 链路。

## 代码改动（packages/storage-core/src/index.ts）

- **位置**：紧跟在现有 `listTasks()`（当前约 889–892 行）之后，与 `getTask` / `listTasks` 同区。
- **实现**：复用已导入的 `eq` 与 `tasks`（`index.ts` 顶部 `import { eq, asc, desc } from 'drizzle-orm'`、`import { tasks, ... } from './schema.js'`），一条查询即可：

  ```ts
  listTasksByTeam(teamId: string): TaskRecord[] {
    const rows = this.kernelOrm.select().from(tasks).where(eq(tasks.teamId, teamId)).all() as TaskRow[];
    return rows.map(toTaskRecord);
  }
  ```

- **口径**：`teamId` 在 `tasks` 表以 `''` 表示「未分配」（`schema.ts` 中 `teamId: text('team_id').notNull().default('')`，`createTask` 写入 `teamId: record.teamId ?? ''`），`toTaskRecord` 已把 `''` 归一为 `null`。因此按给定 `teamId` 精确 `eq` 过滤即可，天然排除未分配任务与其它 Team 的任务。
- **无需新依赖/迁移**：`eq`、`tasks`、`TaskRow`、`toTaskRecord` 均已存在；同步方法，与 `listTasks` 一致，不触发 `persist`。

## 测试改动（packages/storage-core/test/task-run.test.ts）

新增一条用例，沿用现有「团队任务」用例的建仓方式（先建 Role，再建 Team，再建 Task）：

```ts
it('lists tasks by team and excludes other teams', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-ops-task-'));
  try {
    const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
    const role = await store.roles.createRole({ name: 'Builder', baseAgentId: 'codex' });
    const teamA = await store.teams.createTeam({ name: 'Alpha', roleIds: [role.id] });
    const teamB = await store.teams.createTeam({ name: 'Beta', roleIds: [role.id] });

    const a1 = await store.createTask({ repo: '/r', baseRef: 'main', title: 'A1', teamId: teamA.id });
    const a2 = await store.createTask({ repo: '/r', baseRef: 'main', title: 'A2', teamId: teamA.id });
    await store.createTask({ repo: '/r', baseRef: 'main', title: 'B1', teamId: teamB.id });
    await store.createTask({ repo: '/r', baseRef: 'main', title: 'U' }); // 未分配

    const ids = store.listTasksByTeam(teamA.id).map(task => task.id);
    expect(ids).toHaveLength(2);
    expect(ids).toEqual(expect.arrayContaining([a1.id, a2.id]));
    expect(ids).not.toContain('B1');
    expect(store.listTasksByTeam('missing-team')).toEqual([]);
    await store.close();
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
```

要点：
- 断言仅返回 Team A 的两条，排除 Team B 与未分配任务。
- 额外断言未知 `teamId` 返回空数组，覆盖空结果分支。
- 与现有用例一致：临时目录 + `KernelStore.open` + `finally` 清理，不依赖真实模型/外部服务/生产数据。

## 验收口径

- `npm run typecheck -w @agent-ops/storage-core` 通过。
- `npm run test -w @agent-ops/storage-core` 通过（含新增用例）。
- 新增方法行为与 `listTasks()` 一致（同步、只读、返回 `TaskRecord[]`）；测试断言能对上 `toTaskRecord` 的 `teamId: row.teamId || null` 归一化。
- 禁止无证据写成「通过」；reviewer / tester 需交叉核对源码与测试，owner 汇总改动文件与剩余风险。
