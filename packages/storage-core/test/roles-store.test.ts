import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RoleStore } from '../src/roles-store.js';

describe('RoleStore', () => {
  it('creates unique role ids, persists them and updates fields', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-roles-'));
    try {
      const store = new RoleStore(directory);
      const first = await store.createRole({
        name: 'Reviewer',
        baseAgentId: 'codex',
        acceptanceCriteria: ['Read the diff.'],
        runtimePolicy: { allowedTools: ['Read'], blockedTools: ['Write', 'Edit'], approvalMode: 'human' },
      });
      expect(first.id).toBe('reviewer');
      expect(first.acceptanceCriteria).toEqual(['Read the diff.']);
      expect(first.runtimePolicy.blockedTools).toEqual(['Write', 'Edit']);

      const second = await store.createRole({ name: 'Reviewer', baseAgentId: 'codex' });
      expect(second.id).toBe('reviewer-2');
      expect(await store.listRoles()).toHaveLength(2);

      const updated = await store.updateRole(first.id, { enabled: false, name: 'Code reviewer' });
      expect(updated).toMatchObject({ id: first.id, name: 'Code reviewer', enabled: false });

      const reopened = new RoleStore(directory);
      expect((await reopened.getRole(first.id))?.name).toBe('Code reviewer');
      expect(await reopened.deleteRole(second.id)).toBe(true);
      expect(await reopened.getRole(second.id)).toBeNull();

      expect(JSON.parse(await readFile(join(directory, 'agent-roles.json'), 'utf8'))).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('refuses a role without a base agent or profile', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-roles-'));
    try {
      const store = new RoleStore(directory);
      await expect(store.createRole({ name: 'Unbound' })).rejects.toThrow('baseAgentId');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
