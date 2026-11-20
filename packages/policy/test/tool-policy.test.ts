import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALLOWED_TOOLS,
  effectiveAllowedTools,
  evaluateToolPolicy,
  hasRestrictedToolPolicy,
  isReadOnlyToolPolicy,
} from '../src/tool-policy.js';

const readOnly = { allowedTools: ['Read', 'Grep'], blockedTools: [], approvalMode: 'human' as const };
const broad = { allowedTools: ['Read', 'Write', 'Edit', 'Bash'], blockedTools: [], approvalMode: 'auto' as const };
const blockedOnly = { allowedTools: [], blockedTools: ['Write', 'Bash'], approvalMode: 'strict' as const };

describe('tool policy helpers', () => {
  it('treats only a fully read-only allowlist as read-only', () => {
    expect(isReadOnlyToolPolicy(readOnly)).toBe(true);
    expect(isReadOnlyToolPolicy(broad)).toBe(false);
    expect(isReadOnlyToolPolicy(blockedOnly)).toBe(false);
  });

  it('intersects the allowlist with defaults and removes blocks', () => {
    expect(effectiveAllowedTools(blockedOnly)).toEqual(DEFAULT_ALLOWED_TOOLS.filter(tool => !['write', 'bash'].includes(tool.toLowerCase())));
    expect(effectiveAllowedTools({ allowedTools: ['Read', 'Bash'], blockedTools: ['bash'], approvalMode: 'human' })).toEqual(['Read']);
  });

  it('reports whether anything is restricted at all', () => {
    expect(hasRestrictedToolPolicy({ allowedTools: [], blockedTools: [], approvalMode: 'auto' })).toBe(false);
    expect(hasRestrictedToolPolicy(readOnly)).toBe(true);
  });
});

describe('evaluateToolPolicy', () => {
  it('returns no decisions for an unrestricted policy on any runtime', () => {
    const verdict = evaluateToolPolicy({ allowedTools: [], blockedTools: [], approvalMode: 'auto' }, 'unsupported');
    expect(verdict).toMatchObject({
      enforcement: 'exact',
      decisions: [],
      readOnly: false,
      unsupportedReason: null,
      approval: { mode: 'auto', humanGate: false },
    });
  });

  it('allows the allowlist, denies the known tools outside it, and keeps the human gate', () => {
    const verdict = evaluateToolPolicy(readOnly, 'native');
    expect(verdict.readOnly).toBe(true);
    expect(verdict.enforcement).toBe('exact');
    expect(verdict.approval).toEqual({ mode: 'human', humanGate: true });
    expect(verdict.decisions).toContainEqual({ tool: 'Read', decision: 'allow', reason: null });
    expect(verdict.decisions).toContainEqual({ tool: 'write', decision: 'deny', reason: 'Not in the Role allowlist.' });
    expect(verdict.warnings).toEqual([]);
  });

  it('denies blocked tools with a reason when the allowlist is empty', () => {
    const verdict = evaluateToolPolicy(blockedOnly, 'native');
    expect(verdict.readOnly).toBe(false);
    expect(verdict.decisions).toContainEqual({ tool: 'Write', decision: 'deny', reason: 'Blocked by the Role tool policy.' });
    expect(verdict.decisions).toContainEqual({ tool: 'Read', decision: 'allow', reason: null });
  });

  it('reports unsupported instead of throwing, with a reason', () => {
    const verdict = evaluateToolPolicy(readOnly, 'unsupported');
    expect(verdict.enforcement).toBe('unsupported');
    expect(verdict.unsupportedReason).toContain('no tool-policy support');
    expect(verdict.warnings.join(' ')).toContain('cannot enforce');
  });

  it('marks a wrapper runtime as coarse and advises', () => {
    const verdict = evaluateToolPolicy(readOnly, 'wrapper');
    expect(verdict.enforcement).toBe('coarse');
    expect(verdict.warnings.join(' ')).toContain('external wrapper');
  });
});
