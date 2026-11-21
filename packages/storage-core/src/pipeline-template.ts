/**
 * Replace upstream-step placeholders in a pipeline step prompt before it reaches the runner.
 *
 * Supported tokens:
 * - `{{previous.output}}` / `{{previous.commit}}`: the adjacent upstream step of a serial
 *   pipeline (for a DAG step, the last dependency).
 * - `{{step:<id>.output}}` / `{{step:<id>.commit}}`: any earlier completed step by id.
 *
 * Substitution only happens when the referenced step completed and the field has a value;
 * an unknown id, a step that has not completed, or a missing output/commit leaves the token
 * untouched so the prompt never silently loses text. Outputs are whatever the kernel recorded
 * for that step (currently capped at 2000 characters).
 */

export type PipelineTemplateSnapshot = {
  output?: string | null;
  commitSha?: string | null;
};

export type PipelineTemplateContext = {
  previous?: PipelineTemplateSnapshot;
  steps: ReadonlyMap<string, PipelineTemplateSnapshot>;
};

const PREVIOUS_PATTERN = /\{\{previous\.(output|commit)\}\}/g;
const STEP_PATTERN = /\{\{step:([^}.\s]+)\.(output|commit)\}\}/g;

function pick(snapshot: PipelineTemplateSnapshot | undefined, field: 'output' | 'commit'): string | undefined {
  if (!snapshot) return undefined;
  const value = field === 'output' ? snapshot.output : snapshot.commitSha;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function expandPipelineTemplate(template: string, context: PipelineTemplateContext): string {
  if (!template.includes('{{')) return template;
  const withPrevious = template.replace(PREVIOUS_PATTERN, (token, field: string) => (
    pick(context.previous, field === 'commit' ? 'commit' : 'output') ?? token
  ));
  return withPrevious.replace(STEP_PATTERN, (token, stepId: string, field: string) => (
    pick(context.steps.get(stepId), field === 'commit' ? 'commit' : 'output') ?? token
  ));
}
