import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KernelStore } from '../src/index.js';

describe('KernelStore task/run', () => {
  it('persists a task and reopens it with its queued status', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-task-'));
    try {
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const created = await store.createTask({
        repo: '/work/repo',
        baseRef: 'main',
        title: 'Rename bin',
        objective: 'Rename the CLI bin to agent-ops.',
        recipe: 'generic',
        acceptanceCriteria: ['The CLI bin is renamed.', 'The help text uses the new name.'],
        priority: 'high',
      });
      await store.close();

      const reopened = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = reopened.getTask(created.id);
      expect(task).toMatchObject({
        repo: '/work/repo',
        baseRef: 'main',
        recipe: 'generic',
        status: 'queued',
        priority: 'high',
        acceptanceCriteria: ['The CLI bin is renamed.', 'The help text uses the new name.'],
      });
      expect(reopened.listTasks()).toHaveLength(1);
      await reopened.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('advances a task status and persists the transition', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-task-'));
    try {
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const created = await store.createTask({ repo: '/r', baseRef: 'main', title: 'T' });
      await store.updateTaskStatus(created.id, 'running');
      await store.updateTaskStatus(created.id, 'review');
      await store.close();

      const reopened = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      expect(reopened.getTask(created.id)?.status).toBe('review');
      await reopened.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('creates runs under a task and lists them by task', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-task-'));
    try {
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await store.createTask({ repo: '/r', baseRef: 'main', title: 'T' });
      const run = await store.createRun(task.id, 'codex');
      expect(run.status).toBe('queued');
      expect(run.agentId).toBe('codex');

      await store.updateRunStatus(run.id, 'running');
      await store.updateRunStatus(run.id, 'review', '2 files changed, +12 -3');

      const reopened = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const listed = reopened.listRuns(task.id);
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ status: 'review', diffStat: '2 files changed, +12 -3' });
      await reopened.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('records the selected role on a task and inherits it on runs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-task-'));
    try {
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const role = await store.roles.createRole({ name: 'Builder', baseAgentId: 'codex' });
      const task = await store.createTask({ repo: '/r', baseRef: 'main', title: 'T', roleId: role.id });
      expect(task.roleId).toBe(role.id);

      const inherited = await store.createRun(task.id, 'codex');
      expect(inherited.roleId).toBe(role.id);
      const explicit = await store.createRun(task.id, 'codex', role.id);
      expect(explicit.roleId).toBe(role.id);

      await expect(store.createTask({ repo: '/r', baseRef: 'main', title: 'T', roleId: 'missing-role' }))
        .rejects.toThrow('Role missing-role was not found.');

      const hermesRole = await store.roles.createRole({ name: 'Hermes reviewer', baseAgentId: 'hermes' });
      const otherTask = await store.createTask({ repo: '/r', baseRef: 'main', title: 'U', roleId: hermesRole.id });
      await expect(store.createRun(otherTask.id, 'codex')).rejects.toThrow('targets hermes, not run agent codex');
      await store.close();

      const reopened = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      expect(reopened.getTask(task.id)?.roleId).toBe(role.id);
      expect(reopened.getRun(inherited.id)?.roleId).toBe(role.id);
      await reopened.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('inherits the Role profile as the run agent when agentId is omitted', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-task-'));
    try {
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const { profile } = await store.profiles.createProfile({ name: 'Profile Runner', baseAgentId: 'codex' });
      const role = await store.roles.createRole({ name: 'Profile Runner Role', profileId: profile.id });
      const task = await store.createTask({ repo: '/r', baseRef: 'main', title: 'T', roleId: role.id });

      const inherited = await store.createRun(task.id, undefined);
      expect(inherited).toMatchObject({ agentId: profile.id, roleId: role.id });
      expect(inherited.agentId).not.toBe('codex');

      const explicit = await store.createRun(task.id, profile.id, role.id);
      expect(explicit).toMatchObject({ agentId: profile.id, roleId: role.id });

      await expect(store.createRun(task.id, 'hermes', role.id))
        .rejects.toThrow(`Role ${role.id} targets ${profile.id} (codex), not run agent hermes.`);

      const baseRole = await store.roles.createRole({ name: 'Base Agent Role', baseAgentId: 'codex' });
      const baseTask = await store.createTask({ repo: '/r', baseRef: 'main', title: 'Base', roleId: baseRole.id });
      const inheritedBase = await store.createRun(baseTask.id, undefined);
      expect(inheritedBase.agentId).toBe('codex');

      const bareTask = await store.createTask({ repo: '/r', baseRef: 'main', title: 'No identity' });
      await expect(store.createRun(bareTask.id, undefined))
        .rejects.toThrow('A run needs an agentId or a Role with a profileId or baseAgentId.');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('records the assigned team on a task and validates its roster', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-task-'));
    try {
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const architect = await store.roles.createRole({ name: 'Architect', baseAgentId: 'codex' });
      const implementer = await store.roles.createRole({ name: 'Implementer', baseAgentId: 'codex' });
      const outsider = await store.roles.createRole({ name: 'Outsider', baseAgentId: 'codex' });
      const team = await store.teams.createTeam({
        name: 'Delivery',
        roleIds: [architect.id, implementer.id],
        handoffs: [{ fromRoleId: architect.id, toRoleId: implementer.id }],
      });

      const task = await store.createTask({ repo: '/r', baseRef: 'main', title: 'T', teamId: team.id, roleId: architect.id });
      expect(task.teamId).toBe(team.id);
      expect((await store.createTask({ repo: '/r', baseRef: 'main', title: 'U', teamId: team.id })).teamId).toBe(team.id);

      await expect(store.createTask({ repo: '/r', baseRef: 'main', title: 'T', teamId: 'missing-team' }))
        .rejects.toThrow('Team missing-team was not found.');
      await expect(store.createTask({ repo: '/r', baseRef: 'main', title: 'T', teamId: team.id, roleId: outsider.id }))
        .rejects.toThrow(`Role ${outsider.id} is not on team ${team.id}.`);

      await store.teams.updateTeam(team.id, { enabled: false });
      await expect(store.createTask({ repo: '/r', baseRef: 'main', title: 'T', teamId: team.id }))
        .rejects.toThrow(`Team ${team.id} is disabled.`);
      await store.close();

      const reopened = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      expect(reopened.getTask(task.id)?.teamId).toBe(team.id);
      await reopened.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('records the selected role on a run and rejects an unknown role', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-task-'));
    try {
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await store.createTask({ repo: '/r', baseRef: 'main', title: 'T' });
      const role = await store.roles.createRole({ name: 'Runner', baseAgentId: 'codex' });
      const run = await store.createRun(task.id, 'codex', role.id);
      expect(run.roleId).toBe(role.id);
      expect(run.runtimeId).toBeNull();
      await expect(store.createRun(task.id, 'codex', 'missing-role')).rejects.toThrow('Role missing-role was not found.');
      await store.close();

      const reopened = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      expect(reopened.getRun(run.id)?.roleId).toBe(role.id);
      expect(reopened.getRun(run.id)?.runtimeId).toBeNull();
      await reopened.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('rejects a run for a missing task', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-task-'));
    try {
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      await expect(store.createRun('missing-task', 'codex')).rejects.toThrow('Task missing-task was not found.');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('lists tasks by team and excludes other teams', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-task-'));
    try {
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const role = await store.roles.createRole({ name: 'Builder', baseAgentId: 'codex' });
      const teamA = await store.teams.createTeam({ name: 'Alpha', roleIds: [role.id] });
      const teamB = await store.teams.createTeam({ name: 'Beta', roleIds: [role.id] });

      const a1 = await store.createTask({ repo: '/r', baseRef: 'main', title: 'A1', teamId: teamA.id });
      const a2 = await store.createTask({ repo: '/r', baseRef: 'main', title: 'A2', teamId: teamA.id });
      const b1 = await store.createTask({ repo: '/r', baseRef: 'main', title: 'B1', teamId: teamB.id });
      const unassigned = await store.createTask({ repo: '/r', baseRef: 'main', title: 'U' }); // unassigned

      const ids = store.listTasksByTeam(teamA.id).map(task => task.id);
      expect(ids).toHaveLength(2);
      expect(ids).toEqual(expect.arrayContaining([a1.id, a2.id]));
      expect(ids).not.toContain(b1.id);
      expect(ids).not.toContain(unassigned.id);
      expect(store.listTasksByTeam('missing-team')).toEqual([]);
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('throws when updating a missing task or run', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-task-'));
    try {
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      await expect(store.updateTaskStatus('missing', 'running')).rejects.toThrow('Task missing was not found.');
      await expect(store.updateRunStatus('missing', 'running')).rejects.toThrow('Run missing was not found.');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
});
