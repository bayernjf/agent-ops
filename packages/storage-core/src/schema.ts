import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Task/Run are the Agent Ops kernel model, independent of the webapp-delivery plugin
// (Project/Blueprint/Apply/Release). A task binds one real repository and base ref; its
// runs each produce a diff that a human accepts or rejects at the `review` gate.
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  repo: text('repo').notNull(),
  baseRef: text('base_ref').notNull(),
  worktreePath: text('worktree_path').notNull().default(''),
  recipe: text('recipe').notNull().default(''),
  title: text('title').notNull(),
  objective: text('objective').notNull().default(''),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  agentId: text('agent_id').notNull(),
  status: text('status').notNull(),
  diffStat: text('diff_stat').notNull().default(''),
  artifacts: text('artifacts').notNull().default('{}'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
