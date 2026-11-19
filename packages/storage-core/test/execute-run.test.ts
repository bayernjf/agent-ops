import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

const fakeRunner = (exitCode: number, output = 'ok'): CodexProcessRunner => async () => ({
  exitCode,
  signal: null,
  timedOut: false,
  output,
  startedAt: new Date(Date.now() - 10).toISOString(),
  completedAt: new Date().toISOString(),
});

async function provisionedTask(store: KernelStore, repo: string) {
  const task = await store.createTask({ repo, baseRef: 'main', title: 'Rename bin', objective: 'Rename the CLI bin.' });
  return store.provisionTask(task.id);
}

describe('KernelStore executeRun', () => {
  it('runs a task in its worktree and records the diff for review', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-exec-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await provisionedTask(store, repo);
      const run = await store.createRun(task.id, 'local-codex');

      // Simulate the agent producing a change inside the worktree.
      await writeFile(join(task.worktreePath, 'NEW.md'), '# new\n', 'utf8');
      await execFileAsync('git', ['add', '-A'], { cwd: task.worktreePath });
      await execFileAsync('git', ['-c', 'user.name=Agent', '-c', 'user.email=agent@localhost', 'commit', '-qm', 'agent change'], { cwd: task.worktreePath });

      const executed = await store.executeRun(run.id, fakeRunner(0));
      expect(executed.status).toBe('review');
      expect(executed.runtimeId).toBe('codex');
      expect(executed.diffStat).toContain('NEW.md');
      expect(executed.artifacts).toMatchObject({ output: 'ok', exitCode: 0, timedOut: false });
      expect(executed.artifacts.diff).toContain('NEW.md');
      expect(executed.artifacts.changedFiles).toContain('NEW.md');
      expect(executed.artifacts.durationMs).toBeGreaterThanOrEqual(0);
      expect(store.getTask(task.id)?.status).toBe('review');
      await store.close();

      const reopened = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      expect(reopened.getRun(run.id)?.runtimeId).toBe('codex');
      expect(reopened.getRun(run.id)?.artifacts.diff).toContain('NEW.md');
      expect(reopened.getRun(run.id)?.artifacts.changedFiles).toContain('NEW.md');
      await reopened.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('runs a read-only reviewer Role without allowing a write', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-exec-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await provisionedTask(store, repo);
      const reviewer = await store.roles.createRole({
        name: 'Reviewer',
        baseAgentId: 'codex',
        runtimePolicy: { allowedTools: ['Read', 'Grep', 'Glob'], blockedTools: [], approvalMode: 'human' },
      });
      const run = await store.createRun(task.id, 'codex', reviewer.id);

      const guardedRunner: CodexProcessRunner = async (_command, arguments_, options) => {
        const sandboxIndex = arguments_.indexOf('--sandbox');
        if (arguments_[sandboxIndex + 1] !== 'read-only') {
          await writeFile(join(options.cwd, 'LEAK.md'), '# leaked\n', 'utf8');
        }
        return {
          exitCode: 0,
          signal: null,
          timedOut: false,
          output: 'review complete',
          startedAt: new Date(Date.now() - 10).toISOString(),
          completedAt: new Date().toISOString(),
        };
      };

      const executed = await store.executeRun(run.id, guardedRunner);
      expect(executed.status).toBe('review');
      expect(executed.runtimeId).toBe('codex');
      expect((await execFileAsync('git', ['status', '--porcelain'], { cwd: task.worktreePath })).stdout.trim()).toBe('');
      await expect(access(join(task.worktreePath, 'LEAK.md'))).rejects.toThrow();
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('refuses a restricted Role on a Runtime that cannot enforce it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-exec-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await provisionedTask(store, repo);
      const restricted = await store.roles.createRole({
        name: 'Hermes reviewer',
        baseAgentId: 'hermes',
        runtimePolicy: { allowedTools: [], blockedTools: ['Bash'], approvalMode: 'strict' },
      });
      const run = await store.createRun(task.id, 'hermes', restricted.id);

      await expect(store.executeRun(run.id, fakeRunner(0))).rejects.toThrow('cannot enforce a Role tool policy');
      expect(store.getRun(run.id)?.status).toBe('queued');
      expect(store.getTask(task.id)?.status).toBe('queued');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('includes untracked files the agent created without committing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-exec-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await provisionedTask(store, repo);
      const run = await store.createRun(task.id, 'codex');

      // Agent writes a file but never stages or commits it.
      await writeFile(join(task.worktreePath, 'UNTRACKED.md'), '# untracked\n', 'utf8');

      const executed = await store.executeRun(run.id, fakeRunner(0));
      expect(executed.status).toBe('review');
      expect(executed.diffStat).toContain('UNTRACKED.md');
      expect(executed.diffStat).toContain('untracked');
      expect(executed.artifacts.diff).toContain('UNTRACKED.md');
      expect(executed.artifacts.changedFiles).toContain('UNTRACKED.md');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('marks a run and task failed when the agent exits non-zero', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-exec-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await provisionedTask(store, repo);
      const run = await store.createRun(task.id, 'codex');

      const executed = await store.executeRun(run.id, fakeRunner(1, 'boom'));
      expect(executed.status).toBe('failed');
      expect(executed.artifacts).toMatchObject({ output: 'boom', exitCode: 1, timedOut: false });
      expect(store.getTask(task.id)?.status).toBe('failed');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('records timeout evidence when the agent process is killed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-exec-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await provisionedTask(store, repo);
      const run = await store.createRun(task.id, 'codex');
      const timeoutRunner: CodexProcessRunner = async () => ({
        exitCode: null,
        signal: null,
        timedOut: true,
        output: 'timed out',
        startedAt: new Date(Date.now() - 1000).toISOString(),
        completedAt: new Date().toISOString(),
      });

      const executed = await store.executeRun(run.id, timeoutRunner);
      expect(executed.status).toBe('failed');
      expect(executed.artifacts).toMatchObject({ output: 'timed out', timedOut: true });
      expect(executed.artifacts.exitCode).toBeNull();
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('caps persisted output instead of storing an unbounded agent log', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-exec-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await provisionedTask(store, repo);
      const run = await store.createRun(task.id, 'codex');

      const executed = await store.executeRun(run.id, fakeRunner(0, 'x'.repeat(70_000)));
      expect(executed.artifacts.outputTruncated).toBe(true);
      expect(executed.artifacts.output.length).toBeLessThan(70_000);
      expect(executed.artifacts.output).toContain('[truncated: 70000 characters total]');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('replays run events after reopening the store and keeps seq monotonic', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-exec-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await provisionedTask(store, repo);
      const run = await store.createRun(task.id, 'codex');
      await store.executeRun(run.id, fakeRunner(0));
      const before = store.getRunEvents(run.id);
      expect(before.map(event => event.type)).toEqual(['started', 'completed']);
      await store.close();

      const reopened = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      expect(reopened.getRunEvents(run.id).map(event => event.type)).toEqual(['started', 'completed']);
      const nextRun = await reopened.createRun(task.id, 'codex');
      await reopened.executeRun(nextRun.id, fakeRunner(0));
      const nextEvents = reopened.getRunEvents(nextRun.id);
      expect(nextEvents[0]?.seq).toBeGreaterThan(before.at(-1)?.seq ?? 0);
      await reopened.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('cancels an active run and persists cancelled evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-exec-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await provisionedTask(store, repo);
      const run = await store.createRun(task.id, 'codex');

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

      const execution = store.executeRun(run.id, slowRunner);
      const terminalStatuses: string[] = [];
      store.subscribeRunEvents(run.id, event => {
        if (event.type === 'cancelled') terminalStatuses.push(store.getRun(run.id)?.status ?? 'missing');
      });
      for (let attempt = 0; attempt < 100 && store.getRun(run.id)?.status !== 'running'; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      await store.cancelRun(run.id);
      const executed = await execution;

      expect(executed.status).toBe('cancelled');
      expect(executed.artifacts).toMatchObject({ cancelled: true, output: 'stopped' });
      expect(store.getTask(task.id)?.status).toBe('cancelled');
      expect(terminalStatuses).toEqual(['cancelled']);
      expect(store.getRunEvents(run.id).map(event => event.type))
        .toEqual(expect.arrayContaining(['started', 'stdout', 'cancelled']));
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('refuses to cancel a run that is not active', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-exec-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await provisionedTask(store, repo);
      const run = await store.createRun(task.id, 'codex');
      await expect(store.cancelRun(run.id)).rejects.toThrow('cannot be cancelled from status queued');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('refuses to run an unprovisioned task', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-exec-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await store.createTask({ repo, baseRef: 'main', title: 'T' });
      const run = await store.createRun(task.id, 'codex');
      await expect(store.executeRun(run.id, fakeRunner(0))).rejects.toThrow('Provision it before executing');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('refuses to execute a run already in review', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-exec-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await provisionedTask(store, repo);
      const run = await store.createRun(task.id, 'codex');
      await writeFile(join(task.worktreePath, 'NEW.md'), '# new\n', 'utf8');
      await execFileAsync('git', ['add', '-A'], { cwd: task.worktreePath });
      await execFileAsync('git', ['-c', 'user.name=Agent', '-c', 'user.email=agent@localhost', 'commit', '-qm', 'agent change'], { cwd: task.worktreePath });
      await store.executeRun(run.id, fakeRunner(0));

      await expect(store.executeRun(run.id, fakeRunner(0))).rejects.toThrow('cannot be executed from status review');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('accepts a reviewed run into done', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-exec-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await provisionedTask(store, repo);
      const run = await store.createRun(task.id, 'codex');
      await writeFile(join(task.worktreePath, 'NEW.md'), '# new\n', 'utf8');
      await execFileAsync('git', ['add', '-A'], { cwd: task.worktreePath });
      await execFileAsync('git', ['-c', 'user.name=Agent', '-c', 'user.email=agent@localhost', 'commit', '-qm', 'agent change'], { cwd: task.worktreePath });
      await store.executeRun(run.id, fakeRunner(0));

      const accepted = await store.acceptRun(run.id);
      expect(accepted.status).toBe('done');
      expect(accepted.commitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(store.getTask(task.id)?.status).toBe('done');
      const head = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: task.worktreePath })).stdout.trim();
      expect(accepted.commitSha).toBe(head);
      expect((await execFileAsync('git', ['status', '--porcelain'], { cwd: task.worktreePath })).stdout.trim()).toBe('');
      expect(
        (await execFileAsync('git', ['rev-parse', `refs/agent-ops/tasks/${task.id}`], { cwd: repo })).stdout.trim(),
      ).toBe(accepted.commitSha);

      await store.releaseTask(task.id);
      expect(store.getTask(task.id)?.worktreePath).toBe('');
      expect((await execFileAsync('git', ['cat-file', '-t', accepted.commitSha], { cwd: repo })).stdout.trim()).toBe('commit');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('commits an uncommitted agent change when the run is accepted', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-exec-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await provisionedTask(store, repo);
      const run = await store.createRun(task.id, 'codex');
      await writeFile(join(task.worktreePath, 'NEW.md'), '# new\n', 'utf8');
      await store.executeRun(run.id, fakeRunner(0));
      expect(store.getRun(run.id)?.status).toBe('review');

      const accepted = await store.acceptRun(run.id);
      expect(accepted.commitSha).toMatch(/^[0-9a-f]{40}$/);
      expect((await execFileAsync('git', ['log', '-1', '--format=%s'], { cwd: task.worktreePath })).stdout.trim())
        .toBe('task: accept Rename bin');
      expect((await execFileAsync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: task.worktreePath })).stdout)
        .toContain('NEW.md');
      expect((await execFileAsync('git', ['status', '--porcelain'], { cwd: task.worktreePath })).stdout.trim()).toBe('');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('refuses to accept a run that would commit a .env file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-exec-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await provisionedTask(store, repo);
      const run = await store.createRun(task.id, 'codex');
      await writeFile(join(task.worktreePath, '.env'), 'SECRET=1\n', 'utf8');
      await store.executeRun(run.id, fakeRunner(0));

      await expect(store.acceptRun(run.id)).rejects.toThrow('would enter the repository');
      expect(store.getRun(run.id)?.status).toBe('review');
      expect((await execFileAsync('git', ['status', '--porcelain'], { cwd: task.worktreePath })).stdout)
        .toContain('.env');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('rejects a reviewed run back to queued so it can run again', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-exec-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await provisionedTask(store, repo);
      const run = await store.createRun(task.id, 'codex');
      await writeFile(join(task.worktreePath, 'NEW.md'), '# new\n', 'utf8');
      await execFileAsync('git', ['add', '-A'], { cwd: task.worktreePath });
      await execFileAsync('git', ['-c', 'user.name=Agent', '-c', 'user.email=agent@localhost', 'commit', '-qm', 'agent change'], { cwd: task.worktreePath });
      await store.executeRun(run.id, fakeRunner(0));
      expect(store.getRunEvents(run.id).map(event => event.type)).toEqual(['started', 'completed']);

      const rejected = await store.rejectRun(run.id);
      expect(rejected.status).toBe('queued');
      expect(store.getTask(task.id)?.status).toBe('queued');
      // Reject resets the worktree to the provisioned base commit, including the agent's commit.
      expect((await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: task.worktreePath })).stdout.trim()).toBe(store.getTask(task.id)?.baseCommit);
      expect((await execFileAsync('git', ['status', '--porcelain'], { cwd: task.worktreePath })).stdout.trim()).toBe('');
      await expect(access(join(task.worktreePath, 'NEW.md'))).rejects.toThrow();
      // The rejected run is queued again and can be re-executed.
      await expect(store.executeRun(run.id, fakeRunner(0))).resolves.toMatchObject({ status: 'review' });
      // A new attempt must not replay the previous terminal event to SSE subscribers.
      expect(store.getRunEvents(run.id).map(event => event.type)).toEqual(['started', 'completed']);
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('refuses to accept or reject a run that is not in review', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-exec-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await provisionedTask(store, repo);
      const run = await store.createRun(task.id, 'codex');

      await expect(store.acceptRun(run.id)).rejects.toThrow('cannot be accepted from status queued');
      await expect(store.rejectRun(run.id)).rejects.toThrow('cannot be rejected from status queued');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
});
