import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  productType: text('product_type').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const blueprintRevisions = sqliteTable(
  'blueprint_revisions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    revision: integer('revision').notNull(),
    blueprintJson: text('blueprint_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  table => [uniqueIndex('blueprint_revisions_project_revision').on(table.projectId, table.revision)],
);

export const deliveryRuns = sqliteTable('delivery_runs', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  state: text('state').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const baselineApprovals = sqliteTable(
  'baseline_approvals',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    blueprintRevision: integer('blueprint_revision').notNull(),
    status: text('status').notNull(),
    approvedBy: text('approved_by').notNull(),
    approvedAt: text('approved_at').notNull(),
  },
  table => [uniqueIndex('baseline_approvals_project_revision').on(table.projectId, table.blueprintRevision)],
);

export const applyRuns = sqliteTable('apply_runs', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  blueprintRevision: integer('blueprint_revision').notNull(),
  status: text('status').notNull(),
  attempts: integer('attempts').notNull().default(0),
  recoveryIndex: integer('recovery_index').notNull().default(0),
  workspacePath: text('workspace_path').notNull(),
  stepsJson: text('steps_json').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const releaseRuns = sqliteTable('release_runs', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  blueprintRevision: integer('blueprint_revision').notNull(),
  status: text('status').notNull(),
  attempts: integer('attempts').notNull().default(0),
  approvedBy: text('approved_by').notNull(),
  approvalSummary: text('approval_summary').notNull(),
  stepsJson: text('steps_json').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

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
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
