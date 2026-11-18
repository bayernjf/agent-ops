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
        body: JSON.stringify({ repo: '/tmp/repo', baseRef: 'main', title: 'Rename bin' }),
      });
      expect(created.status).toBe(201);
      const task = (await created.json()) as { id: string; status: string };
      expect(task.id).toBeTruthy();
      expect(task.status).toBe('queued');

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
      expect((await executed.json()) as object).toMatchObject({ status: 'review' });

      const accepted = await app.request(`/api/runs/${run.id}/accept`, { method: 'POST' });
      expect(accepted.status).toBe(200);
      expect((await accepted.json()) as object).toMatchObject({ status: 'done' });

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
