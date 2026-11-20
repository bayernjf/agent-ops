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

const success = (output = 'ok') => ({
  exitCode: 0,
  signal: null,
  timedOut: false,
  output,
  startedAt: new Date(Date.now() - 10).toISOString(),
  completedAt: new Date().toISOString(),
});

describe('KernelStore metrics', () => {
  it('reports zeros and null rates for an empty store', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-metrics-'));
    try {
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const metrics = store.getMetrics();
      expect(metrics.tasks).toMatchObject({ total: 0, done: 0, failed: 0, cancelled: 0, open: 0 });
      expect(metrics.runs).toMatchObject({ total: 0, executed: 0, succeeded: 0, failed: 0, cancelled: 0, inFlight: 0, successRate: null });
      expect(metrics.rework).toMatchObject({ retries: 0, rejections: 0, reworkRate: null });
      expect(metrics.usage).toMatchObject({ reportingRuns: 0, inputTokens: null, outputTokens: null, costUsd: null });
      expect(metrics.timing).toMatchObject({ totalDurationMs: 0, averageDurationMs: null });
      expect(metrics.byRuntime).toEqual([]);
      expect(metrics.byRole).toEqual([]);
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('aggregates success, rework and timing across runs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-metrics-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const role = await store.roles.createRole({ name: 'Builder', baseAgentId: 'codex' });

      const pipelineTask = await store.createTask({
        repo,
        baseRef: 'main',
        title: 'Happy path',
        pipeline: {
          steps: [
            { id: 'plan', name: 'Plan', agentId: 'codex' },
            { id: 'build', name: 'Build', agentId: 'codex' },
          ],
        },
      });
      await store.provisionTask(pipelineTask.id);
      let calls = 0;
      await store.executeTaskPipeline(pipelineTask.id, async (_command, _arguments, options) => {
        calls++;
        await writeFile(join(options.cwd, `STEP-${calls}.md`), `step ${calls}\n`, 'utf8');
        return success();
      });

      const failedTask = await store.createTask({ repo, baseRef: 'main', title: 'Failure' });
      await store.provisionTask(failedTask.id);
      const failedRun = await store.createRun(failedTask.id, 'codex', role.id);
      await store.executeRun(failedRun.id, async () => ({ ...success('boom'), exitCode: 1 }));

      const rejectedTask = await store.createTask({ repo, baseRef: 'main', title: 'Rejected' });
      await store.provisionTask(rejectedTask.id);
      const rejectedRun = await store.createRun(rejectedTask.id, 'codex', role.id);
      await store.executeRun(rejectedRun.id, async (_command, _arguments, options) => {
        await writeFile(join(options.cwd, 'REJECT.md'), 'nope\n', 'utf8');
        return success();
      });
      await store.rejectRun(rejectedRun.id);

      const metrics = store.getMetrics();
      expect(metrics.tasks).toMatchObject({ total: 3, done: 1, failed: 1, open: 1 });
      expect(metrics.runs.total).toBe(4);
      expect(metrics.runs.executed).toBe(3);
      expect(metrics.runs.succeeded).toBe(2);
      expect(metrics.runs.failed).toBe(1);
      expect(metrics.runs.inFlight).toBe(1);
      expect(metrics.runs.successRate).toBeCloseTo(2 / 3);
      expect(metrics.rework).toMatchObject({ retries: 0, rejections: 1 });
      expect(metrics.rework.reworkRate).toBeCloseTo(1 / 3);
      expect(metrics.usage.costUsd).toBeNull();
      expect(metrics.timing.averageDurationMs).toBeGreaterThan(0);
      expect(metrics.byRuntime[0]).toMatchObject({ runtimeId: 'codex', runs: 4 });
      expect(metrics.byRole.map(bucket => bucket.roleId).sort()).toEqual(['builder', 'unassigned']);
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('ignores activity outside the requested window', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-metrics-'));
    try {
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      await store.createTask({ repo: '/r', baseRef: 'main', title: 'Now' });
      const future = store.getMetrics({ since: new Date(Date.now() + 60_000).toISOString() });
      expect(future.tasks.total).toBe(0);
      expect(future.runs.total).toBe(0);
      expect(future.runs.successRate).toBeNull();
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
});
