import { describe, expect, it } from 'vitest';
import { expandPipelineTemplate } from '../src/pipeline-template.js';

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
      '{{step:unknown.output}} {{previous.output}} {{step:review.output}} {{ previous.output }} {{step:architecture.tokens}}',
      { steps },
    );
    expect(expanded).toBe('{{step:unknown.output}} {{previous.output}} {{step:review.output}} {{ previous.output }} {{step:architecture.tokens}}');
  });

  it('returns templates without placeholders unchanged', () => {
    expect(expandPipelineTemplate('Plain prompt.', { steps })).toBe('Plain prompt.');
  });
});
