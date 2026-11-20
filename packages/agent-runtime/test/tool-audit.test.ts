import { describe, expect, it } from 'vitest';
import { extractToolAudit, TOOL_AUDIT_LIMIT } from '../src/tool-audit.js';

const line = (value: unknown) => JSON.stringify(value);

describe('extractToolAudit', () => {
  it('reads tool_use blocks and permission denials from JSON lines', () => {
    const output = [
      line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', id: 'one' }] } }),
      line({ type: 'result', permission_denials: [{ tool_name: 'Bash', reason: 'not allowed' }] }),
    ].join('\n');
    const audit = extractToolAudit(output);
    expect(audit.source).toBe('runtime');
    expect(audit.reason).toBeNull();
    expect(audit.calls).toEqual([
      { name: 'Read', status: 'ok', reason: null },
      { name: 'Bash', status: 'denied', reason: 'not allowed' },
    ]);
  });

  it('deduplicates repeated calls of the same tool', () => {
    const output = [1, 2, 3].map(index => line({ type: 'tool_call', name: 'Grep', id: index })).join('\n');
    expect(extractToolAudit(output).calls).toEqual([{ name: 'Grep', status: 'ok', reason: null }]);
  });

  it('parses a pretty-printed document as a whole', () => {
    const output = JSON.stringify({ type: 'result', permission_denials: [{ tool_name: 'Edit' }] }, null, 2);
    expect(extractToolAudit(output).calls).toEqual([{ name: 'Edit', status: 'denied', reason: null }]);
  });

  it('marks unknown when the runtime did not report tools', () => {
    const audit = extractToolAudit('the agent wrote a short summary and stopped');
    expect(audit).toEqual({
      calls: [],
      source: 'unknown',
      reason: 'The runtime output did not report tool calls.',
    });
  });

  it('ignores malformed JSON lines without losing the rest', () => {
    const output = [
      '{"type": "tool_use", "name": "Read"',
      line({ type: 'tool_use', name: 'Write' }),
    ].join('\n');
    expect(extractToolAudit(output).calls).toEqual([{ name: 'Write', status: 'ok', reason: null }]);
  });

  it('caps the number of recorded calls', () => {
    const output = Array.from({ length: TOOL_AUDIT_LIMIT + 20 }, (_value, index) => line({ type: 'tool_use', name: `Tool${index}` })).join('\n');
    expect(extractToolAudit(output).calls).toHaveLength(TOOL_AUDIT_LIMIT);
  });
});
