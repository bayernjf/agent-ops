import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { eq, asc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/sql-js';
import initSqlJs, { type Database } from 'sql.js';
import {
  buildAgentExecutionPlan,
  describeRuntimeExecutorRejection,
  executeCodexPlan,
  resolveRuntimeExecutor,
  runtimeProviderAgentId,
  type AgentRole,
  type ApprovedTask,
  type CodexExecutionResult,
  type CodexProcessRunner,
} from '@agent-ops/agent-runtime';
import type { TaskRunState } from '@agent-ops/workflow';
import { tasks, runs, runEvents } from './schema.js';
import { kernelMigrations, type Migration } from './migrations.js';
import { ProfileStore } from './profiles-store.js';
import { RoleStore } from './roles-store.js';
import { addWorktree, pinWorktreeCommit, removeWorktree } from './worktree.js';
import { assertWorktreeClean, commitWorktreeChanges, resetWorktree } from './commit.js';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

function createKernelOrm(database: Database) {
  return drizzle(database, { schema: { tasks, runs, runEvents } });
}

export type TaskPriority = 'low' | 'medium' | 'high';

export type TaskPipelineStepInput = {
  id?: string;
  name: string;
  roleId?: string;
  profileId?: string;
  agentId?: string;
  prompt?: string;
};

export type TaskPipelineStep = {
  id: string;
  name: string;
  roleId?: string;
  profileId?: string;
  agentId?: string;
  prompt?: string;
};

export type TaskPipelineStepResult = {
  stepId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  runId?: string;
  commitSha?: string;
  output?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
};

export type TaskPipeline = {
  steps: TaskPipelineStep[];
  results: TaskPipelineStepResult[];
  status: 'idle' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
};

export type TaskPipelineInput = {
  steps: TaskPipelineStepInput[];
};

export type CreateTaskInput = {
  repo: string;
  baseRef: string;
  title: string;
  objective?: string;
  recipe?: string;
  worktreePath?: string;
  acceptanceCriteria?: string[];
  priority?: TaskPriority;
  baseCommit?: string;
  roleId?: string;
  pipeline?: TaskPipelineInput;
};

export type TaskRecord = {
  id: string;
  repo: string;
  baseRef: string;
  worktreePath: string;
  recipe: string;
  title: string;
  objective: string;
  acceptanceCriteria: string[];
  priority: TaskPriority;
  baseCommit: string;
  roleId: string | null;
  pipeline: TaskPipeline | null;
  status: TaskRunState;
  createdAt: string;
  updatedAt: string;
};

type TaskRow = Omit<TaskRecord, 'acceptanceCriteria' | 'roleId' | 'pipeline'> & {
  acceptanceCriteria: string;
  roleId: string;
  pipeline: string;
};

function parseTaskPipeline(raw: string): TaskPipeline | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TaskPipeline;
    if (!parsed || !Array.isArray(parsed.steps)) return null;
    const status = parsed.status === 'running' || parsed.status === 'completed' || parsed.status === 'failed' ? parsed.status : 'idle';
    return {
      steps: parsed.steps,
      results: Array.isArray(parsed.results) ? parsed.results : [],
      status,
      startedAt: parsed.startedAt,
      completedAt: parsed.completedAt,
    };
  } catch {
    return null;
  }
}

function toTaskRecord(row: TaskRow): TaskRecord {
  let acceptanceCriteria: string[] = [];
  try {
    const parsed = JSON.parse(row.acceptanceCriteria) as unknown;
    if (Array.isArray(parsed)) {
      acceptanceCriteria = parsed.filter((item): item is string => typeof item === 'string');
    }
  } catch {
    acceptanceCriteria = [];
  }
  const priority: TaskPriority =
    row.priority === 'low' || row.priority === 'high' ? row.priority : 'medium';
  return { ...row, acceptanceCriteria, priority, roleId: row.roleId || null, pipeline: parseTaskPipeline(row.pipeline) };
}

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
  /** True when the run was stopped through POST /api/runs/:id/cancel. */
  cancelled: boolean;
  startedAt: string;
  completedAt: string;
  durationMs: number;
};

