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

describe('KernelStore parallel lanes', () => {
  it('runs one lane per role with bounded concurrency and reports conflicts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-parallel-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const architect = await store.roles.createRole({ name: 'Architect', baseAgentId: 'codex' });
      const implementer = await store.roles.createRole({ name: 'Implementer', baseAgentId: 'codex' });
      const reviewer = await store.roles.createRole({ name: 'Reviewer', baseAgentId: 'codex' });
      const team = await store.teams.createTeam({
        name: 'Parallel',
        roleIds: [architect.id, implementer.id, reviewer.id],
      });
      const task = await store.createTask({ repo, baseRef: 'main', title: 'Parallel task', teamId: team.id });
      await store.provisionTask(task.id);

      let active = 0;
      let maxActive = 0;
      const runner: CodexProcessRunner = async (_command, _arguments, options) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, 15));
        active--;
        const roleId = basename(options.cwd);
        await writeFile(join(options.cwd, `${roleId}.md`), `${roleId}\n`, 'utf8');
        if (roleId === architect.id || roleId === implementer.id) {
          await writeFile(join(options.cwd, 'SHARED.md'), `${roleId}\n`, 'utf8');
        }
        return success();
      };

      const result = await store.executeParallelTeam(task.id, { runner, maxConcurrency: 2 });
      expect(result.lanes).toHaveLength(3);
      expect(result.lanes.map(lane => lane.roleId)).toEqual([architect.id, implementer.id, reviewer.id]);
      expect(result.lanes.every(lane => lane.status === 'review')).toBe(true);
      expect(result.lanes.every(lane => lane.runId)).toBe(true);
      expect(result.maxConcurrency).toBe(2);
      expect(maxActive).toBe(2);

      const lanePaths = result.lanes.map(lane => lane.worktreePath ?? '');
      expect(new Set(lanePaths).size).toBe(3);
      for (const lanePath of lanePaths) await access(lanePath);

      expect(result.lanes[0]?.changedFiles.sort()).toEqual(['SHARED.md', `${architect.id}.md`].sort());
      expect(result.lanes[2]?.changedFiles).toEqual([`${reviewer.id}.md`]);
      expect(result.conflicts).toEqual([
        { file: 'SHARED.md', roleIds: [architect.id, implementer.id] },
      ]);
      expect(result.taskStatus).toBe('review');
      expect(store.getTask(task.id)?.status).toBe('review');
      expect(store.listAudit({ taskId: task.id }).map(event => event.type)).toEqual(['task.created', 'parallel.executed']);

      expect(store.listRuns(task.id).map(run => run.roleId)).toEqual([architect.id, implementer.id, reviewer.id]);
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('accepts each lane in its own worktree and closes the task after the last lane', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-parallel-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const left = await store.roles.createRole({ name: 'Left', baseAgentId: 'codex' });
      const right = await store.roles.createRole({ name: 'Right', baseAgentId: 'codex' });
      const team = await store.teams.createTeam({ name: 'Pair', roleIds: [left.id, right.id] });
      const task = await store.createTask({ repo, baseRef: 'main', title: 'Pair', teamId: team.id });
      const provisioned = await store.provisionTask(task.id);

      const result = await store.executeParallelTeam(task.id, {
        runner: async (_command, _arguments, options) => {
          const roleId = basename(options.cwd);
          await writeFile(join(options.cwd, `${roleId}.md`), `${roleId}\n`, 'utf8');
          return success();
        },
      });
      const [leftLane, rightLane] = result.lanes;
      expect(store.getRun(leftLane?.runId ?? '')?.worktreePath).toBe(leftLane?.worktreePath);
      expect(store.getRun(leftLane?.runId ?? '')?.laneId).toBe(left.id);

      const acceptedLeft = await store.acceptRun(leftLane?.runId ?? '');
      expect(acceptedLeft.commitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(store.getTask(task.id)?.status).toBe('review');
      expect((await execFileAsync('git', ['status', '--porcelain'], { cwd: leftLane?.worktreePath ?? '' })).stdout.trim()).toBe('');
      expect((await execFileAsync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: leftLane?.worktreePath ?? '' })).stdout).toContain(`${left.id}.md`);
      expect((await execFileAsync('git', ['show-ref', '--verify', `refs/agent-ops/tasks/${task.id}/lanes/${left.id}`], { cwd: repo })).stdout).toContain(acceptedLeft.commitSha);

      await store.acceptRun(rightLane?.runId ?? '');
      expect(store.getTask(task.id)?.status).toBe('done');
      // The task's own worktree is untouched: lanes never merge into it.
      expect((await execFileAsync('git', ['status', '--porcelain'], { cwd: provisioned.worktreePath })).stdout.trim()).toBe('');
      expect(await access(join(provisioned.worktreePath, `${left.id}.md`)).then(() => true).catch(() => false)).toBe(false);
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('rejects a lane in place and leaves the parallel task open', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-parallel-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const left = await store.roles.createRole({ name: 'Left', baseAgentId: 'codex' });
      const right = await store.roles.createRole({ name: 'Right', baseAgentId: 'codex' });
      const team = await store.teams.createTeam({ name: 'Pair', roleIds: [left.id, right.id] });
      const task = await store.createTask({ repo, baseRef: 'main', title: 'Pair', teamId: team.id });
      await store.provisionTask(task.id);

      const result = await store.executeParallelTeam(task.id, {
        runner: async (_command, _arguments, options) => {
          await writeFile(join(options.cwd, `${basename(options.cwd)}.md`), 'x\n', 'utf8');
          return success();
        },
      });
      const [, rightLane] = result.lanes;
      await store.rejectRun(rightLane?.runId ?? '');
      expect(store.getTask(task.id)?.status).toBe('review');
      expect(store.getRun(rightLane?.runId ?? '')?.status).toBe('queued');
      expect((await execFileAsync('git', ['status', '--porcelain'], { cwd: rightLane?.worktreePath ?? '' })).stdout.trim()).toBe('');
      expect(await access(join(rightLane?.worktreePath ?? '', `${right.id}.md`)).then(() => true).catch(() => false)).toBe(false);
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('keeps a failed lane from stopping the others and refuses an unprovisioned task', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-parallel-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const good = await store.roles.createRole({ name: 'Good', baseAgentId: 'codex' });
      const bad = await store.roles.createRole({ name: 'Bad', baseAgentId: 'codex' });
      const team = await store.teams.createTeam({ name: 'Mixed', roleIds: [good.id, bad.id] });
      const task = await store.createTask({ repo, baseRef: 'main', title: 'Mixed', teamId: team.id });
      await store.provisionTask(task.id);

      const result = await store.executeParallelTeam(task.id, {
        maxConcurrency: 2,
        runner: async (_command, _arguments, options) => {
          if (basename(options.cwd) === bad.id) return { ...success('boom'), exitCode: 1 };
          await writeFile(join(options.cwd, 'GOOD.md'), 'ok\n', 'utf8');
          return success();
        },
      });
      expect(result.lanes.map(lane => lane.status)).toEqual(['review', 'failed']);
      expect(result.taskStatus).toBe('review');
      expect(result.conflicts).toEqual([]);

      const fresh = await store.createTask({ repo, baseRef: 'main', title: 'Unprovisioned', teamId: team.id });
      await expect(store.executeParallelTeam(fresh.id, {})).rejects.toThrow('no worktree');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
});
