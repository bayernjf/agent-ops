import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

  it('serves and executes a task pipeline through the API', async () => {
    const { store, directory } = await openStore();
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const runner: CodexProcessRunner = async (_command, _arguments, options) => {
        await writeFile(join(options.cwd, 'pipeline.txt'), 'done\n', 'utf8');
        return {
          exitCode: 0,
          signal: null,
          timedOut: false,
          output: 'ok',
          startedAt: new Date(Date.now() - 10).toISOString(),
          completedAt: new Date().toISOString(),
        };
      };
      const app = createKernelApp(store, { runner });
      const task = await store.createTask({
        repo,
        baseRef: 'main',
        title: 'Pipeline over HTTP',
        pipeline: { steps: [{ id: 'deliver', name: 'Deliver', agentId: 'codex' }] },
      });
      await store.provisionTask(task.id);

      const read = await app.request(`/api/tasks/${task.id}/pipeline`);
      expect(read.status).toBe(200);
      expect((await read.json()) as object).toMatchObject({ status: 'idle' });

      const executed = await app.request(`/api/tasks/${task.id}/pipeline/execute`, { method: 'POST' });
      expect(executed.status).toBe(200);
      expect((await executed.json()) as object).toMatchObject({
        status: 'completed',
        results: [{ stepId: 'deliver', status: 'completed' }],
      });
      expect(store.getTask(task.id)?.status).toBe('done');

      const plain = await store.createTask({ repo, baseRef: 'main', title: 'No pipeline' });
      expect((await app.request(`/api/tasks/${plain.id}/pipeline`)).status).toBe(404);
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('serves handoff receipts for a task and its runs', async () => {
    const { store, directory } = await openStore();
    try {
      const repo = await initRepo(join(directory, 'repo'));
      let calls = 0;
      const runner: CodexProcessRunner = async (_command, _arguments, options) => {
        calls++;
        await writeFile(join(options.cwd, `handoff-${calls}.txt`), 'done\n', 'utf8');
        return {
          exitCode: 0,
          signal: null,
          timedOut: false,
          output: 'ok',
          startedAt: new Date(Date.now() - 10).toISOString(),
          completedAt: new Date().toISOString(),
        };
      };
      const app = createKernelApp(store, { runner });
      const task = await store.createTask({
        repo,
        baseRef: 'main',
        title: 'Handoff over HTTP',
        pipeline: {
          steps: [
            { id: 'build', name: 'Build', agentId: 'codex' },
            { id: 'ship', name: 'Ship', agentId: 'codex' },
          ],
        },
      });
      await store.provisionTask(task.id);
      await app.request(`/api/tasks/${task.id}/pipeline/execute`, { method: 'POST' });

      const listed = await app.request(`/api/tasks/${task.id}/handoffs`);
      expect(listed.status).toBe(200);
      const { handoffs } = (await listed.json()) as { handoffs: Array<{ fromStepId: string; toStepId: string; fromCommitSha: string; toRunId: string; teamId: string | null }> };
      expect(handoffs).toHaveLength(1);
      expect(handoffs[0]).toMatchObject({ fromStepId: 'build', toStepId: 'ship', teamId: null });
      expect(handoffs[0]?.fromCommitSha).toMatch(/^[0-9a-f]{40}$/);
      expect((await app.request('/api/tasks/missing/handoffs')).status).toBe(404);

      const downstream = await app.request(`/api/runs/${handoffs[0]?.toRunId}`);
      expect((await downstream.json()) as object).toMatchObject({
        handoff: { fromStepId: 'build', fromCommitSha: handoffs[0]?.fromCommitSha },
      });
      const upstreamRunId = store.listRuns(task.id)[0]?.id ?? '';
      const upstream = await app.request(`/api/runs/${upstreamRunId}`);
      expect(((await upstream.json()) as { handoff: unknown }).handoff).toBeNull();
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('serves approval gates over the pipeline API', async () => {
    const { store, directory } = await openStore();
    try {
      const repo = await initRepo(join(directory, 'repo'));
      let calls = 0;
      const runner: CodexProcessRunner = async (_command, _arguments, options) => {
        calls++;
        await writeFile(join(options.cwd, `gated-${calls}.txt`), 'done\n', 'utf8');
        return {
          exitCode: 0,
          signal: null,
          timedOut: false,
          output: 'ok',
          startedAt: new Date(Date.now() - 10).toISOString(),
          completedAt: new Date().toISOString(),
        };
      };
      const app = createKernelApp(store, { runner });
      const task = await store.createTask({
        repo,
        baseRef: 'main',
        title: 'Gated pipeline over HTTP',
        pipeline: {
          steps: [
            { id: 'gated', name: 'Gated', agentId: 'codex', requiresApproval: true },
            { id: 'tail', name: 'Tail', agentId: 'codex' },
          ],
        },
      });
      await store.provisionTask(task.id);

      const executed = await app.request(`/api/tasks/${task.id}/pipeline/execute`, { method: 'POST' });
      expect(executed.status).toBe(200);
      expect((await executed.json()) as object).toMatchObject({ status: 'awaiting_approval' });
      expect(calls).toBe(1);

      const approved = await app.request(`/api/tasks/${task.id}/pipeline/approve`, { method: 'POST' });
      expect(approved.status).toBe(200);
      expect((await approved.json()) as object).toMatchObject({
        status: 'completed',
        results: [
          { stepId: 'gated', status: 'completed' },
          { stepId: 'tail', status: 'completed' },
        ],
      });
      expect(calls).toBe(2);

      // A second approval has nothing left to gate.
      const again = await app.request(`/api/tasks/${task.id}/pipeline/approve`, { method: 'POST' });
      expect(again.status).toBe(409);
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects a gated pipeline step over the API', async () => {
    const { store, directory } = await openStore();
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const runner: CodexProcessRunner = async (_command, _arguments, options) => {
        await writeFile(join(options.cwd, 'rejected.txt'), 'done\n', 'utf8');
        return {
          exitCode: 0,
          signal: null,
          timedOut: false,
          output: 'ok',
          startedAt: new Date(Date.now() - 10).toISOString(),
          completedAt: new Date().toISOString(),
        };
      };
      const app = createKernelApp(store, { runner });
      const task = await store.createTask({
        repo,
        baseRef: 'main',
        title: 'Rejected gate over HTTP',
        pipeline: { steps: [{ id: 'gated', name: 'Gated', agentId: 'codex', requiresApproval: true }] },
      });
      await store.provisionTask(task.id);

      const executed = await app.request(`/api/tasks/${task.id}/pipeline/execute`, { method: 'POST' });
      expect((await executed.json()) as object).toMatchObject({ status: 'awaiting_approval' });

      const rejected = await app.request(`/api/tasks/${task.id}/pipeline/reject`, { method: 'POST' });
      expect(rejected.status).toBe(200);
      expect((await rejected.json()) as object).toMatchObject({
        status: 'failed',
        results: [{ stepId: 'gated', status: 'failed', error: 'Rejected by operator.' }],
      });
      expect(store.getTask(task.id)?.status).toBe('failed');
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

  it('retries a failed pipeline over the HTTP API', async () => {
    const { store, directory } = await openStore();
    try {
      const repo = await initRepo(join(directory, 'repo'));
      let attempts = 0;
      const runner: CodexProcessRunner = async (_command, _arguments, options) => {
        attempts++;
        if (attempts === 1) {
          await writeFile(join(options.cwd, 'failed.txt'), 'first attempt\n', 'utf8');
          return {
            exitCode: 1,
            signal: null,
            timedOut: false,
            output: 'boom',
            startedAt: new Date(Date.now() - 10).toISOString(),
            completedAt: new Date().toISOString(),
          };
        }
        await writeFile(join(options.cwd, 'retried.txt'), 'retry\n', 'utf8');
        return {
          exitCode: 0,
          signal: null,
          timedOut: false,
          output: 'ok',
          startedAt: new Date(Date.now() - 10).toISOString(),
          completedAt: new Date().toISOString(),
        };
      };
      const app = createKernelApp(store, { runner });
      const task = await store.createTask({
        repo,
        baseRef: 'main',
        title: 'Retry over HTTP',
        pipeline: { steps: [{ id: 'deliver', name: 'Deliver', agentId: 'codex' }] },
      });
      const provisioned = await store.provisionTask(task.id);

      const failed = await app.request(`/api/tasks/${task.id}/pipeline/execute`, { method: 'POST' });
      expect(failed.status).toBe(200);
      expect((await failed.json()) as object).toMatchObject({ status: 'failed' });

      const retried = await app.request(`/api/tasks/${task.id}/pipeline/retry`, { method: 'POST' });
      expect(retried.status).toBe(200);
      expect((await retried.json()) as object).toMatchObject({
        results: [{ stepId: 'deliver', status: 'completed' }],
        status: 'completed',
      });
      expect(attempts).toBe(2);
      expect(store.getTask(task.id)?.status).toBe('done');
      expect((await execFileAsync('git', ['rev-list', '--count', 'HEAD'], { cwd: provisioned.worktreePath })).stdout.trim()).toBe('2');
      expect((await execFileAsync('git', ['status', '--porcelain'], { cwd: provisioned.worktreePath })).stdout.trim()).toBe('');

      const again = await app.request(`/api/tasks/${task.id}/pipeline/retry`, { method: 'POST' });
      expect(again.status).toBe(409);
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('creates, resolves, updates and deletes roles through the kernel API', async () => {
    const { store, directory } = await openStore();
    try {
      const app = createKernelApp(store);

      const created = await app.request('/api/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Reviewer',
          baseAgentId: 'codex',
          acceptanceCriteria: ['Read the diff without writes.'],
          runtimePolicy: { allowedTools: ['Read'], blockedTools: ['Write', 'Edit'], approvalMode: 'strict' },
        }),
      });
      expect(created.status).toBe(201);
      const role = (await created.json()) as { role: { id: string; name: string; runtimePolicy: object } };
      expect(role.role).toMatchObject({
        id: 'reviewer',
        name: 'Reviewer',
        runtimePolicy: { blockedTools: ['Write', 'Edit'], approvalMode: 'strict' },
      });

      const listed = await app.request('/api/roles');
      expect(((await listed.json()) as { roles: unknown[] }).roles).toHaveLength(1);

      const resolved = await app.request(`/api/roles/${role.role.id}/resolve`);
      expect(resolved.status).toBe(200);
      expect((await resolved.json()) as object).toMatchObject({
        resolution: {
          executable: true,
          baseAgentId: 'codex',
          adapterStatus: 'verified',
        },
      });

      const updated = await app.request(`/api/roles/${role.role.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      expect(updated.status).toBe(200);
      expect((await updated.json()) as object).toMatchObject({ role: { enabled: false } });

      const deleted = await app.request(`/api/roles/${role.role.id}`, { method: 'DELETE' });
      expect(deleted.status).toBe(200);
      expect((await app.request(`/api/roles/${role.role.id}`)).status).toBe(404);
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('creates, lists, updates and deletes teams through the kernel API', async () => {
    const { store, directory } = await openStore();
    try {
      const app = createKernelApp(store);
      const createRole = async (name: string) => {
        const res = await app.request('/api/roles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, baseAgentId: 'codex' }),
        });
        expect(res.status).toBe(201);
        return ((await res.json()) as { role: { id: string } }).role;
      };
      const architect = await createRole('Architect');
      const implementer = await createRole('Implementer');

      const created = await app.request('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Delivery',
          roleIds: [architect.id, implementer.id],
          handoffs: [{ fromRoleId: architect.id, toRoleId: implementer.id, note: 'Hand over the plan.' }],
        }),
      });
      expect(created.status).toBe(201);
      const team = ((await created.json()) as { team: { id: string; handoffs: unknown[] } }).team;
      expect(team.id).toBe('delivery');
      expect(team.handoffs).toHaveLength(1);

      expect(((await (await app.request('/api/teams')).json()) as { teams: unknown[] }).teams).toHaveLength(1);
      expect((await app.request(`/api/teams/${team.id}`)).status).toBe(200);

      const updated = await app.request(`/api/teams/${team.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Delivery team' }),
      });
      expect(updated.status).toBe(200);
      expect((await updated.json()) as object).toMatchObject({ team: { name: 'Delivery team' } });

      const cycle = await app.request('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Loop',
          roleIds: [architect.id, implementer.id],
          handoffs: [
            { fromRoleId: architect.id, toRoleId: implementer.id },
            { fromRoleId: implementer.id, toRoleId: architect.id },
          ],
        }),
      });
      expect(cycle.status).toBe(400);
      expect(await cycle.text()).toContain('Handoff cycle detected');

      const unknownRole = await app.request('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Ghost', roleIds: ['missing-role'] }),
      });
      expect(unknownRole.status).toBe(404);

      const deleted = await app.request(`/api/teams/${team.id}`, { method: 'DELETE' });
      expect(deleted.status).toBe(200);
      expect((await app.request(`/api/teams/${team.id}`)).status).toBe(404);
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('serves audit events with task, team and type filters', async () => {
    const { store, directory } = await openStore();
    try {
      const app = createKernelApp(store);
      const role = await store.roles.createRole({ name: 'Auditor', baseAgentId: 'codex' });
      const team = await store.teams.createTeam({ name: 'Audit team', roleIds: [role.id] });
      const task = await store.createTask({ repo: '/r', baseRef: 'main', title: 'Audited', roleId: role.id, teamId: team.id });

      const all = await app.request('/api/audit');
      expect(all.status).toBe(200);
      const { events } = (await all.json()) as { events: Array<{ type: string; taskId: string | null }> };
      expect(events.map(event => event.type)).toEqual(['role.created', 'team.created', 'task.created']);

      const byTask = await app.request(`/api/audit?taskId=${task.id}`);
      expect(((await byTask.json()) as { events: unknown[] }).events).toHaveLength(1);

      const byTeamAndType = await app.request(`/api/audit?teamId=${team.id}&type=team.created`);
      expect(((await byTeamAndType.json()) as { events: Array<{ type: string }> }).events.map(event => event.type)).toEqual(['team.created']);

      const limited = await app.request('/api/audit?limit=1');
      expect(((await limited.json()) as { events: Array<{ type: string }> }).events.map(event => event.type)).toEqual(['task.created']);
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('exports a task evidence bundle over the API', async () => {
    const { store, directory } = await openStore();
    try {
      const app = createKernelApp(store);
      const task = await store.createTask({ repo: '/r', baseRef: 'main', title: 'Export me' });

      const response = await app.request(`/api/tasks/${task.id}/export`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-disposition')).toContain(task.id);
      const body = (await response.json()) as {
        task: { id: string };
        totals: { runs: number; costUsd: number | null };
        audit: Array<{ type: string }>;
      };
      expect(body.task.id).toBe(task.id);
      expect(body.totals.runs).toBe(0);
      expect(body.totals.costUsd).toBeNull();
      expect(body.audit.map(event => event.type)).toContain('task.created');

      expect((await app.request('/api/tasks/missing/export')).status).toBe(404);
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('lists role templates and creates a role from one', async () => {
    const { store, directory } = await openStore();
    try {
      const app = createKernelApp(store);
      const listed = await app.request('/api/role-templates');
      expect(listed.status).toBe(200);
      const { templates } = (await listed.json()) as { templates: Array<{ id: string }> };
      expect(templates.map(template => template.id)).toEqual(['architect', 'implementer', 'reviewer', 'tester', 'researcher']);

      const created = await app.request('/api/role-templates/reviewer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Strict reviewer' }),
      });
      expect(created.status).toBe(201);
      const body = (await created.json()) as { templateId: string; role: { name: string; baseAgentId: string; systemPrompt: string; runtimePolicy: { approvalMode: string } } };
      expect(body.templateId).toBe('reviewer');
      expect(body.role).toMatchObject({ name: 'Strict reviewer', baseAgentId: 'codex', runtimePolicy: { approvalMode: 'strict' } });
      expect(body.role.systemPrompt).toContain('Review the diff');

      expect((await app.request('/api/role-templates/missing', { method: 'POST', body: '{}' })).status).toBe(404);

      const candidate = await app.request('/api/role-templates/architect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseAgentId: 'claude-code' }),
      });
      expect(candidate.status).toBe(400);
      expect(await candidate.text()).toContain('not verified');
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('serves a role test plan over the API', async () => {
    const { store, directory } = await openStore();
    try {
      const app = createKernelApp(store);
      const role = await store.roles.createRole({ name: 'Probe', baseAgentId: 'codex' });

      const response = await app.request(`/api/roles/${role.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objective: 'Check the plan.' }),
      });
      expect(response.status).toBe(200);
      const { plan } = (await response.json()) as { plan: { roleId: string; executable: boolean; objective: string; command: string[] } };
      expect(plan).toMatchObject({ roleId: role.id, executable: true, objective: 'Check the plan.' });
      expect(plan.command[0]).toBe('codex');

      expect((await app.request('/api/roles/missing/test', { method: 'POST', body: '{}' })).status).toBe(404);
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('serves kernel metrics with an optional window', async () => {
    const { store, directory } = await openStore();
    try {
      const app = createKernelApp(store);
      const response = await app.request('/api/metrics');
      expect(response.status).toBe(200);
      const metrics = (await response.json()) as {
        runs: { successRate: number | null };
        usage: { costUsd: number | null };
        byRuntime: unknown[];
      };
      expect(metrics.runs.successRate).toBeNull();
      expect(metrics.usage.costUsd).toBeNull();
      expect(metrics.byRuntime).toEqual([]);

      const windowed = await app.request('/api/metrics?since=2026-01-01T00:00:00.000Z&until=2026-01-02T00:00:00.000Z');
      expect(windowed.status).toBe(200);
      expect(((await windowed.json()) as { window: { since: string } }).window.since).toBe('2026-01-01T00:00:00.000Z');

      const scoped = await app.request('/api/metrics?teamId=team-a');
      expect(((await scoped.json()) as { teamId: string }).teamId).toBe('team-a');

      expect((await app.request('/api/metrics?since=not-a-date')).status).toBe(400);
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('plans, applies and summarizes a team pipeline over the API', async () => {
    const { store, directory } = await openStore();
    try {
      const app = createKernelApp(store);
      const architect = await store.roles.createRole({ name: 'Architect', baseAgentId: 'codex' });
      const implementer = await store.roles.createRole({ name: 'Implementer', baseAgentId: 'codex' });
      const team = await store.teams.createTeam({
        name: 'Delivery',
        roleIds: [implementer.id, architect.id],
        handoffs: [{ fromRoleId: architect.id, toRoleId: implementer.id }],
      });
      const task = await store.createTask({ repo: '/r', baseRef: 'main', title: 'Coordinated', teamId: team.id });

      const planned = await app.request(`/api/tasks/${task.id}/coordinator/plan`, { method: 'POST' });
      expect(planned.status).toBe(200);
      const { plan } = (await planned.json()) as { plan: { order: string[]; steps: unknown[] } };
      expect(plan.order).toEqual([architect.id, implementer.id]);
      expect(plan.steps).toHaveLength(2);

      const applied = await app.request(`/api/tasks/${task.id}/coordinator/apply`, { method: 'POST' });
      expect(applied.status).toBe(200);
      expect(((await applied.json()) as { pipeline: { status: string; steps: unknown[] } }).pipeline).toMatchObject({ status: 'idle' });

      const summary = await app.request(`/api/tasks/${task.id}/coordinator`);
      expect(summary.status).toBe(200);
      expect(((await summary.json()) as { summary: object }).summary).toMatchObject({ pipelineStatus: 'idle', completed: 0 });

      const teamless = await store.createTask({ repo: '/r', baseRef: 'main', title: 'Teamless' });
      expect((await app.request(`/api/tasks/${teamless.id}/coordinator/plan`, { method: 'POST' })).status).toBe(400);
      expect((await app.request('/api/tasks/missing/coordinator')).status).toBe(404);
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('executes parallel lanes over the API', async () => {
    const { store, directory } = await openStore();
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const runner: CodexProcessRunner = async (_command, _arguments, options) => {
        await writeFile(join(options.cwd, 'lane.md'), 'lane\n', 'utf8');
        return {
          exitCode: 0,
          signal: null,
          timedOut: false,
          output: 'ok',
          startedAt: new Date(Date.now() - 5).toISOString(),
          completedAt: new Date().toISOString(),
        };
      };
      const app = createKernelApp(store, { runner });
      const left = await store.roles.createRole({ name: 'Left', baseAgentId: 'codex' });
      const right = await store.roles.createRole({ name: 'Right', baseAgentId: 'codex' });
      const team = await store.teams.createTeam({ name: 'Parallel', roleIds: [left.id, right.id] });
      const task = await store.createTask({ repo, baseRef: 'main', title: 'Parallel', teamId: team.id });
      await store.provisionTask(task.id);

      const response = await app.request(`/api/tasks/${task.id}/parallel/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxConcurrency: 2 }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        lanes: Array<{ roleId: string; status: string }>;
        conflicts: Array<{ file: string; roleIds: string[] }>;
        taskStatus: string;
        maxConcurrency: number;
      };
      expect(body).toMatchObject({ taskStatus: 'review', maxConcurrency: 2 });
      expect(body.lanes.map(lane => lane.roleId)).toEqual([left.id, right.id]);
      expect(body.lanes.every(lane => lane.status === 'review')).toBe(true);
      expect(body.conflicts).toEqual([{ file: 'lane.md', roleIds: [left.id, right.id] }]);

      const invalid = await app.request(`/api/tasks/${task.id}/parallel/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxConcurrency: 0 }),
      });
      expect(invalid.status).toBe(400);
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('validates the rerun worktree policy on execute', async () => {
    const { store, directory } = await openStore();
    try {
      const app = createKernelApp(store);
      const task = await store.createTask({ repo: '/r', baseRef: 'main', title: 'Rerun' });
      const run = await store.createRun(task.id, 'codex');

      const invalid = await app.request(`/api/runs/${run.id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worktree: 'sideways' }),
      });
      expect(invalid.status).toBe(400);

      const accepted = await app.request(`/api/runs/${run.id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worktree: 'keep' }),
      });
      // The option is valid; the run still cannot start without a worktree.
      expect(accepted.status).toBe(409);
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('evaluates a tool policy across runtimes', async () => {
    const { store, directory } = await openStore();
    try {
      const app = createKernelApp(store);
      const response = await app.request('/api/policy/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowedTools: ['Read', 'Grep'], approvalMode: 'human' }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        policy: { approvalMode: string };
        verdicts: Array<{ runtimeId: string; enforcement: string; readOnly: boolean; approval: { mode: string; humanGate: boolean }; decisions: unknown[] }>;
      };
      expect(body.policy.approvalMode).toBe('human');
      expect(body.verdicts.find(verdict => verdict.runtimeId === 'codex')).toMatchObject({
        enforcement: 'exact',
        readOnly: true,
        approval: { mode: 'human', humanGate: true },
      });
      expect(body.verdicts.find(verdict => verdict.runtimeId === 'hermes')?.enforcement).toBe('unsupported');

      const invalid = await app.request('/api/policy/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowedTools: 'not-an-array' }),
      });
      expect(invalid.status).toBe(400);
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('serves a task budget status', async () => {
    const { store, directory } = await openStore();
    try {
      const app = createKernelApp(store);
      const role = await store.roles.createRole({ name: 'Budgeted', baseAgentId: 'codex', budget: { maxCostUsd: 5 } });
      const task = await store.createTask({ repo: '/r', baseRef: 'main', title: 'Budgeted', roleId: role.id });

      const response = await app.request(`/api/tasks/${task.id}/budget?roleId=${role.id}`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { role: { configured: boolean; exceeded: boolean; limits: { maxCostUsd: number }; spend: { totalRuns: number } } };
      expect(body.role).toMatchObject({ configured: true, exceeded: false, limits: { maxCostUsd: 5 }, spend: { totalRuns: 0 } });

      expect((await app.request('/api/tasks/missing/budget')).status).toBe(404);
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('refuses a role whose runtime is not verified or whose profile is missing', async () => {
    const { store, directory } = await openStore();
    try {
      const app = createKernelApp(store);
      const candidate = await app.request('/api/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Candidate', baseAgentId: 'claude-code' }),
      });
      expect(candidate.status).toBe(400);
      expect(await candidate.text()).toContain('not verified');

      const missingProfile = await app.request('/api/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Missing profile', profileId: 'does-not-exist' }),
      });
      expect(missingProfile.status).toBe(400);
      expect(await missingProfile.text()).toContain('was not found');
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

      const roleRes = await app.request('/api/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Runner', baseAgentId: 'codex' }),
      });
      expect(roleRes.status).toBe(201);
      const role = (await roleRes.json()) as { role: { id: string } };

      const created = await app.request('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo, baseRef: 'main', title: 'Rename bin', roleId: role.role.id }),
      });
      const task = (await created.json()) as { id: string; roleId: string | null };
      expect(task.roleId).toBe(role.role.id);

      const provisioned = await app.request(`/api/tasks/${task.id}/provision`, { method: 'POST' });
      expect(provisioned.status).toBe(200);
      expect(((await provisioned.json()) as { worktreePath: string }).worktreePath).toBeTruthy();

      const runRes = await app.request(`/api/tasks/${task.id}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'local-codex' }),
      });
      expect(runRes.status).toBe(201);
      const run = (await runRes.json()) as { id: string; roleId: string | null; runtimeId: string | null };
      expect(run).toMatchObject({ roleId: role.role.id, runtimeId: null });

      const executed = await app.request(`/api/runs/${run.id}/execute`, { method: 'POST' });
      expect(executed.status).toBe(200);
      expect((await executed.json()) as object).toMatchObject({
        status: 'review',
        roleId: role.role.id,
        runtimeId: 'codex',
        artifacts: { output: 'ok', exitCode: 0, timedOut: false },
      });

      const runDetail = await app.request(`/api/runs/${run.id}`);
      expect(runDetail.status).toBe(200);
      const runEvidence = (await runDetail.json()) as {
        roleId: string | null;
        runtimeId: string | null;
        runtimeVersion: string | null;
        command: string;
        inputTokens: number | null;
        outputTokens: number | null;
        costUsd: number | null;
        artifacts: { output: string; exitCode: number | null };
      };
      expect(runEvidence).toMatchObject({
        roleId: role.role.id,
        runtimeId: 'codex',
        runtimeVersion: null,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        artifacts: { output: 'ok', exitCode: 0 },
      });
      expect(runEvidence.command).toContain('codex exec');

      const events = await app.request(`/api/runs/${run.id}/events`);
      expect(events.status).toBe(200);
      expect(events.headers.get('content-type')).toContain('text/event-stream');
      expect(await events.text()).toContain('event: completed');

      const accepted = await app.request(`/api/runs/${run.id}/accept`, { method: 'POST' });
      expect(accepted.status).toBe(200);
      const acceptedRun = (await accepted.json()) as { status: string; artifacts: object; commitSha?: string };
      expect(acceptedRun).toMatchObject({
        status: 'done',
        artifacts: { output: 'ok' },
      });
      expect(acceptedRun.commitSha).toMatch(/^[0-9a-f]{40}$/);

      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('accepts only selected files over the HTTP API', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-server-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const twoFileRunner: CodexProcessRunner = async (_command, _arguments, options) => {
        await writeFile(join(options.cwd, 'keep.txt'), 'keep\n', 'utf8');
        await writeFile(join(options.cwd, 'drop.txt'), 'drop\n', 'utf8');
        return {
          exitCode: 0,
          signal: null,
          timedOut: false,
          output: 'ok',
          startedAt: new Date(Date.now() - 10).toISOString(),
          completedAt: new Date().toISOString(),
        };
      };
      const app = createKernelApp(store, { runner: twoFileRunner });

      const task = await store.createTask({ repo, baseRef: 'main', title: 'Two files' });
      await store.provisionTask(task.id);
      const run = await store.createRun(task.id, 'codex');
      expect((await app.request(`/api/runs/${run.id}/execute`, { method: 'POST' })).status).toBe(200);

      const invalid = await app.request(`/api/runs/${run.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: ['missing.txt'] }),
      });
      expect(invalid.status).toBe(400);
      expect(store.getRun(run.id)?.status).toBe('review');

      const malformed = await app.request(`/api/runs/${run.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"files":',
      });
      expect(malformed.status).toBe(400);
      expect(store.getRun(run.id)?.status).toBe('review');

      const accepted = await app.request(`/api/runs/${run.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: ['keep.txt'] }),
      });
      expect(accepted.status).toBe(200);
      expect((await accepted.json()) as object).toMatchObject({ status: 'done' });
      const worktree = store.getTask(task.id)?.worktreePath ?? '';
      expect((await execFileAsync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: worktree })).stdout.trim())
        .toBe('keep.txt');
      await expect(access(join(worktree, 'drop.txt'))).rejects.toBeTruthy();
      expect((await execFileAsync('git', ['status', '--porcelain'], { cwd: worktree })).stdout.trim()).toBe('');

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
