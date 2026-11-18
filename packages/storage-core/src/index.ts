import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/sql-js';
import initSqlJs, { type Database } from 'sql.js';
import {
  buildAgentExecutionPlan,
  describeRuntimeExecutorRejection,
  executeCodexPlan,
  resolveRuntimeExecutor,
  type ApprovedTask,
  type CodexExecutionResult,
  type CodexProcessRunner,
} from '@agent-ops/agent-runtime';
import type { TaskRunState } from '@agent-ops/workflow';
import { tasks, runs } from './schema.js';
import { kernelMigrations, type Migration } from './migrations.js';
import { ProfileStore } from './profiles-store.js';
import { addWorktree, removeWorktree } from './worktree.js';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

function createKernelOrm(database: Database) {
  return drizzle(database, { schema: { tasks, runs } });
}

export type CreateTaskInput = {
  repo: string;
  baseRef: string;
  title: string;
  objective?: string;
  recipe?: string;
  worktreePath?: string;
};

export type TaskRecord = {
  id: string;
  repo: string;
  baseRef: string;
  worktreePath: string;
  recipe: string;
  title: string;
  objective: string;
  status: TaskRunState;
  createdAt: string;
  updatedAt: string;
};

export type RunRecord = {
  id: string;
  taskId: string;
  agentId: string;
  status: TaskRunState;
  diffStat: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Opens the SQL.js database file, returning an empty in-memory database when the file does not
 * exist yet. Split out so the webapp-delivery store can bootstrap its own subclass against the
 * same loader without duplicating the SQL.js WASM init.
 */
export async function loadDatabase(databasePath: string): Promise<Database> {
  const SQL = await initSqlJs({
    locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm'),
  });
  let data: Uint8Array | undefined;
  try {
    data = new Uint8Array(await readFile(databasePath));
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  }
  return new SQL.Database(data);
}

/**
 * Kernel store: the Agent Ops core data layer (Task/Run/Profile/worktree), with zero dependency
 * on the webapp-delivery plugin (Project/Blueprint/Apply/Release). A plugin-side store extends
 * this class and composes its own webapp tables and migrations onto the same SQLite connection.
 */
export class KernelStore {
  private readonly kernelOrm: ReturnType<typeof createKernelOrm>;
  readonly profiles: ProfileStore;
  protected readonly sqlite: Database;
  protected readonly databasePath: string;
  protected migrations: readonly Migration[] = kernelMigrations;

  protected constructor(sqlite: Database, databasePath: string) {
    this.sqlite = sqlite;
    this.databasePath = databasePath;
    this.kernelOrm = createKernelOrm(sqlite);
    this.profiles = new ProfileStore(dirname(databasePath));
  }

  /** Where the platform keeps its own state and the workspaces it creates. */
  get dataDirectory(): string {
    return dirname(this.databasePath);
  }

  static async open(databasePath: string): Promise<KernelStore> {
    const sqlite = await loadDatabase(databasePath);
    const store = new KernelStore(sqlite, databasePath);
    await store.initialize();
    return store;
  }

  /** Applies migrations and persists the initial file. Public so subclasses can reuse the bootstrap. */
  async initialize(): Promise<void> {
    this.sqlite.run('PRAGMA foreign_keys = ON;');
    this.runMigrations();
    await this.persist();
  }

  async createTask(input: CreateTaskInput): Promise<TaskRecord> {
    const now = new Date().toISOString();
    const record: TaskRecord = {
      id: randomUUID(),
      repo: input.repo,
      baseRef: input.baseRef,
      worktreePath: input.worktreePath ?? '',
      recipe: input.recipe ?? '',
      title: input.title,
      objective: input.objective ?? '',
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    };
    this.kernelOrm.insert(tasks).values(record).run();
    await this.persist();
    return record;
  }

  getTask(id: string): TaskRecord | undefined {
    return this.kernelOrm.select().from(tasks).where(eq(tasks.id, id)).get() as TaskRecord | undefined;
  }

  listTasks(): TaskRecord[] {
    return this.kernelOrm.select().from(tasks).all() as TaskRecord[];
  }

  async updateTaskStatus(id: string, status: TaskRunState): Promise<TaskRecord> {
    const existing = this.getTask(id);
    if (!existing) throw new Error(`Task ${id} was not found.`);
    const now = new Date().toISOString();
    this.kernelOrm.update(tasks).set({ status, updatedAt: now }).where(eq(tasks.id, id)).run();
    await this.persist();
    return { ...existing, status, updatedAt: now };
  }

  async provisionTask(id: string): Promise<TaskRecord> {
    const existing = this.getTask(id);
    if (!existing) throw new Error(`Task ${id} was not found.`);
    if (existing.worktreePath) return existing;
    const path = join(this.dataDirectory, 'tasks', id, 'work');
    await addWorktree(existing.repo, existing.baseRef, path);
    const now = new Date().toISOString();
    this.kernelOrm.update(tasks).set({ worktreePath: path, updatedAt: now }).where(eq(tasks.id, id)).run();
    await this.persist();
    return { ...existing, worktreePath: path, updatedAt: now };
  }

  async releaseTask(id: string): Promise<TaskRecord> {
    const existing = this.getTask(id);
    if (!existing) throw new Error(`Task ${id} was not found.`);
    if (!existing.worktreePath) return existing;
    await removeWorktree(existing.repo, existing.worktreePath);
    const now = new Date().toISOString();
    this.kernelOrm.update(tasks).set({ worktreePath: '', updatedAt: now }).where(eq(tasks.id, id)).run();
    await this.persist();
    return { ...existing, worktreePath: '', updatedAt: now };
  }

  async createRun(taskId: string, agentId: string): Promise<RunRecord> {
    if (!this.getTask(taskId)) throw new Error(`Task ${taskId} was not found.`);
    const now = new Date().toISOString();
    const record: RunRecord = {
      id: randomUUID(),
      taskId,
      agentId,
      status: 'queued',
      diffStat: '',
      createdAt: now,
      updatedAt: now,
    };
    this.kernelOrm.insert(runs).values(record).run();
    await this.persist();
    return record;
  }

  getRun(id: string): RunRecord | undefined {
    return this.kernelOrm.select().from(runs).where(eq(runs.id, id)).get() as RunRecord | undefined;
  }

  listRuns(taskId: string): RunRecord[] {
    return this.kernelOrm.select().from(runs).where(eq(runs.taskId, taskId)).all() as RunRecord[];
  }

  async updateRunStatus(id: string, status: TaskRunState, diffStat?: string): Promise<RunRecord> {
    const existing = this.getRun(id);
    if (!existing) throw new Error(`Run ${id} was not found.`);
    const now = new Date().toISOString();
    this.kernelOrm.update(runs).set({
      status,
      updatedAt: now,
      ...(diffStat !== undefined ? { diffStat } : {}),
    }).where(eq(runs.id, id)).run();
    await this.persist();
    return { ...existing, status, updatedAt: now, ...(diffStat !== undefined ? { diffStat } : {}) };
  }

  async executeRun(id: string, runner?: CodexProcessRunner): Promise<RunRecord> {
    const run = this.getRun(id);
    if (!run) throw new Error(`Run ${id} was not found.`);
    const task = this.getTask(run.taskId);
    if (!task) throw new Error(`Task ${run.taskId} was not found.`);
    if (!task.worktreePath) throw new Error(`Task ${run.taskId} has no worktree. Provision it before executing a run.`);
    if (run.status !== 'queued' && run.status !== 'failed') {
      throw new Error(`Run ${id} cannot be executed from status ${run.status}.`);
    }

    const resolved = await resolveRuntimeExecutor(run.agentId, profileId => this.profiles.getProfile(profileId));
    if (!resolved.ok) throw new Error(describeRuntimeExecutorRejection(resolved));

    const approvedTask: ApprovedTask = { id: task.id, title: task.title, objective: task.objective, acceptanceCriteria: [] };
    const plan = buildAgentExecutionPlan(approvedTask, task.worktreePath, resolved.agentId, { execute: true, profile: resolved.profile });

    await this.updateTaskStatus(task.id, 'running');
    await this.updateRunStatus(id, 'running');

    let result: CodexExecutionResult;
    try {
      result = await executeCodexPlan(plan, runner);
    } catch (error) {
      result = {
        exitCode: null,
        signal: null,
        timedOut: false,
        output: error instanceof Error ? error.message : String(error),
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
    }

    if (result.exitCode === 0 && !result.timedOut) {
      const diffStat = await this.taskDiffStat(task);
      await this.updateTaskStatus(task.id, 'review');
      return this.updateRunStatus(id, 'review', diffStat);
    }
    await this.updateTaskStatus(task.id, 'failed');
    return this.updateRunStatus(id, 'failed');
  }

  async acceptRun(id: string): Promise<RunRecord> {
    const run = this.getRun(id);
    if (!run) throw new Error(`Run ${id} was not found.`);
    if (run.status !== 'review') throw new Error(`Run ${id} cannot be accepted from status ${run.status}.`);
    await this.updateTaskStatus(run.taskId, 'done');
    return this.updateRunStatus(id, 'done');
  }

  async rejectRun(id: string): Promise<RunRecord> {
    const run = this.getRun(id);
    if (!run) throw new Error(`Run ${id} was not found.`);
    if (run.status !== 'review') throw new Error(`Run ${id} cannot be rejected from status ${run.status}.`);
    await this.updateTaskStatus(run.taskId, 'queued');
    return this.updateRunStatus(id, 'queued');
  }

  private async taskDiffStat(task: TaskRecord): Promise<string> {
    const { stdout } = await execFileAsync('git', ['diff', '--stat', task.baseRef], { cwd: task.worktreePath });
    return stdout.trim();
  }

  async close(): Promise<void> {
    await this.persist();
    this.sqlite.close();
  }

  protected runMigrations(): void {
    this.sqlite.run('CREATE TABLE IF NOT EXISTS __agent_dev_migrations (id TEXT PRIMARY KEY NOT NULL);');
    const result = this.sqlite.exec('SELECT id FROM __agent_dev_migrations;');
    const applied = new Set((result[0]?.values ?? []).map(row => String(row[0])));
    for (const migration of this.migrations) {
      if (applied.has(migration.id)) continue;
      this.sqlite.run('BEGIN IMMEDIATE;');
      try {
        this.sqlite.exec(migration.sql);
        this.sqlite.run('INSERT INTO __agent_dev_migrations (id) VALUES (?);', [migration.id]);
        this.sqlite.run('COMMIT;');
      } catch (error) {
        this.sqlite.run('ROLLBACK;');
        throw error;
      }
    }
  }

  protected async persist(): Promise<void> {
    await mkdir(dirname(this.databasePath), { recursive: true });
    // Atomic replace (2026-11-02 review P2-1): the daemon lives for days and a
    // single agent run can take 15 minutes, so an in-place write killed mid-way
    // truncated agent-dev.sqlite and the store could never open again. Write to
    // a temp file and rename over the database instead — a rename either
    // happens fully or not at all, so the live file is never half-written.
    const tmpPath = `${this.databasePath}.tmp-${process.pid}`;
    await writeFile(tmpPath, this.sqlite.export());
    await rename(tmpPath, this.databasePath);
  }
}

export { ProfileStore, addWorktree, removeWorktree, kernelMigrations, type Migration };
export type { CreateProfileInput, UpdateProfileInput, ProfileValidationResult } from './profiles-store.js';
export type { WorktreeResult } from './worktree.js';
