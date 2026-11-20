import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KernelStore } from '../src/index.js';

describe('KernelStore role test plan', () => {
  it('builds a dry-run plan for a verified role without spawning anything', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-role-test-'));
    try {
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const role = await store.roles.createRole({
        name: 'Reviewer',
        baseAgentId: 'codex',
        systemPrompt: 'Review without writing.',
        acceptanceCriteria: ['Read only.'],
        runtimePolicy: { allowedTools: ['Read'], blockedTools: ['Write', 'Edit', 'Bash'], approvalMode: 'strict' },
      });

      const plan = await store.testRolePlan(role.id);
      expect(plan).toMatchObject({
        roleId: role.id,
        name: 'Reviewer',
        enabled: true,
        executable: true,
        baseAgentId: 'codex',
        adapterStatus: 'verified',
        profileId: null,
      });
      expect(plan?.command?.[0]).toBe('codex');
      expect(plan?.command?.join(' ')).toContain('Role test: Reviewer');
      expect(plan?.command?.join(' ')).toContain('Review without writing.');
      expect(plan?.toolPolicy?.readOnly).toBe(true);
      expect(plan?.warnings).toEqual([]);

      const custom = await store.testRolePlan(role.id, { objective: 'Inspect the repository.' });
      expect(custom?.objective).toBe('Inspect the repository.');
      expect(custom?.command?.join(' ')).toContain('Inspect the repository.');

      expect(await store.testRolePlan('missing-role')).toBeNull();
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('warns instead of pretending a candidate runtime or a disabled role can run', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-role-test-'));
    try {
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const candidate = await store.roles.createRole({ name: 'Candidate', baseAgentId: 'claude-code' });
      const candidatePlan = await store.testRolePlan(candidate.id);
      expect(candidatePlan?.executable).toBe(false);
      expect(candidatePlan?.adapterStatus).toBe('candidate');
      expect(candidatePlan?.warnings.join(' ')).toContain('not executable');
      // A dry-run plan is still useful for a candidate runtime: the command shows what it would run.
      expect(candidatePlan?.command?.join(' ')).toContain('claude');

      const disabled = await store.roles.createRole({ name: 'Disabled', baseAgentId: 'codex', enabled: false });
      const disabledPlan = await store.testRolePlan(disabled.id);
      expect(disabledPlan?.enabled).toBe(false);
      expect(disabledPlan?.warnings.join(' ')).toContain('disabled');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
