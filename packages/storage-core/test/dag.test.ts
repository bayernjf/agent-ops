import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
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
  startedAt: new Date(Date.now() - 5).toISOString(),
  completedAt: new Date().toISOString(),
});

const exists = (path: string) => access(path).then(() => true).catch(() => false);

describe('KernelStore DAG pipeline', () => {
  it('runs ready steps in parallel, branches a join from its dependencies and reports conflicts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-dag-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const left = await store.roles.createRole({ name: 'Left', baseAgentId: 'codex' });
      const right = await store.roles.createRole({ name: 'Right', baseAgentId: 'codex' });
      const joinRole = await store.roles.createRole({ name: 'Join', baseAgentId: 'codex' });
      const task = await store.createTask({
        repo,
        baseRef: 'main',
        title: 'DAG',
        pipeline: {
          steps: [
            { id: 'left', name: 'Left', roleId: left.id, dependsOn: [] },
            { id: 'right', name: 'Right', roleId: right.id, dependsOn: [] },
            { id: 'join', name: 'Join', roleId: joinRole.id, dependsOn: ['left', 'right'] },
          ],
        },
      });
      await store.provisionTask(task.id);

      let active = 0;
      let maxActive = 0;
      const observed: Record<string, { right: boolean; left: boolean }> = {};
      const runner: CodexProcessRunner = async (_command, _arguments, options) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, 10));
        active--;
        const stepId = basename(options.cwd);
        if (stepId === 'left') {
          await writeFile(join(options.cwd, 'LEFT.md'), 'left\n', 'utf8');
          await writeFile(join(options.cwd, 'SHARED.md'), 'left\n', 'utf8');
        } else if (stepId === 'right') {
          await writeFile(join(options.cwd, 'RIGHT.md'), 'right\n', 'utf8');
          await writeFile(join(options.cwd, 'SHARED.md'), 'right\n', 'utf8');
        } else {
          observed[stepId] = {
            right: await exists(join(options.cwd, 'RIGHT.md')),
            left: await exists(join(options.cwd, 'LEFT.md')),
          };
          await writeFile(join(options.cwd, 'JOIN.md'), 'join\n', 'utf8');
        }
        return success();
      };

      const result = await store.executeDagPipeline(task.id, { runner, maxConcurrency: 2 });
      expect(result.steps.map(step => step.status)).toEqual(['completed', 'completed', 'completed']);
      expect(maxActive).toBe(2);
      // The join branched from the last dependency (right), so only its file is present.
      expect(observed.join).toEqual({ right: true, left: false });
      expect(result.warnings.join(' ')).toContain('commits from left are not merged');
      // Concurrent lanes finish in any order, so compare the owners as a set.
      expect(result.conflicts.map(conflict => ({ file: conflict.file, stepIds: [...conflict.stepIds].sort() })))
        .toEqual([{ file: 'SHARED.md', stepIds: ['left', 'right'] }]);
      expect(result.taskStatus).toBe('review');
      expect(store.getTask(task.id)?.pipeline?.results.map(entry => entry.status)).toEqual(['completed', 'completed', 'completed']);
      expect(store.listAudit({ taskId: task.id }).map(event => event.type)).toContain('pipeline.dag.executed');

      const commits = result.steps.map(step => step.commitSha);
      expect(new Set(commits).size).toBe(3);
      for (const step of result.steps) await execFileAsync('git', ['cat-file', '-e', `${step.commitSha}^{commit}`], { cwd: repo });
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('skips dependents of a failed step without blocking the rest of the DAG', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-dag-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await store.createTask({
        repo,
        baseRef: 'main',
        title: 'DAG failure',
        pipeline: {
          steps: [
            { id: 'root', name: 'Root', agentId: 'codex', dependsOn: [] },
            { id: 'other', name: 'Other', agentId: 'codex', dependsOn: [] },
            { id: 'child', name: 'Child', agentId: 'codex', dependsOn: ['root'] },
          ],
        },
      });
      await store.provisionTask(task.id);

      const calls: string[] = [];
      const runner: CodexProcessRunner = async (_command, _arguments, options) => {
        const stepId = basename(options.cwd);
        calls.push(stepId);
        if (stepId === 'root') return { ...success('boom'), exitCode: 1 };
        await writeFile(join(options.cwd, `${stepId.toUpperCase()}.md`), 'ok\n', 'utf8');
        return success();
      };

      const result = await store.executeDagPipeline(task.id, { runner, maxConcurrency: 2 });
      expect(result.steps.map(step => [step.stepId, step.status])).toEqual([
        ['root', 'failed'],
        ['other', 'completed'],
        ['child', 'skipped'],
      ]);
      expect(result.steps[2]?.error).toContain('root');
      expect(calls.sort()).toEqual(['other', 'root']);
      expect(result.taskStatus).toBe('review');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('refuses cyclic or unknown dependencies and per-step approval in DAG mode', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-dag-'));
    try {
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      await expect(store.createTask({
        repo: '/r',
        baseRef: 'main',
        title: 'Cycle',
        pipeline: {
          steps: [
            { id: 'a', name: 'A', agentId: 'codex', dependsOn: ['b'] },
            { id: 'b', name: 'B', agentId: 'codex', dependsOn: ['a'] },
          ],
        },
      })).rejects.toThrow('cycle');

      await expect(store.createTask({
        repo: '/r',
        baseRef: 'main',
        title: 'Ghost',
        pipeline: { steps: [{ id: 'a', name: 'A', agentId: 'codex', dependsOn: ['ghost'] }] },
      })).rejects.toThrow('unknown step');

      const gated = await store.createTask({
        repo: '/r',
        baseRef: 'main',
        title: 'Gated',
        pipeline: { steps: [{ id: 'a', name: 'A', agentId: 'codex', requiresApproval: true }] },
      });
      await expect(store.executeDagPipeline(gated.id)).rejects.toThrow('does not support per-step approval');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
});
