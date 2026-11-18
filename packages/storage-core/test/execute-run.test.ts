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

const fakeRunner = (exitCode: number): CodexProcessRunner => async () => ({
  exitCode,
  signal: null,
  timedOut: false,
  output: 'ok',
  startedAt: new Date().toISOString(),
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
      const run = await store.createRun(task.id, 'codex');

      // Simulate the agent producing a change inside the worktree.
      await writeFile(join(task.worktreePath, 'NEW.md'), '# new\n', 'utf8');
      await execFileAsync('git', ['add', '-A'], { cwd: task.worktreePath });
      await execFileAsync('git', ['-c', 'user.name=Agent', '-c', 'user.email=agent@localhost', 'commit', '-qm', 'agent change'], { cwd: task.worktreePath });

      const executed = await store.executeRun(run.id, fakeRunner(0));
      expect(executed.status).toBe('review');
      expect(executed.diffStat).toContain('NEW.md');
      expect(store.getTask(task.id)?.status).toBe('review');
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

      const executed = await store.executeRun(run.id, fakeRunner(1));
      expect(executed.status).toBe('failed');
      expect(store.getTask(task.id)?.status).toBe('failed');
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
      expect(store.getTask(task.id)?.status).toBe('done');
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

      const rejected = await store.rejectRun(run.id);
      expect(rejected.status).toBe('queued');
      expect(store.getTask(task.id)?.status).toBe('queued');
      // The rejected run is queued again and can be re-executed.
      await expect(store.executeRun(run.id, fakeRunner(0))).resolves.toMatchObject({ status: 'review' });
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
