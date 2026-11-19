import { describe, expect, it } from 'vitest';
import type { AgentProfile } from '../src/profiles.js';
import type { AgentRole } from '../src/roles.js';
import { resolveRoleRuntime, slugifyRoleName } from '../src/roles.js';
import { RuntimeRegistry } from '../src/runtime-registry.js';

const role = (overrides: Partial<AgentRole> = {}): AgentRole => ({
  id: 'reviewer',
  name: 'Reviewer',
  baseAgentId: 'codex',
  acceptanceCriteria: ['No writes outside the review notes.'],
  runtimePolicy: { allowedTools: ['Read'], blockedTools: ['Write', 'Edit'], approvalMode: 'human' },
  enabled: true,
  createdAt: '2026-11-20T00:00:00.000Z',
  updatedAt: '2026-11-20T00:00:00.000Z',
  ...overrides,
});

const profile: AgentProfile = {
  id: 'review-profile',
  name: 'Review profile',
  baseAgentId: 'codex',
  overrides: { systemPrompt: 'You review only.' },
  createdAt: '2026-11-20T00:00:00.000Z',
  updatedAt: '2026-11-20T00:00:00.000Z',
};

describe('slugifyRoleName', () => {
  it('falls back to a stable role id when the name has no ASCII slug', () => {
    expect(slugifyRoleName('审查者')).toBe('role');
    expect(slugifyRoleName('Code Reviewer')).toBe('code-reviewer');
  });
});

describe('resolveRoleRuntime', () => {  it('resolves a base-agent role to its verified runtime and capabilities', async () => {
    const resolution = await resolveRoleRuntime(role(), {
      getProfile: async () => null,
    });
    expect(resolution).toMatchObject({
      executable: true,
      baseAgentId: 'codex',
      adapterStatus: 'verified',
      capabilities: { toolPolicy: 'native', worktreeSafe: true },
    });
    expect(resolution.reason).toBeUndefined();
  });

  it('resolves a Profile-bound role and treats the Profile base agent as authoritative', async () => {
    const resolution = await resolveRoleRuntime(role({ baseAgentId: undefined, profileId: profile.id }), {
      getProfile: async id => (id === profile.id ? profile : null),
    });
    expect(resolution).toMatchObject({
      executable: true,
      baseAgentId: 'codex',
      profile,
    });
  });

  it('reports a missing profile without falling back to the role baseAgentId', async () => {
    const resolution = await resolveRoleRuntime(role({ profileId: 'missing-profile' }), {
      getProfile: async () => null,
    });
    expect(resolution).toMatchObject({
      executable: false,
      reason: 'profile-not-found',
      adapterStatus: 'unsupported',
    });
  });

  it('refuses a Profile/base-agent conflict instead of guessing', async () => {
    const resolution = await resolveRoleRuntime(role({ baseAgentId: 'opencode', profileId: profile.id }), {
      getProfile: async () => profile,
    });
    expect(resolution).toMatchObject({
      executable: false,
      baseAgentId: 'codex',
      reason: 'profile-base-mismatch',
    });
  });

  it('marks a candidate runtime as non-executable but still reports its capabilities', async () => {
    const resolution = await resolveRoleRuntime(role({ baseAgentId: 'claude-code' }), {
      getProfile: async () => null,
    });
    expect(resolution).toMatchObject({
      executable: false,
      reason: 'adapter-not-executable',
      adapterStatus: 'candidate',
      capabilities: { toolPolicy: 'native' },
    });
  });

  it('uses the injected registry for status and capabilities', async () => {
    const registry = new RuntimeRegistry();
    registry.register({
      id: 'test-runtime',
      status: 'verified',
      capabilities: {
        nonInteractive: true,
        streaming: false,
        structuredOutput: false,
        sessionResume: false,
        toolPolicy: 'wrapper',
        worktreeSafe: true,
      },
      buildCommand: prompt => ['test-runtime', prompt],
    });

    const resolution = await resolveRoleRuntime(role({ baseAgentId: 'test-runtime' }), {
      getProfile: async () => null,
      registry,
    });
    expect(resolution).toMatchObject({
      executable: true,
      adapterStatus: 'verified',
      capabilities: { toolPolicy: 'wrapper' },
    });
  });
});
