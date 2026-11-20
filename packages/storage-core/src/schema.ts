import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
  acceptanceCriteria: text('acceptance_criteria').notNull().default('[]'),
  priority: text('priority').notNull().default('medium'),
  baseCommit: text('base_commit').notNull().default(''),
  roleId: text('role_id').notNull().default(''),
  teamId: text('team_id').notNull().default(''),
  pipeline: text('pipeline').notNull().default(''),
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
  commitSha: text('commit_sha').notNull().default(''),
  roleId: text('role_id').notNull().default(''),
  runtimeId: text('runtime_id').notNull().default(''),
  instruction: text('instruction').notNull().default(''),
  runtimeVersion: text('runtime_version').notNull().default(''),
  command: text('command').notNull().default(''),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  costUsd: real('cost_usd'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// Run events are append-only evidence for SSE replay. `seq` is the store-wide
// monotonic cursor; `id` is run-scoped so a deleted/re-run run cannot collide.
export const runEvents = sqliteTable('run_events', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  seq: integer('seq').notNull(),
  type: text('type').notNull(),
  data: text('data'),
  at: text('at').notNull(),
});

// Handoffs record what an upstream pipeline step actually delivered to the next one: the commit
// a human accepted plus the files it changed. A Team configures the edges; this table records
// every traversal that really happened, so the delivery can be audited after the worktree moves on.
export const runHandoffs = sqliteTable('run_handoffs', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  teamId: text('team_id').notNull().default(''),
  fromStepId: text('from_step_id').notNull(),
  toStepId: text('to_step_id').notNull(),
  fromRunId: text('from_run_id').notNull(),
  toRunId: text('to_run_id').notNull(),
  fromRoleId: text('from_role_id').notNull().default(''),
  toRoleId: text('to_role_id').notNull().default(''),
  fromCommitSha: text('from_commit_sha').notNull(),
  artifacts: text('artifacts').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
});

// Audit events replay who changed the kernel model and what the human gates decided: role and
// team edits, task assignment, accepted/rejected runs, pipeline approvals and handoffs. They are
// append-only and ordered by a store-wide `seq`, so a task's history can be read back in order.
export const auditEvents = sqliteTable('audit_events', {
  id: text('id').primaryKey(),
  seq: integer('seq').notNull(),
  taskId: text('task_id').notNull().default(''),
  teamId: text('team_id').notNull().default(''),
  actor: text('actor').notNull().default('operator'),
  type: text('type').notNull(),
  data: text('data').notNull().default('{}'),
  at: text('at').notNull(),
});
