import { describe, expect, it } from 'vitest';
import { agentRoleCreateSchema } from '../src/roles.js';
import { getRoleTemplate, roleTemplates } from '../src/role-templates.js';

describe('roleTemplates', () => {
  it('ships the five team templates with unique ids', () => {
    expect(roleTemplates.map(template => template.id)).toEqual([
      'architect',
      'implementer',
      'reviewer',
      'tester',
      'researcher',
    ]);
    expect(new Set(roleTemplates.map(template => template.id)).size).toBe(roleTemplates.length);
  });

  it('every template produces a valid role create input', () => {
    for (const template of roleTemplates) {
      const parsed = agentRoleCreateSchema.parse({
        name: template.name,
        description: template.description,
        baseAgentId: template.baseAgentId,
        systemPrompt: template.systemPrompt,
        acceptanceCriteria: template.acceptanceCriteria,
        runtimePolicy: template.runtimePolicy,
        enabled: true,
      });
      expect(parsed.acceptanceCriteria.length).toBeGreaterThan(0);
      expect(parsed.systemPrompt?.length).toBeGreaterThan(0);
      expect(parsed.baseAgentId).toBe('codex');
    }
  });

  it('keeps the read-only templates from writing and the reviewer strict', () => {
    for (const id of ['architect', 'reviewer', 'researcher']) {
      const template = getRoleTemplate(id);
      expect(template?.runtimePolicy.blockedTools).toEqual(expect.arrayContaining(['Write', 'Edit', 'Bash']));
    }
    expect(getRoleTemplate('reviewer')?.runtimePolicy.approvalMode).toBe('strict');
    expect(getRoleTemplate('tester')?.runtimePolicy.allowedTools).toContain('Bash');
    expect(getRoleTemplate('missing')).toBeUndefined();
  });
});
