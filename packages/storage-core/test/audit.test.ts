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

describe('KernelStore audit events', () => {
  it('replays role and team edits plus task assignment', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-audit-'));
    try {
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const architect = await store.roles.createRole({ name: 'Architect', baseAgentId: 'codex' });
      const implementer = await store.roles.createRole({ name: 'Implementer', baseAgentId: 'codex' });
      await store.roles.updateRole(architect.id, { description: 'Owns the design.' });
      const team = await store.teams.createTeam({
        name: 'Delivery',
        roleIds: [architect.id, implementer.id],
        handoffs: [{ fromRoleId: architect.id, toRoleId: implementer.id }],
      });
      const task = await store.createTask({
        repo: '/r',
        baseRef: 'main',
        title: 'Audit me',
        roleId: architect.id,
        teamId: team.id,
        pipeline: { steps: [{ name: 'Plan', roleId: architect.id }, { name: 'Build', roleId: implementer.id }] },
      });

      const types = store.listAudit().map(event => event.type);
      expect(types).toEqual([
        'role.created',
        'role.created',
        'role.updated',
        'team.created',
        'task.created',
      ]);
      expect(store.listAudit({ taskId: task.id })).toHaveLength(1);
      expect(store.listAudit({ taskId: task.id })[0]?.data).toMatchObject({
        roleId: architect.id,
        teamId: team.id,
        pipelineSteps: 2,
      });
      expect(store.listAudit({ teamId: team.id }).map(event => event.type)).toEqual(['team.created', 'task.created']);
      expect(store.listAudit({ type: 'role.updated' })[0]?.data).toMatchObject({ roleId: architect.id, name: 'Architect' });

      await store.teams.deleteTeam(team.id);
      expect(store.listAudit().at(-1)?.type).toBe('team.deleted');
      await store.close();

      const reopened = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      expect(reopened.listAudit()).toHaveLength(6);
      await reopened.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('replays accepted runs, handoffs and rejected runs in order', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-audit-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await store.createTask({
        repo,
        baseRef: 'main',
        title: 'Audited pipeline',
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

      const events = store.listAudit({ taskId: task.id });
      expect(events.map(event => event.type)).toEqual([
        'task.created',
        'run.accepted',
        'handoff.recorded',
        'run.accepted',
      ]);
      expect(events[1]?.data.commitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(events[2]?.data).toMatchObject({ fromStepId: 'plan', toStepId: 'build', artifacts: 1 });

      const other = await store.createTask({ repo, baseRef: 'main', title: 'Rejected run' });
      await store.provisionTask(other.id);
      const run = await store.createRun(other.id, 'codex');
      await store.executeRun(run.id, runner);
      await store.rejectRun(run.id);
      expect(store.listAudit({ taskId: other.id }).map(event => event.type)).toEqual(['task.created', 'run.rejected']);
      expect(store.listAudit({ taskId: other.id }).at(-1)?.data).toMatchObject({ runId: run.id });

      const before = store.listAudit();
      expect(before.every((event, index) => index === 0 || event.seq > before[index - 1]!.seq)).toBe(true);
      await store.close();

      const reopened = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      expect(reopened.listAudit({ taskId: task.id }).map(event => event.type)).toEqual([
        'task.created',
        'run.accepted',
        'handoff.recorded',
        'run.accepted',
      ]);
      await reopened.roles.createRole({ name: 'Reopened', baseAgentId: 'codex' });
      expect(reopened.listAudit({ type: 'role.created' })[0]?.seq).toBeGreaterThan(before.at(-1)?.seq ?? 0);
      await reopened.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
});
