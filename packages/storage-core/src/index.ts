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

export type RunArtifacts = {
  /** Combined stdout/stderr from the agent process, capped before persistence. */
  output: string;
  outputTruncated: boolean;
  /** Full tracked diff plus patches for untracked files, capped before persistence. */
  diff: string;
  diffTruncated: boolean;
  changedFiles: string[];
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  startedAt: string;
  completedAt: string;
  durationMs: number;
};

export const RUN_OUTPUT_LIMIT = 64_000;
export const RUN_DIFF_LIMIT = 256_000;

export function emptyRunArtifacts(): RunArtifacts {
  return {
    output: '',
    outputTruncated: false,
    diff: '',
    diffTruncated: false,
    changedFiles: [],
    exitCode: null,
    signal: null,
    timedOut: false,
    startedAt: '',
    completedAt: '',
    durationMs: 0,
  };
}

export type RunRecord = {
  id: string;
  taskId: string;
  agentId: string;
  status: TaskRunState;
  diffStat: string;
  artifacts: RunArtifacts;
  createdAt: string;
  updatedAt: string;
};

type RunRow = Omit<RunRecord, 'artifacts'> & { artifacts: string };

function parseRunArtifacts(raw: string): RunArtifacts {
  const defaults = emptyRunArtifacts();
  try {
    const parsed = JSON.parse(raw) as Partial<RunArtifacts> | null;
    if (!parsed || typeof parsed !== 'object') return defaults;
    return {
      output: typeof parsed.output === 'string' ? parsed.output : defaults.output,
      outputTruncated: parsed.outputTruncated === true,
      diff: typeof parsed.diff === 'string' ? parsed.diff : defaults.diff,
      diffTruncated: parsed.diffTruncated === true,
      changedFiles: Array.isArray(parsed.changedFiles)
        ? parsed.changedFiles.filter((file): file is string => typeof file === 'string')
        : defaults.changedFiles,
      exitCode: typeof parsed.exitCode === 'number' ? parsed.exitCode : null,
      signal: typeof parsed.signal === 'string' ? parsed.signal : null,
      timedOut: parsed.timedOut === true,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
      completedAt: typeof parsed.completedAt === 'string' ? parsed.completedAt : '',
      durationMs: typeof parsed.durationMs === 'number' && Number.isFinite(parsed.durationMs)
        ? Math.max(0, parsed.durationMs)
        : 0,
    };
  } catch {
    return defaults;
  }
}

function toRunRecord(row: RunRow): RunRecord {
  return { ...row, artifacts: parseRunArtifacts(row.artifacts) };
}

function boundedText(value: string, limit: number): { text: string; truncated: boolean } {
  if (value.length <= limit) return { text: value, truncated: false };
  return {
    text: `${value.slice(0, limit)}\n\n[truncated: ${value.length} characters total]`,
    truncated: true,
  };
}

