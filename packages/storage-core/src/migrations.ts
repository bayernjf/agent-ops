export type Migration = {
  id: string;
  sql: string;
};

// Kernel migrations own the tasks/runs tables. The webapp-delivery plugin keeps its own
// migration list (0001-0006) and composes the two when it opens a store.
export const kernelMigrations: readonly Migration[] = [
  {
    id: '0007_task_run',
    sql: `
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY NOT NULL,
        repo TEXT NOT NULL,
        base_ref TEXT NOT NULL,
        worktree_path TEXT NOT NULL DEFAULT '',
        recipe TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL,
        objective TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        status TEXT NOT NULL,
        diff_stat TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(task_id) REFERENCES tasks(id)
      );
    `,
  },
  {
    id: '0008_run_artifacts',
    sql: `
      ALTER TABLE runs ADD COLUMN artifacts TEXT NOT NULL DEFAULT '{}';
    `,
  },
];
