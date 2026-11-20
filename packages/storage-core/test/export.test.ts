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

describe('KernelStore task export', () => {
  it('bundles the runs, handoffs, audit trail and totals of one task', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-export-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await store.createTask({
        repo,
        baseRef: 'main',
        title: 'Exportable task',
        acceptanceCriteria: ['Ships the change'],
        pipeline: {
          steps: [
            { id: 'plan', name: 'Plan', agentId: 'codex' },
            { id: 'build', name: 'Build', agentId: 'codex' },
          ],
        },
      });
      await store.provisionTask(task.id);
      let calls = 0;
      const runner: CodexProcessRunner = async (_command, _arguments, options) => {
        calls++;
        await writeFile(join(options.cwd, `STEP-${calls}.md`), `step ${calls}\n`, 'utf8');
        return success();
      };
      await store.executeTaskPipeline(task.id, runner);

      const exported = store.exportTask(task.id);
      expect(exported).not.toBeNull();
      expect(exported?.version).toBe(1);
      expect(exported?.task).toMatchObject({ id: task.id, title: 'Exportable task', status: 'done' });
      expect(exported?.pipeline?.status).toBe('completed');

      const runs = exported?.runs ?? [];
      expect(runs).toHaveLength(2);
      expect(runs[0]).toMatchObject({ status: 'done', handoff: null });
      expect(runs[1]?.handoff).toMatchObject({ fromStepId: 'plan', toStepId: 'build' });
      expect(runs[0]?.artifacts.diff).toContain('STEP-1.md');
      expect(runs[0]?.artifacts.output).toContain('ok');

      expect(exported?.handoffs).toHaveLength(1);
      expect(exported?.audit.map(event => event.type)).toEqual([
        'task.created',
        'run.accepted',
        'handoff.recorded',
        'run.accepted',
      ]);

      expect(exported?.totals).toMatchObject({
        runs: 2,
        acceptedCommits: 2,
        changedFiles: 2,
        reportingRuns: 0,
      });
      expect(exported?.totals.inputTokens).toBeNull();
      expect(exported?.totals.outputTokens).toBeNull();
      expect(exported?.totals.costUsd).toBeNull();
      expect(exported?.totals.durationMs).toBeGreaterThan(0);

      expect(store.exportTask('missing-task')).toBeNull();
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('counts only committed runs and leaves usage null until a run reports it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-export-'));
    try {
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await store.createTask({ repo: '/r', baseRef: 'main', title: 'Empty task' });
      const exported = store.exportTask(task.id);
      expect(exported?.runs).toHaveLength(0);
      expect(exported?.totals).toMatchObject({
        runs: 0,
        acceptedCommits: 0,
        changedFiles: 0,
        reportingRuns: 0,
        durationMs: 0,
      });
      expect(exported?.totals.costUsd).toBeNull();
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
});