function splitLines(value: string): string[] {
  return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

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
    const artifacts = emptyRunArtifacts();
    const record: RunRecord = {
      id: randomUUID(),
      taskId,
      agentId,
      status: 'queued',
      diffStat: '',
      artifacts,
      createdAt: now,
      updatedAt: now,
    };
    this.kernelOrm.insert(runs).values({ ...record, artifacts: JSON.stringify(artifacts) }).run();
    await this.persist();
    return record;
  }

  getRun(id: string): RunRecord | undefined {
    const row = this.kernelOrm.select().from(runs).where(eq(runs.id, id)).get() as RunRow | undefined;
    return row ? toRunRecord(row) : undefined;
  }

  listRuns(taskId: string): RunRecord[] {
    const rows = this.kernelOrm.select().from(runs).where(eq(runs.taskId, taskId)).all() as RunRow[];
    return rows.map(toRunRecord);
  }

  async updateRunStatus(
    id: string,
    status: TaskRunState,
    diffStat?: string,
    artifacts?: RunArtifacts,
  ): Promise<RunRecord> {
    const existing = this.getRun(id);
    if (!existing) throw new Error(`Run ${id} was not found.`);
    const now = new Date().toISOString();
    this.kernelOrm.update(runs).set({
      status,
      updatedAt: now,
      ...(diffStat !== undefined ? { diffStat } : {}),
      ...(artifacts !== undefined ? { artifacts: JSON.stringify(artifacts) } : {}),
    }).where(eq(runs.id, id)).run();
    await this.persist();
    return {
      ...existing,
      status,
      updatedAt: now,
      ...(diffStat !== undefined ? { diffStat } : {}),
      ...(artifacts !== undefined ? { artifacts } : {}),
    };
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

    const evidence = await this.collectEvidence(task, result);
    if (result.exitCode === 0 && !result.timedOut) {
      await this.updateTaskStatus(task.id, 'review');
      return this.updateRunStatus(id, 'review', evidence.diffStat, evidence.artifacts);
    }
    await this.updateTaskStatus(task.id, 'failed');
    return this.updateRunStatus(id, 'failed', evidence.diffStat, evidence.artifacts);
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

  private async collectEvidence(
    task: TaskRecord,
    result: CodexExecutionResult,
  ): Promise<{ diffStat: string; artifacts: RunArtifacts }> {
    const cwd = task.worktreePath;
    const trackedStat = await this.gitOutput(cwd, ['diff', '--stat', task.baseRef]);
    const trackedNames = await this.gitOutput(cwd, ['diff', '--name-only', task.baseRef]);
    // `git diff` ignores files the agent created but never staged, which is the common
    // case for a non-interactive run. Capture their patches explicitly so the review
    // surface reflects every change, not just the tracked ones.
    const untrackedNames = splitLines(
      await this.gitOutput(cwd, ['ls-files', '--others', '--exclude-standard']),
    );
    const changedFiles = [...new Set([...splitLines(trackedNames), ...untrackedNames])];

    let fullDiff = await this.gitOutput(cwd, ['diff', task.baseRef]);
    for (const file of untrackedNames) {
      if (fullDiff.length >= RUN_DIFF_LIMIT) break;
      const patch = await this.untrackedDiff(cwd, file);
      if (!patch) continue;
      fullDiff = `${fullDiff}${fullDiff && !fullDiff.endsWith('\n') ? '\n' : ''}${patch}`;
    }
    const boundedDiff = boundedText(fullDiff.trim(), RUN_DIFF_LIMIT);

    const untrackedStat = untrackedNames.map(name => ` ${name} | untracked`).join('\n');
    const diffStat = [trackedStat.trim(), untrackedStat].filter(Boolean).join('\n');

    const boundedOutput = boundedText(result.output ?? '', RUN_OUTPUT_LIMIT);
    const started = Date.parse(result.startedAt);
    const completed = Date.parse(result.completedAt);
    const durationMs = Number.isFinite(started) && Number.isFinite(completed)
      ? Math.max(0, completed - started)
      : 0;

    return {
      diffStat,
      artifacts: {
        output: boundedOutput.text,
        outputTruncated: boundedOutput.truncated,
        diff: boundedDiff.text,
        diffTruncated: boundedDiff.truncated,
        changedFiles,
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        startedAt: result.startedAt,
        completedAt: result.completedAt,
        durationMs,
      },
    };
  }

  private async gitOutput(cwd: string, args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 4 * 1024 * 1024 });
      return stdout;
    } catch {
      // Evidence collection is best-effort: a missing worktree or a git quirk must not
      // turn a completed agent run into a thrown error with no persisted record.
      return '';
    }
  }

  private async untrackedDiff(cwd: string, file: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['diff', '--no-index', '--', '/dev/null', file],
        { cwd, maxBuffer: 4 * 1024 * 1024 },
      );
      return stdout;
    } catch (error) {
      // `git diff --no-index` exits 1 when it finds a difference; stdout still carries
      // the patch and is the useful part here.
      if (error && typeof error === 'object' && 'stdout' in error) {
        const stdout = (error as { stdout?: unknown }).stdout;
        if (typeof stdout === 'string') return stdout;
      }
      return '';
    }
  }

  async close(): Promise<void> {
    await this.persist();
    this.sqlite.close();
  }

  protected runMigrations(): void {
    this.sqlite.run('CREATE TABLE IF NOT EXISTS __agent_ops_migrations (id TEXT PRIMARY KEY NOT NULL);');
    const result = this.sqlite.exec('SELECT id FROM __agent_ops_migrations;');
    const applied = new Set((result[0]?.values ?? []).map(row => String(row[0])));
    for (const migration of this.migrations) {
      if (applied.has(migration.id)) continue;
      this.sqlite.run('BEGIN IMMEDIATE;');
      try {
        this.sqlite.exec(migration.sql);
        this.sqlite.run('INSERT INTO __agent_ops_migrations (id) VALUES (?);', [migration.id]);
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
    // truncated agent-ops.sqlite and the store could never open again. Write to
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
