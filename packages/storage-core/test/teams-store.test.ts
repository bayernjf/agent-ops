import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RoleStore } from '../src/roles-store.js';
import { TeamStore } from '../src/teams-store.js';

async function openStores(directory: string) {
  const roles = new RoleStore(directory);
  const teams = new TeamStore(directory, id => roles.getRole(id));
  return { roles, teams };
}

describe('TeamStore', () => {
  it('creates unique team ids, persists the roster and handoffs, and updates them', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-teams-'));
    try {
      const { roles, teams } = await openStores(directory);
      const architect = await roles.createRole({ name: 'Architect', baseAgentId: 'codex' });
      const implementer = await roles.createRole({ name: 'Implementer', baseAgentId: 'codex' });
      const reviewer = await roles.createRole({ name: 'Reviewer', baseAgentId: 'codex' });

      const team = await teams.createTeam({
        name: 'Delivery',
        roleIds: [architect.id, implementer.id, reviewer.id],
        handoffs: [
          { fromRoleId: architect.id, toRoleId: implementer.id, note: 'Hand over the plan.' },
          { fromRoleId: implementer.id, toRoleId: reviewer.id },
        ],
      });
      expect(team.id).toBe('delivery');
      expect(team.roleIds).toEqual([architect.id, implementer.id, reviewer.id]);
      expect(team.handoffs).toHaveLength(2);

      const duplicate = await teams.createTeam({
        name: 'Delivery',
        roleIds: [architect.id, implementer.id, reviewer.id],
      });
      expect(duplicate.id).toBe('delivery-2');

      const updated = await teams.updateTeam(team.id, { name: 'Delivery team', enabled: false });
      expect(updated).toMatchObject({ id: team.id, name: 'Delivery team', enabled: false });

      const reopened = await openStores(directory);
      const stored = await reopened.teams.getTeam(team.id);
      expect(stored?.name).toBe('Delivery team');
      expect(stored?.handoffs[0]?.note).toBe('Hand over the plan.');

      expect(await reopened.teams.deleteTeam(duplicate.id)).toBe(true);
      expect(await reopened.teams.getTeam(duplicate.id)).toBeNull();
      expect(JSON.parse(await readFile(join(directory, 'agent-teams.json'), 'utf8'))).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects roles that do not exist or are disabled', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-teams-'));
    try {
      const { roles, teams } = await openStores(directory);
      const active = await roles.createRole({ name: 'Active', baseAgentId: 'codex' });
      const disabled = await roles.createRole({ name: 'Disabled', baseAgentId: 'codex', enabled: false });

      await expect(teams.createTeam({ name: 'Ghost', roleIds: ['missing-role'] })).rejects.toThrow('Role missing-role was not found');
      await expect(teams.createTeam({ name: 'Off', roleIds: [active.id, disabled.id] })).rejects.toThrow(`Role ${disabled.id} is disabled`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects duplicate members, self handoffs, duplicate edges, non-member edges and cycles', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-teams-'));
    try {
      const { roles, teams } = await openStores(directory);
      const a = await roles.createRole({ name: 'A', baseAgentId: 'codex' });
      const b = await roles.createRole({ name: 'B', baseAgentId: 'codex' });
      const outsider = await roles.createRole({ name: 'Outsider', baseAgentId: 'codex' });

      await expect(teams.createTeam({ name: 'Dup', roleIds: [a.id, a.id] })).rejects.toThrow('appears more than once');
      await expect(teams.createTeam({ name: 'Self', roleIds: [a.id], handoffs: [{ fromRoleId: a.id, toRoleId: a.id }] }))
        .rejects.toThrow('cannot hand off to itself');
      await expect(teams.createTeam({
        name: 'Twice',
        roleIds: [a.id, b.id],
        handoffs: [{ fromRoleId: a.id, toRoleId: b.id }, { fromRoleId: a.id, toRoleId: b.id }],
      })).rejects.toThrow('Duplicate handoff');
      await expect(teams.createTeam({ name: 'Outsider', roleIds: [a.id], handoffs: [{ fromRoleId: a.id, toRoleId: outsider.id }] }))
        .rejects.toThrow(`Role ${outsider.id} is not on this Team`);
      await expect(teams.createTeam({
        name: 'Loop',
        roleIds: [a.id, b.id],
        handoffs: [{ fromRoleId: a.id, toRoleId: b.id }, { fromRoleId: b.id, toRoleId: a.id }],
      })).rejects.toThrow('Handoff cycle detected');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('revalidates the graph when an update would orphan a handoff', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-teams-'));
    try {
      const { roles, teams } = await openStores(directory);
      const a = await roles.createRole({ name: 'A', baseAgentId: 'codex' });
      const b = await roles.createRole({ name: 'B', baseAgentId: 'codex' });
      const team = await teams.createTeam({
        name: 'Chain',
        roleIds: [a.id, b.id],
        handoffs: [{ fromRoleId: a.id, toRoleId: b.id }],
      });

      await expect(teams.updateTeam(team.id, { roleIds: [a.id] })).rejects.toThrow(`Role ${b.id} is not on this Team`);
      expect((await teams.getTeam(team.id))?.roleIds).toEqual([a.id, b.id]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('requires the owner role to be a last-step roster member', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-teams-'));
    try {
      const { roles, teams } = await openStores(directory);
      const a = await roles.createRole({ name: 'A', baseAgentId: 'codex' });
      const b = await roles.createRole({ name: 'B', baseAgentId: 'codex' });
      const outsider = await roles.createRole({ name: 'Outsider', baseAgentId: 'codex' });

      await expect(teams.createTeam({ name: 'Bad owner', roleIds: [a.id], ownerRoleId: outsider.id }))
        .rejects.toThrow('Owner role outsider is not on this Team');
      await expect(teams.createTeam({
        name: 'Owner hands off',
        roleIds: [a.id, b.id],
        handoffs: [{ fromRoleId: a.id, toRoleId: b.id }],
        ownerRoleId: a.id,
      })).rejects.toThrow('the owner must be the last role');

      const owned = await teams.createTeam({
        name: 'Owned',
        roleIds: [a.id, b.id],
        handoffs: [{ fromRoleId: a.id, toRoleId: b.id }],
        ownerRoleId: b.id,
      });
      expect(owned.ownerRoleId).toBe(b.id);
      expect((await teams.getTeam(owned.id))?.ownerRoleId).toBe(b.id);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