export type RunEventType = 'started' | 'stdout' | 'stderr' | 'completed' | 'failed' | 'cancelled';

export type RunEvent = {
  runId: string;
  type: RunEventType;
  /** Monotonic per-store sequence, used by SSE replay/subscribe handoff to deduplicate. */
  seq: number;
  /** Raw process chunk for stdout/stderr; absent for lifecycle events. */
  data?: string;
  at: string;
};

export const RUN_OUTPUT_LIMIT = 64_000;
export const RUN_DIFF_LIMIT = 256_000;
export const RUN_EVENT_LIMIT = 500;

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
    cancelled: false,
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
  commitSha: string;
  /** Role selected for this run; null when the run was created without a Role. */
  roleId: string | null;
  /** Adapter actually resolved at execution time; null before execution. */
  runtimeId: string | null;
  /** Pipeline step or caller instruction appended to the task prompt; empty when none. */
  instruction: string;
  createdAt: string;
  updatedAt: string;
};

type RunRow = Omit<RunRecord, 'artifacts' | 'roleId' | 'runtimeId'> & {
  artifacts: string;
  roleId: string;
  runtimeId: string;
};

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
      cancelled: parsed.cancelled === true,
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
  return {
    ...row,
    roleId: row.roleId || null,
    runtimeId: row.runtimeId || null,
    artifacts: parseRunArtifacts(row.artifacts),
  };
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
  readonly roles: RoleStore;
  protected readonly sqlite: Database;
  protected readonly databasePath: string;
  protected migrations: readonly Migration[] = kernelMigrations;
  private readonly activeRuns = new Map<string, AbortController>();
  private readonly activePipelines = new Set<string>();
  private readonly runEventListeners = new Map<string, Set<(event: RunEvent) => void>>();
  private nextRunEventSeq = 1;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persistChain: Promise<void> = Promise.resolve();

  protected constructor(sqlite: Database, databasePath: string) {
    this.sqlite = sqlite;
    this.databasePath = databasePath;
    this.kernelOrm = createKernelOrm(sqlite);
    this.profiles = new ProfileStore(dirname(databasePath));
    this.roles = new RoleStore(dirname(databasePath));
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
    this.nextRunEventSeq = this.maxRunEventSeq() + 1;
    await this.persist();
  }

  private async normalizePipeline(input: TaskPipelineInput | undefined): Promise<TaskPipeline | null> {
    if (!input) return null;
    if (!Array.isArray(input.steps) || input.steps.length === 0) throw new Error('A pipeline must have at least one step.');
    const usedIds = new Set<string>();
    const steps: TaskPipelineStep[] = [];
    for (const [index, raw] of input.steps.entries()) {
      const id = raw.id?.trim() || `step-${index + 1}`;
      if (usedIds.has(id)) throw new Error(`Pipeline step id ${id} is duplicated.`);
      usedIds.add(id);
      const roleId = raw.roleId?.trim() || undefined;
      const profileId = raw.profileId?.trim() || undefined;
      const agentId = raw.agentId?.trim() || undefined;
      if (!roleId && !profileId && !agentId) throw new Error(`Pipeline step ${id} must name a roleId, profileId, or agentId.`);

      if (roleId) {
        const role = await this.roles.getRole(roleId);
        if (!role) throw new Error(`Role ${roleId} was not found.`);
        if (!role.enabled) throw new Error(`Role ${roleId} is disabled.`);
      }
      if (profileId) {
        const profile = await this.profiles.getProfile(profileId);
        if (!profile) throw new Error(`Profile ${profileId} was not found.`);
        if (roleId) {
          const role = await this.roles.getRole(roleId);
          const roleBase = role?.profileId
            ? (await this.profiles.getProfile(role.profileId))?.baseAgentId
            : role?.baseAgentId;
          if (roleBase && roleBase !== profile.baseAgentId) {
            throw new Error(`Pipeline step ${id} binds Role ${roleId} (${roleBase}) to Profile ${profileId} (${profile.baseAgentId}).`);
          }
        }
      }
      steps.push({
        id,
        name: raw.name.trim(),
        ...(roleId ? { roleId } : {}),
        ...(profileId ? { profileId } : {}),
        ...(agentId ? { agentId } : {}),
        ...(raw.prompt?.trim() ? { prompt: raw.prompt.trim() } : {}),
      });
    }
    return { steps, results: [], status: 'idle' };
  }

  async createTask(input: CreateTaskInput): Promise<TaskRecord> {
    const linkedRoleId = input.roleId?.trim() || undefined;
    if (linkedRoleId) {
      const role = await this.roles.getRole(linkedRoleId);
      if (!role) throw new Error(`Role ${linkedRoleId} was not found.`);
      if (!role.enabled) throw new Error(`Role ${linkedRoleId} is disabled.`);
    }
    const pipeline = await this.normalizePipeline(input.pipeline);
    const now = new Date().toISOString();
    const record: TaskRecord = {
      id: randomUUID(),
      repo: input.repo,
      baseRef: input.baseRef,
      worktreePath: input.worktreePath ?? '',
      recipe: input.recipe ?? '',
      title: input.title,
      objective: input.objective ?? '',
      acceptanceCriteria: input.acceptanceCriteria ?? [],
      priority: input.priority ?? 'medium',
      baseCommit: input.baseCommit ?? '',
      roleId: linkedRoleId ?? null,
      pipeline,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    };
    this.kernelOrm.insert(tasks).values({
      ...record,
      acceptanceCriteria: JSON.stringify(record.acceptanceCriteria),
      roleId: record.roleId ?? '',
      pipeline: record.pipeline ? JSON.stringify(record.pipeline) : '',
    }).run();
    await this.persist();
    return record;
  }

  getTask(id: string): TaskRecord | undefined {
    const row = this.kernelOrm.select().from(tasks).where(eq(tasks.id, id)).get() as TaskRow | undefined;
    return row ? toTaskRecord(row) : undefined;
  }

  listTasks(): TaskRecord[] {
    const rows = this.kernelOrm.select().from(tasks).all() as TaskRow[];
    return rows.map(toTaskRecord);
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
    const { headCommit } = await addWorktree(existing.repo, existing.baseRef, path);
    const now = new Date().toISOString();
    this.kernelOrm.update(tasks).set({
      worktreePath: path,
      baseCommit: headCommit,
      updatedAt: now,
    }).where(eq(tasks.id, id)).run();
    await this.persist();
    return { ...existing, worktreePath: path, baseCommit: headCommit, updatedAt: now };
  }

  async releaseTask(id: string): Promise<TaskRecord> {
    const existing = this.getTask(id);
    if (!existing) throw new Error(`Task ${id} was not found.`);
    if (!existing.worktreePath) return existing;
    await assertWorktreeClean(existing.worktreePath);
    await removeWorktree(existing.repo, existing.worktreePath);
    const now = new Date().toISOString();
    this.kernelOrm.update(tasks).set({ worktreePath: '', updatedAt: now }).where(eq(tasks.id, id)).run();
    await this.persist();
    return { ...existing, worktreePath: '', updatedAt: now };
  }

  private async resolveRunRole(task: TaskRecord, requestedRoleId: string | undefined, agentId: string): Promise<AgentRole | null> {
    const linkedRoleId = requestedRoleId?.trim() || task.roleId || undefined;
    if (!linkedRoleId) return null;
    const role = await this.roles.getRole(linkedRoleId);
    if (!role) throw new Error(`Role ${linkedRoleId} was not found.`);
    if (!role.enabled) throw new Error(`Role ${linkedRoleId} is disabled.`);

    const agentProfile = await this.profiles.getProfile(agentId);
    const agentBaseId = agentProfile?.baseAgentId ?? runtimeProviderAgentId(agentId);

    if (role.profileId) {
      const profile = await this.profiles.getProfile(role.profileId);
      if (!profile) throw new Error(`Role ${role.id} profile ${role.profileId} was not found.`);
      if (agentBaseId !== profile.baseAgentId) {
        throw new Error(`Role ${role.id} targets ${role.profileId} (${profile.baseAgentId}), not run agent ${agentId}.`);
      }
      return role;
    }

    const baseAgentId = role.baseAgentId;
    if (!baseAgentId) throw new Error(`Role ${role.id} has no base agent.`);
    if (agentBaseId !== baseAgentId) {
      throw new Error(`Role ${role.id} targets ${baseAgentId}, not run agent ${agentId}.`);
    }
    return role;
  }

  async createRun(taskId: string, agentId: string, roleId?: string, instruction?: string): Promise<RunRecord> {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} was not found.`);
    const role = await this.resolveRunRole(task, roleId, agentId);
    const now = new Date().toISOString();
    const artifacts = emptyRunArtifacts();
    const record: RunRecord = {
      id: randomUUID(),
      taskId,
      agentId,
      status: 'queued',
      diffStat: '',
      artifacts,
      commitSha: '',
      roleId: role?.id ?? null,
      runtimeId: null,
      instruction: instruction?.trim() ?? '',
      createdAt: now,
      updatedAt: now,
    };
    this.kernelOrm.insert(runs).values({
      id: record.id,
      taskId: record.taskId,
      agentId: record.agentId,
      status: record.status,
      diffStat: record.diffStat,
      artifacts: JSON.stringify(artifacts),
      commitSha: record.commitSha,
      roleId: record.roleId ?? '',
      runtimeId: '',
      instruction: record.instruction,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }).run();
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

  getRunEvents(id: string): RunEvent[] {
    const rows = this.kernelOrm
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, id))
      .orderBy(asc(runEvents.seq))
      .all() as Array<{
        runId: string;
        seq: number;
        type: string;
        data: string | null;
        at: string;
      }>;
    return rows.map(row => ({
      runId: row.runId,
      seq: row.seq,
      type: row.type as RunEventType,
      ...(row.data !== null ? { data: row.data } : {}),
      at: row.at,
    }));
  }

  subscribeRunEvents(id: string, listener: (event: RunEvent) => void): () => void {
    const listeners = this.runEventListeners.get(id) ?? new Set<(event: RunEvent) => void>();
    listeners.add(listener);
    this.runEventListeners.set(id, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.runEventListeners.delete(id);
    };
  }

  async cancelRun(id: string): Promise<RunRecord> {
    const run = this.getRun(id);
    if (!run) throw new Error(`Run ${id} was not found.`);
    if (run.status !== 'running') throw new Error(`Run ${id} cannot be cancelled from status ${run.status}.`);
    const controller = this.activeRuns.get(id);
    if (!controller) {
      throw new Error(`Run ${id} cannot be cancelled because no active execution handle exists.`);
    }
    controller.abort();
    return this.getRun(id) ?? run;
  }

  async updateRunStatus(
    id: string,
    status: TaskRunState,
    diffStat?: string,
    artifacts?: RunArtifacts,
    commitSha?: string,
  ): Promise<RunRecord> {
    const existing = this.getRun(id);
    if (!existing) throw new Error(`Run ${id} was not found.`);
    const now = new Date().toISOString();
    this.kernelOrm.update(runs).set({
      status,
      updatedAt: now,
      ...(diffStat !== undefined ? { diffStat } : {}),
      ...(artifacts !== undefined ? { artifacts: JSON.stringify(artifacts) } : {}),
      ...(commitSha !== undefined ? { commitSha } : {}),
    }).where(eq(runs.id, id)).run();
    await this.persist();
    return {
      ...existing,
      status,
      updatedAt: now,
      ...(diffStat !== undefined ? { diffStat } : {}),
      ...(artifacts !== undefined ? { artifacts } : {}),
      ...(commitSha !== undefined ? { commitSha } : {}),
    };
  }

  async updateRunRuntime(id: string, runtimeId: string): Promise<RunRecord> {
    const existing = this.getRun(id);
    if (!existing) throw new Error(`Run ${id} was not found.`);
    const normalized = runtimeId.trim();
    if (!normalized) throw new Error('Runtime id must not be empty.');
    const now = new Date().toISOString();
    this.kernelOrm.update(runs).set({ runtimeId: normalized, updatedAt: now }).where(eq(runs.id, id)).run();
    await this.persist();
    return { ...existing, runtimeId: normalized, updatedAt: now };
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
    await this.updateRunRuntime(id, resolved.agentId);

    const role = run.roleId ? await this.roles.getRole(run.roleId) : null;
    if (run.roleId && !role) throw new Error(`Role ${run.roleId} was not found.`);

    const approvedTask: ApprovedTask = {
      id: task.id,
      title: task.title,
      objective: task.objective,
      acceptanceCriteria: task.acceptanceCriteria,
      priority: task.priority,
    };
    const plan = buildAgentExecutionPlan(approvedTask, task.worktreePath, resolved.agentId, {
      execute: true,
      profile: resolved.profile,
      role: role ?? undefined,
      toolPolicy: role?.runtimePolicy,
      roleId: role?.id,
      instruction: run.instruction || undefined,
    });

    const controller = new AbortController();
    this.activeRuns.set(id, controller);
    // A rejected run can be executed again under the same run id; stale terminal events
    // would make a new SSE subscriber close on the previous attempt.
    await this.clearRunEvents(id);
    await this.updateTaskStatus(task.id, 'running');
    await this.updateRunStatus(id, 'running');
    this.emitRunEvent(id, 'started');

    let result: CodexExecutionResult;
    try {
      result = await executeCodexPlan(plan, runner, undefined, {
        signal: controller.signal,
        onOutput: (chunk, stream) => this.emitRunEvent(id, stream, chunk),
      });
    } catch (error) {
      result = {
        exitCode: null,
        signal: null,
        timedOut: false,
        cancelled: controller.signal.aborted,
        output: error instanceof Error ? error.message : String(error),
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
    } finally {
      this.activeRuns.delete(id);
    }

    const cancelled = result.cancelled === true || controller.signal.aborted;
    const evidence = await this.collectEvidence(task, result, cancelled);
    if (cancelled) {
      await this.updateTaskStatus(task.id, 'cancelled');
      const record = await this.updateRunStatus(id, 'cancelled', evidence.diffStat, evidence.artifacts);
      this.emitRunEvent(id, 'cancelled');
      return record;
    }
    if (result.exitCode === 0 && !result.timedOut) {
      await this.updateTaskStatus(task.id, 'review');
      const record = await this.updateRunStatus(id, 'review', evidence.diffStat, evidence.artifacts);
      this.emitRunEvent(id, 'completed');
      return record;
    }
    await this.updateTaskStatus(task.id, 'failed');
    const record = await this.updateRunStatus(id, 'failed', evidence.diffStat, evidence.artifacts);
    this.emitRunEvent(id, 'failed');
    return record;
  }

  private async saveTaskPipeline(taskId: string, pipeline: TaskPipeline): Promise<void> {
    const now = new Date().toISOString();
    this.kernelOrm.update(tasks).set({ pipeline: JSON.stringify(pipeline), updatedAt: now }).where(eq(tasks.id, taskId)).run();
    await this.persist();
  }

  private async resolvePipelineStepAgent(step: TaskPipelineStep): Promise<string> {
    if (step.agentId) return step.agentId;
    if (step.profileId) return step.profileId;
    if (step.roleId) {
      const role = await this.roles.getRole(step.roleId);
      if (!role) throw new Error(`Role ${step.roleId} was not found.`);
      if (!role.enabled) throw new Error(`Role ${step.roleId} is disabled.`);
      if (role.profileId) return role.profileId;
      if (role.baseAgentId) return role.baseAgentId;
    }
    throw new Error(`Pipeline step ${step.id} has no resolvable agent.`);
  }

  async executeTaskPipeline(id: string, runner?: CodexProcessRunner): Promise<TaskPipeline> {
    if (this.activePipelines.has(id)) throw new Error(`Task ${id} already has a running pipeline.`);
    this.activePipelines.add(id);
    try {
      const task = this.getTask(id);
      if (!task) throw new Error(`Task ${id} was not found.`);
      if (!task.pipeline || task.pipeline.steps.length === 0) throw new Error(`Task ${id} has no pipeline configured.`);
      if (!task.worktreePath) throw new Error(`Task ${id} has no worktree. Provision it before executing its pipeline.`);
      if (task.pipeline.status !== 'idle') {
        throw new Error(`Task ${id} pipeline is ${task.pipeline.status}; only an idle pipeline can start. Retry hygiene is not implemented yet.`);
      }

      let pipeline: TaskPipeline = {
        steps: task.pipeline.steps,
        results: [],
        status: 'running',
        startedAt: new Date().toISOString(),
      };
      await this.saveTaskPipeline(id, pipeline);

      for (const [index, step] of pipeline.steps.entries()) {
        const startedAt = new Date().toISOString();
        const updateResult = (result: TaskPipelineStepResult) => {
          pipeline = {
            ...pipeline,
            results: [...pipeline.results.filter(existing => existing.stepId !== step.id), result],
          };
        };
        updateResult({ stepId: step.id, status: 'running', startedAt });
        await this.saveTaskPipeline(id, pipeline);

        let runId: string | undefined;
        try {
          const agentId = await this.resolvePipelineStepAgent(step);
          const instruction = `Pipeline step ${index + 1}/${pipeline.steps.length}: ${step.name}${step.prompt ? `\n\n${step.prompt}` : ''}`;
          const run = await this.createRun(id, agentId, step.roleId, instruction);
          runId = run.id;
          updateResult({ stepId: step.id, status: 'running', runId, startedAt });
          await this.saveTaskPipeline(id, pipeline);

          const executed = await this.executeRun(run.id, runner);
          if (executed.status !== 'review') {
            updateResult({
              stepId: step.id,
              status: 'failed',
              runId,
              error: `Run ended in ${executed.status}, expected review.`,
              startedAt,
              completedAt: new Date().toISOString(),
            });
            pipeline = { ...pipeline, status: 'failed', completedAt: new Date().toISOString() };
            await this.saveTaskPipeline(id, pipeline);
            return pipeline;
          }

          const accepted = await this.acceptRun(run.id);
          updateResult({
            stepId: step.id,
            status: 'completed',
            runId,
            commitSha: accepted.commitSha,
            output: executed.artifacts.output.slice(0, 2000),
            startedAt,
            completedAt: new Date().toISOString(),
          });
          await this.saveTaskPipeline(id, pipeline);
        } catch (error) {
          updateResult({
            stepId: step.id,
            status: 'failed',
            ...(runId ? { runId } : {}),
            error: error instanceof Error ? error.message : String(error),
            startedAt,
            completedAt: new Date().toISOString(),
          });
          pipeline = { ...pipeline, status: 'failed', completedAt: new Date().toISOString() };
          await this.saveTaskPipeline(id, pipeline);
          return pipeline;
        }
      }

      pipeline = { ...pipeline, status: 'completed', completedAt: new Date().toISOString() };
      await this.saveTaskPipeline(id, pipeline);
      return pipeline;
    } finally {
      this.activePipelines.delete(id);
    }
  }

  async acceptRun(id: string): Promise<RunRecord> {
    const run = this.getRun(id);
    if (!run) throw new Error(`Run ${id} was not found.`);
    if (run.status !== 'review') throw new Error(`Run ${id} cannot be accepted from status ${run.status}.`);
    const task = this.getTask(run.taskId);
    if (!task) throw new Error(`Task ${run.taskId} was not found.`);
    if (!task.worktreePath) throw new Error(`Task ${run.taskId} has no worktree.`);

    const commit = await commitWorktreeChanges(task.worktreePath, `task: accept ${task.title}`);
    await pinWorktreeCommit(task.repo, task.id, commit.sha);
    await this.updateTaskStatus(run.taskId, 'done');
    return this.updateRunStatus(id, 'done', run.diffStat, run.artifacts, commit.sha);
  }

  async rejectRun(id: string): Promise<RunRecord> {
    const run = this.getRun(id);
    if (!run) throw new Error(`Run ${id} was not found.`);
    if (run.status !== 'review') throw new Error(`Run ${id} cannot be rejected from status ${run.status}.`);
    const task = this.getTask(run.taskId);
    if (!task) throw new Error(`Task ${run.taskId} was not found.`);
    if (task.worktreePath) {
      await resetWorktree(task.worktreePath, task.baseCommit || undefined);
    }
    await this.updateTaskStatus(run.taskId, 'queued');
    return this.updateRunStatus(id, 'queued');
  }

  private emitRunEvent(runId: string, type: RunEventType, data?: string): void {
    const event: RunEvent = { runId, type, seq: this.nextRunEventSeq++, at: new Date().toISOString(), ...(data !== undefined ? { data } : {}) };
    this.kernelOrm.insert(runEvents).values({
      id: `${runId}:${event.seq}`,
      runId,
      seq: event.seq,
      type: event.type,
      data: data ?? null,
      at: event.at,
    }).run();
    if (event.seq > RUN_EVENT_LIMIT) {
      this.sqlite.run(
        'DELETE FROM run_events WHERE run_id = ? AND seq <= ?;',
        [runId, event.seq - RUN_EVENT_LIMIT],
      );
    }
    // Output chunks can be frequent; debounce their writes. Lifecycle events are
    // persisted immediately so a daemon restart cannot lose the terminal frame.
    if (type === 'stdout' || type === 'stderr') this.schedulePersist();
    else void this.persist().catch(() => {});
    for (const listener of this.runEventListeners.get(runId) ?? []) {
      try {
        listener(event);
      } catch {
        // SSE clients disconnect; a listener must not break the execution path.
      }
    }
  }

  private async clearRunEvents(id: string): Promise<void> {
    this.kernelOrm.delete(runEvents).where(eq(runEvents.runId, id)).run();
    await this.persist();
  }

  private maxRunEventSeq(): number {
    const result = this.sqlite.exec('SELECT COALESCE(MAX(seq), 0) FROM run_events;');
    const value = result[0]?.values[0]?.[0];
    return Number(value ?? 0);
  }

  private async collectEvidence(
    task: TaskRecord,
    result: CodexExecutionResult,
    cancelled: boolean,
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
        cancelled,
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
    this.activeRuns.clear();
    this.runEventListeners.clear();
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
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

  private schedulePersist(): void {
    if (this.persistTimer) return;
    const timer = setTimeout(() => {
      this.persistTimer = null;
      void this.persist().catch(() => {});
    }, 200);
    timer.unref?.();
    this.persistTimer = timer;
  }

  protected async persist(): Promise<void> {
    // All writes share one atomic temp-file rename path; serialize them so a
    // debounced output flush cannot race a status/artifact write.
    const next = this.persistChain.then(() => this.writeDatabase());
    this.persistChain = next.catch(() => undefined);
    await next;
  }

  private async writeDatabase(): Promise<void> {
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

export { ProfileStore, RoleStore, addWorktree, removeWorktree, kernelMigrations, type Migration };
export type { CreateRoleInput, UpdateRoleInput } from './roles-store.js';
export { assertWorktreeClean, commitWorktreeChanges, resetWorktree, UnsafeCommitError } from './commit.js';
export type { CommitWorktreeResult } from './commit.js';
export type { CreateProfileInput, UpdateProfileInput, ProfileValidationResult } from './profiles-store.js';
export type { WorktreeResult } from './worktree.js';
