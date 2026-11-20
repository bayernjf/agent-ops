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

const runnerWithUsage = (usage: { inputTokens?: number; outputTokens?: number; costUsd?: number }): CodexProcessRunner => async () => ({
  exitCode: 0,
  signal: null,
  timedOut: false,
  output: 'ok',
  usage,
  startedAt: new Date(Date.now() - 5).toISOString(),
  completedAt: new Date().toISOString(),
});

const silentRunner: CodexProcessRunner = async () => ({
  exitCode: 0,
  signal: null,
  timedOut: false,
  output: 'ok',
  startedAt: new Date(Date.now() - 5).toISOString(),
  completedAt: new Date().toISOString(),
});

describe('KernelStore budgets', () => {
  it('blocks a new run once the role budget has been reached', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-budget-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const role = await store.roles.createRole({ name: 'Capped', baseAgentId: 'codex', budget: { maxCostUsd: 1 } });
      const task = await store.createTask({ repo, baseRef: 'main', title: 'Budgeted', roleId: role.id });
      await store.provisionTask(task.id);

      for (let attempt = 0; attempt < 2; attempt++) {
        const run = await store.createRun(task.id, 'codex');
        await store.executeRun(run.id, runnerWithUsage({ costUsd: 0.6 }));
      }

      const status = await store.budgetStatus(task.id, role.id);
      expect(status?.role).toMatchObject({
        configured: true,
        exceeded: true,
        limits: { maxCostUsd: 1 },
        spend: { reportingRuns: 2, totalRuns: 2 },
      });
      expect(status?.role?.spend.costUsd).toBeCloseTo(1.2);

      await expect(store.createRun(task.id, 'codex')).rejects.toThrow('Budget exceeded');
      expect(store.listAudit({ taskId: task.id }).map(event => event.type)).toContain('budget.blocked');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('applies a team budget across roles and blocks execute-run too', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-budget-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const left = await store.roles.createRole({ name: 'Left', baseAgentId: 'codex' });
      const right = await store.roles.createRole({ name: 'Right', baseAgentId: 'codex' });
      const team = await store.teams.createTeam({ name: 'Capped team', roleIds: [left.id, right.id], budget: { maxInputTokens: 100 } });
      const task = await store.createTask({ repo, baseRef: 'main', title: 'Team budget', teamId: team.id });
      await store.provisionTask(task.id);

      const first = await store.createRun(task.id, 'codex', left.id);
      await store.executeRun(first.id, runnerWithUsage({ inputTokens: 60 }));
      const second = await store.createRun(task.id, 'codex', right.id);
      // Created while the team is still under budget, but executed after it crossed the limit.
      const queued = await store.createRun(task.id, 'codex', right.id);
      await store.executeRun(second.id, runnerWithUsage({ inputTokens: 60 }));

      const status = await store.budgetStatus(task.id, right.id);
      expect(status?.team).toMatchObject({ configured: true, exceeded: true, spend: { inputTokens: 120 } });

      await expect(store.executeRun(queued.id, silentRunner)).rejects.toThrow('Budget exceeded');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('never blocks on usage the runtime did not report', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-budget-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const role = await store.roles.createRole({ name: 'Tiny', baseAgentId: 'codex', budget: { maxCostUsd: 0.01 } });
      const task = await store.createTask({ repo, baseRef: 'main', title: 'Silent', roleId: role.id });
      await store.provisionTask(task.id);

      const run = await store.createRun(task.id, 'codex');
      await store.executeRun(run.id, silentRunner);
      const status = await store.budgetStatus(task.id, role.id);
      expect(status?.role).toMatchObject({ configured: true, exceeded: false, reasons: [], spend: { costUsd: null, reportingRuns: 0, totalRuns: 1 } });

      const next = await store.createRun(task.id, 'codex');
      expect(next.status).toBe('queued');
      expect((await store.budgetStatus(task.id, role.id))?.team).toBeNull();
      expect(await store.budgetStatus('missing-task', role.id)).toBeNull();
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
});
