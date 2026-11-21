import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { KernelStore } from '../src/index.js';
import type { CodexProcessRunner } from '@agent-ops/agent-runtime';

const execFileAsync = promisify(execFile);

async function initRepo(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  await execFileAsync('git', ['init', '-q'], { cwd: dir });
  await execFileAsync('git', ['branch', '-M', 'main'], { cwd: dir });
  await writeFile(join(dir, 'README.md'), '# repo\n', 'utf8');
  await execFileAsync('git', ['add', '-A'], { cwd: dir });
  await execFileAsync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

const slowRunner: CodexProcessRunner = (_command, _arguments, options) => new Promise(resolve => {
  const finish = () => resolve({
    exitCode: null,
    signal: 'SIGTERM',
    timedOut: false,
    cancelled: true,
    output: 'stopped',
    startedAt: new Date(Date.now() - 100).toISOString(),
    completedAt: new Date().toISOString(),
  });
  options.onOutput?.('working', 'stdout');
  if (options.signal?.aborted) finish();
  else options.signal?.addEventListener('abort', finish, { once: true });
});

async function waitForRunningRun(store: KernelStore, taskId: string, count = 1): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const running = store.listRuns(taskId).filter(run => run.status === 'running');
    if (running.length >= count) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Task ${taskId} did not reach ${count} running run(s).`);
}

describe('KernelStore cancelTask', () => {
  it('cancels a queued task and its idle pipeline while keeping the task row', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-cancel-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await store.createTask({
        repo,
        baseRef: 'main',
        title: 'Cancel queued',
        pipeline: { steps: [{ id: 'only', name: 'Only', agentId: 'codex' }] },
      });

      const result = await store.cancelTask(task.id);
      expect(result.cancelledRuns).toEqual([]);
      expect(result.task.status).toBe('cancelled');
      expect(store.getTask(task.id)).toMatchObject({ title: 'Cancel queued', status: 'cancelled' });
      expect(store.getTask(task.id)?.pipeline?.status).toBe('cancelled');
      expect(store.getTask(task.id)?.pipeline?.results[0]).toMatchObject({ stepId: 'only', status: 'cancelled', error: 'Task was cancelled.' });
      expect(store.listAudit({ taskId: task.id }).map(event => event.type)).toEqual(['task.created', 'task.cancelled']);
      await expect(store.executeTaskPipeline(task.id)).rejects.toThrow('is cancelled and cannot start a pipeline');
      await expect(store.cancelTask(task.id)).rejects.toThrow('is cancelled and cannot be cancelled');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('aborts an active serial-pipeline run and marks the step and pipeline cancelled', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-cancel-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await store.createTask({
        repo,
        baseRef: 'main',
        title: 'Cancel pipeline',
        pipeline: { steps: [{ id: 'only', name: 'Only', agentId: 'codex' }] },
      });
      await store.provisionTask(task.id);

      const execution = store.executeTaskPipeline(task.id, slowRunner);
      await waitForRunningRun(store, task.id);
      const runId = store.listRuns(task.id).find(run => run.status === 'running')?.id;
      expect(runId).toBeTruthy();

      const cancelled = await store.cancelTask(task.id);
      expect(cancelled.cancelledRuns).toEqual([runId]);
      const pipeline = await execution;
      expect(pipeline.status).toBe('cancelled');
      expect(pipeline.results[0]).toMatchObject({ stepId: 'only', status: 'cancelled', error: 'Task was cancelled.' });
      expect(store.getTask(task.id)?.status).toBe('cancelled');
      expect(store.getRun(runId ?? '')?.status).toBe('cancelled');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('aborts a DAG step and keeps the cancelled task from being reopened', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-cancel-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await store.createTask({
        repo,
        baseRef: 'main',
        title: 'Cancel DAG',
        pipeline: { steps: [{ id: 'only', name: 'Only', agentId: 'codex' }] },
      });
      await store.provisionTask(task.id);

      const execution = store.executeDagPipeline(task.id, { runner: slowRunner });
      await waitForRunningRun(store, task.id);
      const runId = store.listRuns(task.id).find(run => run.status === 'running')?.id;
      await store.cancelTask(task.id);
      const result = await execution;
      expect(result.taskStatus).toBe('cancelled');
      expect(result.steps[0]).toMatchObject({ stepId: 'only', status: 'cancelled', runId, error: 'Task was cancelled.' });
      expect(store.getTask(task.id)?.pipeline?.status).toBe('cancelled');
      expect(store.getTask(task.id)?.status).toBe('cancelled');
      await expect(store.executeDagPipeline(task.id, { runner: slowRunner })).rejects.toThrow('is cancelled and cannot run a DAG');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('aborts every active parallel lane and leaves the task cancelled', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-cancel-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const left = await store.roles.createRole({ name: 'Left', baseAgentId: 'codex' });
      const right = await store.roles.createRole({ name: 'Right', baseAgentId: 'codex' });
      const team = await store.teams.createTeam({ name: 'Cancel team', roleIds: [left.id, right.id] });
      const task = await store.createTask({ repo, baseRef: 'main', title: 'Cancel fanout', teamId: team.id });
      await store.provisionTask(task.id);

      const execution = store.executeParallelTeam(task.id, { runner: slowRunner, maxConcurrency: 2 });
      await waitForRunningRun(store, task.id, 2);

      const cancelled = await store.cancelTask(task.id);
      expect(cancelled.cancelledRuns).toHaveLength(2);
      const result = await execution;
      expect(result.taskStatus).toBe('cancelled');
      expect(result.lanes.every(lane => lane.status === 'cancelled')).toBe(true);
      expect(store.getTask(task.id)?.status).toBe('cancelled');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
});
