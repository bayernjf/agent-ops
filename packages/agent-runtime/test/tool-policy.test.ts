import { describe, expect, it } from 'vitest';
import { buildAgentExecutionPlan, type AgentRole, type RuntimeToolPolicy } from '../src/index.js';

const task = {
  id: 'task-policy',
  title: 'Review the change',
  objective: 'Inspect the worktree without editing it.',
  acceptanceCriteria: ['Report findings.'],
};

const reviewerPolicy: RuntimeToolPolicy = {
  allowedTools: ['Read', 'Grep', 'Glob'],
  blockedTools: [],
  approvalMode: 'human',
};

describe('Role tool policy', () => {
  it('maps a read-only Role to the Codex read-only sandbox', () => {
    const plan = buildAgentExecutionPlan(task, '/tmp/review', 'codex', {
      execute: true,
      toolPolicy: reviewerPolicy,
      roleId: 'reviewer',
    });
    expect(plan.command).toContain('read-only');
    expect(plan.command).not.toContain('workspace-write');
    expect(plan.roleId).toBe('reviewer');
    expect(plan.toolPolicy).toMatchObject({ readOnly: true, enforcement: 'exact' });
  });

  it('maps a Claude Role allowlist to --allowedTools and removes blocked tools', () => {
    const plan = buildAgentExecutionPlan(task, '/tmp/review', 'claude-code', {
      toolPolicy: { allowedTools: ['Read', 'Grep', 'Bash'], blockedTools: ['Bash'], approvalMode: 'strict' },
    });
    const allowedIndex = plan.command.indexOf('--allowedTools');
    expect(plan.command[allowedIndex + 1]).toBe('Read,Grep');
    expect(plan.toolPolicy).toMatchObject({ allowedTools: ['Read', 'Grep'], enforcement: 'exact' });
  });

  it('marks a Codex write allowlist as coarse instead of claiming exact enforcement', () => {
    const plan = buildAgentExecutionPlan(task, '/tmp/review', 'codex', {
      execute: true,
      toolPolicy: { allowedTools: ['Read', 'Write'], blockedTools: [], approvalMode: 'auto' },
    });
    expect(plan.command).toContain('workspace-write');
    expect(plan.toolPolicy?.enforcement).toBe('coarse');
    expect(plan.toolPolicy?.warnings.join(' ')).toContain('advisory');
  });

  it('refuses a restricted Role on an Adapter that cannot express a tool policy', () => {
    expect(() => buildAgentExecutionPlan(task, '/tmp/review', 'hermes', {
      execute: true,
      toolPolicy: { allowedTools: [], blockedTools: ['Bash'], approvalMode: 'human' },
      roleId: 'restricted-hermes',
    })).toThrow('cannot enforce a Role tool policy');
  });

  it('injects the Role responsibility, criteria, and tool constraints into the prompt', () => {
    const role: AgentRole = {
      id: 'reviewer',
      name: 'Reviewer',
      description: 'Review the diff and report risks.',
      baseAgentId: 'codex',
      systemPrompt: 'Never edit files. Report only.',
      acceptanceCriteria: ['The review names every changed file.'],
      runtimePolicy: { allowedTools: ['Read'], blockedTools: ['Bash'], approvalMode: 'strict' },
      enabled: true,
      createdAt: '2026-11-20T00:00:00.000Z',
      updatedAt: '2026-11-20T00:00:00.000Z',
    };
    const plan = buildAgentExecutionPlan(task, '/tmp/review', 'codex', { execute: true, role });
    const prompt = plan.command[plan.command.length - 1];
    expect(plan.roleId).toBe('reviewer');
    expect(prompt).toContain('Acting Role: Reviewer (reviewer)');
    expect(prompt).toContain('Review the diff and report risks.');
    expect(prompt).toContain('Never edit files. Report only.');
    expect(prompt).toContain('The review names every changed file.');
    expect(prompt).toContain('Allowed tools: Read');
    expect(prompt).toContain('Blocked tools: Bash');
    expect(prompt).toContain('Approval mode: strict');
  });

  it('leaves an unrestricted Role on the Adapter default command', () => {
    const unrestricted: RuntimeToolPolicy = { allowedTools: [], blockedTools: [], approvalMode: 'human' };
    const plan = buildAgentExecutionPlan(task, '/tmp/review', 'codex', { execute: true, toolPolicy: unrestricted, roleId: 'implementer' });
    expect(plan.command).toContain('workspace-write');
    expect(plan.toolPolicy).toBeUndefined();
  });
});
