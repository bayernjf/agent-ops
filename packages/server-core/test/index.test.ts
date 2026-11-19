import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { KernelStore } from '@agent-ops/storage-core';
import type { CodexProcessRunner } from '@agent-ops/agent-runtime';
import { createKernelApp } from '../src/index.js';

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

// KernelStore persists to a file, so each test gets its own temp directory.
async function openStore(): Promise<{ store: KernelStore; directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'agent-ops-server-'));
  const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
  return { store, directory };
}

const fakeRunner = (exitCode: number): CodexProcessRunner => async () => ({
  exitCode,
  signal: null,
  timedOut: false,
  output: 'ok',
  startedAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
});

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
  if (options.signal?.aborted) finish();
  else options.signal?.addEventListener('abort', finish, { once: true });
});

describe('createKernelApp', () => {
  it('answers the health probe without a token', async () => {
    const { store, directory } = await openStore();
    try {
      const app = createKernelApp(store);
      const res = await app.request('/api/health');
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ service: 'agent-ops-daemon', status: 'ok' });
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('mounts task routes without the diagnostics surface when asked', async () => {
    const { store, directory } = await openStore();
    try {
      const app = createKernelApp(store, { diagnostics: false });
      for (const path of ['/api/health', '/api/doctor', '/api/runtime/probe', '/api/runtime/catalog']) {
        expect((await app.request(path)).status).toBe(404);
      }
      expect((await app.request('/api/tasks')).status).toBe(200);
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('closes task routes behind the bearer token when one is configured', async () => {
    const { store, directory } = await openStore();
    try {
      const app = createKernelApp(store, { authToken: 'secret' });

      const anon = await app.request('/api/tasks');
      expect(anon.status).toBe(401);

      const authorized = await app.request('/api/tasks', {
        headers: { Authorization: 'Bearer secret' },
      });
      expect(authorized.status).toBe(200);
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('creates, lists and reads tasks', async () => {
    const { store, directory } = await openStore();
    try {
      const app = createKernelApp(store);

      const created = await app.request('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: '/tmp/repo',
          baseRef: 'main',
          title: 'Rename bin',
          acceptanceCriteria: ['The bin is renamed.', 'Help text is updated.'],
          priority: 'high',
        }),
      });
      expect(created.status).toBe(201);
      const task = (await created.json()) as {
        id: string;
        status: string;
        acceptanceCriteria: string[];
        priority: string;
      };
      expect(task.id).toBeTruthy();
      expect(task.status).toBe('queued');
      expect(task.acceptanceCriteria).toEqual(['The bin is renamed.', 'Help text is updated.']);
      expect(task.priority).toBe('high');

      const list = await app.request('/api/tasks');
      expect(((await list.json()) as unknown[]).length).toBe(1);

      const got = await app.request(`/api/tasks/${task.id}`);
      expect(got.status).toBe(200);
      expect((await got.json()) as object).toMatchObject({ title: 'Rename bin' });

      const missing = await app.request('/api/tasks/unknown');
      expect(missing.status).toBe(404);
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects a task payload missing required fields with a 400', async () => {
    const { store, directory } = await openStore();
    try {
      const app = createKernelApp(store);
      const res = await app.request('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'no repo' }),
      });
      expect(res.status).toBe(400);
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('provisions, executes, and accepts a run end to end', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-server-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const app = createKernelApp(store, { runner: fakeRunner(0) });

      const created = await app.request('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo, baseRef: 'main', title: 'Rename bin' }),
      });
      const task = (await created.json()) as { id: string };

      const provisioned = await app.request(`/api/tasks/${task.id}/provision`, { method: 'POST' });
      expect(provisioned.status).toBe(200);
      expect(((await provisioned.json()) as { worktreePath: string }).worktreePath).toBeTruthy();

      const runRes = await app.request(`/api/tasks/${task.id}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'local-codex' }),
      });
      expect(runRes.status).toBe(201);
      const run = (await runRes.json()) as { id: string };

      const executed = await app.request(`/api/runs/${run.id}/execute`, { method: 'POST' });
      expect(executed.status).toBe(200);
      expect((await executed.json()) as object).toMatchObject({
        status: 'review',
        artifacts: { output: 'ok', exitCode: 0, timedOut: false },
      });

      const runDetail = await app.request(`/api/runs/${run.id}`);
      expect(runDetail.status).toBe(200);
      expect((await runDetail.json()) as object).toMatchObject({
        artifacts: { output: 'ok', exitCode: 0 },
      });

      const events = await app.request(`/api/runs/${run.id}/events`);
      expect(events.status).toBe(200);
      expect(events.headers.get('content-type')).toContain('text/event-stream');
      expect(await events.text()).toContain('event: completed');

      const accepted = await app.request(`/api/runs/${run.id}/accept`, { method: 'POST' });
      expect(accepted.status).toBe(200);
      expect((await accepted.json()) as object).toMatchObject({
        status: 'done',
        artifacts: { output: 'ok' },
      });

      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('replays terminal SSE events after the daemon store is reopened', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-server-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const databasePath = join(directory, 'agent-ops.sqlite');
      const store = await KernelStore.open(databasePath);
      const app = createKernelApp(store, { runner: fakeRunner(0) });

      const task = await store.createTask({ repo, baseRef: 'main', title: 'Replay me' });
      await store.provisionTask(task.id);
      const run = await store.createRun(task.id, 'codex');
      const executed = await app.request(`/api/runs/${run.id}/execute`, { method: 'POST' });
      expect(executed.status).toBe(200);
      await store.close();

      const reopened = await KernelStore.open(databasePath);
      const restarted = createKernelApp(reopened);
      const events = await restarted.request(`/api/runs/${run.id}/events`);
      expect(events.status).toBe(200);
      expect(await events.text()).toContain('event: completed');
      await reopened.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('cancels a running execution through the HTTP surface', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-server-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const app = createKernelApp(store, { runner: slowRunner });

      const task = await store.createTask({ repo, baseRef: 'main', title: 'Cancel me' });
      await store.provisionTask(task.id);
      const run = await store.createRun(task.id, 'codex');

      const execution = app.request(`/api/runs/${run.id}/execute`, { method: 'POST' });
      for (let attempt = 0; attempt < 100 && store.getRun(run.id)?.status !== 'running'; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const cancelled = await app.request(`/api/runs/${run.id}/cancel`, { method: 'POST' });
      expect(cancelled.status).toBe(200);
      expect((await cancelled.json()) as object).toMatchObject({ status: 'running' });

      const executed = (await (await execution).json()) as { status: string; artifacts: { cancelled: boolean } };
      expect(executed.status).toBe('cancelled');
      expect(executed.artifacts.cancelled).toBe(true);

      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects accepting a run that is not in review', async () => {
    const { store, directory } = await openStore();
    try {
      const app = createKernelApp(store);
      const task = await store.createTask({ repo: '/tmp/repo', baseRef: 'main', title: 'T' });
      const run = await store.createRun(task.id, 'local-codex');

      const res = await app.request(`/api/runs/${run.id}/accept`, { method: 'POST' });
      expect(res.status).toBe(409);
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
