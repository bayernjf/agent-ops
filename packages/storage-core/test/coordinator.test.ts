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

describe('KernelStore coordinator', () => {
  it('derives a team pipeline, applies it and summarizes the run', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-coordinator-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const architect = await store.roles.createRole({ name: 'Architect', baseAgentId: 'codex', description: 'Designs the change.' });
      const implementer = await store.roles.createRole({ name: 'Implementer', baseAgentId: 'codex' });
      const reviewer = await store.roles.createRole({ name: 'Reviewer', baseAgentId: 'codex' });
      const team = await store.teams.createTeam({
        name: 'Delivery',
        roleIds: [reviewer.id, implementer.id, architect.id],
        handoffs: [
          { fromRoleId: architect.id, toRoleId: implementer.id },
          { fromRoleId: implementer.id, toRoleId: reviewer.id },
        ],
        ownerRoleId: reviewer.id,
      });
      const task = await store.createTask({ repo, baseRef: 'main', title: 'Coordinated', teamId: team.id });

      const plan = await store.planTeamPipeline(task.id);
      expect(plan?.order).toEqual([architect.id, implementer.id, reviewer.id]);
      expect(plan?.steps.map(step => step.name)).toEqual(['Architect', 'Implementer', 'Reviewer']);
      expect(plan?.steps[0]?.prompt).toBe('Designs the change.');
      expect(plan?.warnings).toEqual([]);
      expect(plan?.ownerRoleId).toBe(reviewer.id);
      expect(plan?.steps[2]?.ownsDeliverable).toBe(true);
      expect(plan?.steps[2]?.prompt).toContain('You own the final deliverable');
      expect(plan?.steps.slice(0, 2).every(step => !step.ownsDeliverable)).toBe(true);

      const pipeline = await store.applyTeamPipeline(task.id);
      expect(pipeline?.status).toBe('idle');
      expect(pipeline?.steps).toHaveLength(3);
      expect(pipeline?.steps.map(step => step.roleId)).toEqual([architect.id, implementer.id, reviewer.id]);
      expect(pipeline?.steps[2]?.ownsDeliverable).toBe(true);
      expect(store.listAudit({ taskId: task.id }).map(event => event.type)).toEqual(['task.created', 'pipeline.planned']);

      await store.provisionTask(task.id);
      let calls = 0;
      const runner: CodexProcessRunner = async (_command, _arguments, options) => {
        calls++;
        await writeFile(join(options.cwd, `STEP-${calls}.md`), `step ${calls}\n`, 'utf8');
        return success();
      };
      const executed = await store.executeTaskPipeline(task.id, runner);
      expect(executed.status).toBe('completed');

      const summary = store.coordinatorSummary(task.id);
      expect(summary).toMatchObject({
        taskId: task.id,
        teamId: team.id,
        pipelineStatus: 'completed',
        completed: 3,
        failed: 0,
        awaiting: 0,
        handoffs: 2,
        blockers: [],
      });
      expect(summary?.steps.map(step => step.roleId)).toEqual([architect.id, implementer.id, reviewer.id]);
      expect(summary?.steps.every(step => /^[0-9a-f]{40}$/.test(step.commitSha ?? ''))).toBe(true);
      expect(summary?.owner).toEqual({ stepId: reviewer.id, status: 'completed' });

      await expect(store.applyTeamPipeline(task.id)).rejects.toThrow('can only be applied');
      expect(await store.coordinatorSummary('missing-task')).toBeNull();
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('refuses to plan for a task without a team', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-coordinator-'));
    try {
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await store.createTask({ repo: '/r', baseRef: 'main', title: 'Teamless' });
      await expect(store.planTeamPipeline(task.id)).rejects.toThrow('not assigned to a Team');
      expect(await store.planTeamPipeline('missing-task')).toBeNull();
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('warns when the team has no owner for the final write', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-coordinator-'));
    try {
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const role = await store.roles.createRole({ name: 'Builder', baseAgentId: 'codex' });
      const team = await store.teams.createTeam({ name: 'Unowned', roleIds: [role.id] });
      const task = await store.createTask({ repo: '/r', baseRef: 'main', title: 'Unowned', teamId: team.id });

      const plan = await store.planTeamPipeline(task.id);
      expect(plan?.ownerRoleId).toBeNull();
      expect(plan?.steps.every(step => !step.ownsDeliverable)).toBe(true);
      expect(plan?.warnings.join(' ')).toContain('no owner role');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
});
