import { describe, expect, it } from 'vitest';
import { expandPipelineTemplate, validatePipelineTemplates } from '../src/pipeline-template.js';

describe('validatePipelineTemplates', () => {
  const pipeline = [
    { id: 'architecture', prompt: 'Plan the work.' },
    { id: 'implement', prompt: 'Use {{step:architecture.output}} and {{ previous.commit }}.' },
    { id: 'review', prompt: 'Check {{ step:implement.output }}.' },
  ];

  it('accepts known tokens, whitespace and unrelated braces', () => {
    expect(validatePipelineTemplates([
      ...pipeline,
      { id: 'notes', prompt: '{{not-a-template}}' },
    ])).toEqual([]);
  });

  it('rejects unknown step ids', () => {
    const issues = validatePipelineTemplates([
      { id: 'implement', prompt: 'Use {{step:missing.output}}.' },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ stepId: 'implement', reason: 'unknown-step' });
    expect(issues[0]?.message).toContain('unknown step missing');
  });

  it('rejects a bad field or a missing dot in a step token', () => {
    const issues = validatePipelineTemplates([
      { id: 'implement', prompt: '{{step:architecture.tokens}}' },
      { id: 'review', prompt: '{{step:architecture output}}' },
    ]);
    expect(issues.map(issue => issue.reason)).toEqual(['malformed', 'malformed']);
    expect(issues[0]?.message).toContain('malformed template token');
  });

  it('rejects a step referencing its own output', () => {
    const issues = validatePipelineTemplates([
      { id: 'implement', prompt: '{{step:implement.output}}' },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ reason: 'self-reference' });
    expect(issues[0]?.message).toContain('cannot reference its own output');
  });

  it('rejects an unclosed token', () => {
    const issues = validatePipelineTemplates([
      { id: 'review', prompt: 'Check {{step:architecture.output' },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ reason: 'unclosed' });
    expect(issues[0]?.message).toContain('unclosed template token');
  });
});

describe('expandPipelineTemplate', () => {
  const steps = new Map([
    ['architecture', { output: 'Use a queue.', commitSha: 'a'.repeat(40) }],
    ['review', { output: '', commitSha: '' }],
  ]);

  it('substitutes previous output and commit', () => {
    const expanded = expandPipelineTemplate('Implement {{previous.output}}\nBase {{previous.commit}}.', {
      previous: steps.get('architecture'),
      steps,
    });
    expect(expanded).toContain('Implement Use a queue.');
    expect(expanded).toContain(`Base ${'a'.repeat(40)}.`);
  });

  it('substitutes a completed step by id', () => {
    const expanded = expandPipelineTemplate('Follow {{step:architecture.output}} from {{step:architecture.commit}}.', { steps });
    expect(expanded).toContain('Follow Use a queue.');
    expect(expanded).toContain(`from ${'a'.repeat(40)}.`);
  });

  it('leaves unknown steps, missing values and malformed tokens untouched', () => {
    const expanded = expandPipelineTemplate(
      '{{step:unknown.output}} {{previous.output}} {{step:review.output}} {{step:architecture.tokens}}',
      { steps },
    );
    expect(expanded).toBe('{{step:unknown.output}} {{previous.output}} {{step:review.output}} {{step:architecture.tokens}}');
  });

  it('substitutes tokens with whitespace inside braces', () => {
    const expanded = expandPipelineTemplate('Use {{ previous.output }} from {{ step:architecture.commit }}.', {
      previous: steps.get('architecture'),
      steps,
    });
    expect(expanded).toBe(`Use Use a queue. from ${'a'.repeat(40)}.`);
  });

  it('marks a truncated output when substituted', () => {
    const expanded = expandPipelineTemplate('{{step:architecture.output}} commit {{step:architecture.commit}}', {
      steps: new Map([['architecture', { output: 'A'.repeat(10), outputTruncated: true, commitSha: 'a'.repeat(40) }]]),
    });
    expect(expanded).toContain('A'.repeat(10));
    expect(expanded).toContain('[The output above was truncated to 2000 characters.]');
    expect(expanded).toContain(`commit ${'a'.repeat(40)}`);
  });

  it('returns templates without placeholders unchanged', () => {
    expect(expandPipelineTemplate('Plain prompt.', { steps })).toBe('Plain prompt.');
  });
});
