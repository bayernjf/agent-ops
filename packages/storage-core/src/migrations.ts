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
  {
    id: '0009_run_events',
    sql: `
      CREATE TABLE IF NOT EXISTS run_events (
        id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        data TEXT,
        at TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES runs(id)
      );

      CREATE INDEX IF NOT EXISTS idx_run_events_run_seq
        ON run_events(run_id, seq);
    `,
  },
  {
    id: '0010_task_closure',
    sql: `
      ALTER TABLE tasks ADD COLUMN acceptance_criteria TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium';
      ALTER TABLE tasks ADD COLUMN base_commit TEXT NOT NULL DEFAULT '';
      ALTER TABLE runs ADD COLUMN commit_sha TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    id: '0011_run_identity',
    sql: `
      ALTER TABLE runs ADD COLUMN role_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE runs ADD COLUMN runtime_id TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    id: '0012_task_role',
    sql: `
      ALTER TABLE tasks ADD COLUMN role_id TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    id: '0013_task_pipeline',
    sql: `
      ALTER TABLE tasks ADD COLUMN pipeline TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    id: '0014_run_instruction',
    sql: `
      ALTER TABLE runs ADD COLUMN instruction TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    id: '0015_run_execution_evidence',
    sql: `
      ALTER TABLE runs ADD COLUMN runtime_version TEXT NOT NULL DEFAULT '';
      ALTER TABLE runs ADD COLUMN command TEXT NOT NULL DEFAULT '';
      ALTER TABLE runs ADD COLUMN input_tokens INTEGER;
      ALTER TABLE runs ADD COLUMN output_tokens INTEGER;
      ALTER TABLE runs ADD COLUMN cost_usd REAL;
    `,
  },
  {
    id: '0016_task_team',
    sql: `
      ALTER TABLE tasks ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
    `,
  },
];
