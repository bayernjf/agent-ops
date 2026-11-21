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
 *
 * `validatePipelineTemplates` runs when a task is created and rejects tokens that can never
 * expand as written: unknown step ids, bad fields, self references, unclosed tokens, `previous`
 * without an upstream, and step references that are not guaranteed ancestors.
 */

/** Pipeline step outputs are capped before they enter task results and downstream prompts. */
export const PIPELINE_STEP_OUTPUT_LIMIT = 2000;

export type PipelineTemplateSnapshot = {
  output?: string | null;
  outputTruncated?: boolean;
  commitSha?: string | null;
};

export type PipelineTemplateContext = {
  previous?: PipelineTemplateSnapshot;
  steps: ReadonlyMap<string, PipelineTemplateSnapshot>;
};

const PREVIOUS_PATTERN = /\{\{\s*previous\.(output|commit)\s*\}\}/g;
const STEP_PATTERN = /\{\{\s*step:([^}.\s]+)\.(output|commit)\s*\}\}/g;
const PREVIOUS_BODY = /^previous\.(output|commit)$/;
const STEP_BODY = /^step:([A-Za-z0-9_-]+)\.(output|commit)$/;

export type PipelineTemplateStep = { id: string; prompt?: string | null; dependsOn?: readonly string[] };

export type PipelineTemplateIssue = {
  stepId: string;
  token: string;
  reason: 'malformed' | 'unknown-step' | 'self-reference' | 'unclosed' | 'no-upstream' | 'not-upstream';
  message: string;
};

function shortenToken(token: string): string {
  return token.length > 80 ? `${token.slice(0, 77)}...` : token;
}

/**
 * Check step prompts for template tokens that would otherwise survive expansion and reach the
 * model as literal text. Only tokens starting with `previous` or `step:` are inspected, so
 * ordinary `{{...}}` text in prompts is left alone. Unknown ids, bad fields, self references and
 * missing closing braces are reported before a task is created.
 */
function upstreamSteps(steps: readonly PipelineTemplateStep[]): Map<string, Set<string>> {
  const stepIds = new Set(steps.map(step => step.id));
  const dependencies = new Map<string, readonly string[]>();
  steps.forEach((step, position) => {
    // Match the scheduler: explicit dependsOn wins, including an empty root; otherwise a
    // step depends on its serial predecessor.
    dependencies.set(step.id, step.dependsOn ?? (position > 0 ? [steps[position - 1]!.id] : []));
  });
  const ancestors = new Map<string, Set<string>>();
  const visit = (id: string, visiting: Set<string>): Set<string> => {
    const cached = ancestors.get(id);
    if (cached) return cached;
    if (visiting.has(id)) return new Set();
    visiting.add(id);
    const result = new Set<string>();
    for (const dependency of dependencies.get(id) ?? []) {
      if (!stepIds.has(dependency)) continue;
      result.add(dependency);
      for (const ancestor of visit(dependency, visiting)) result.add(ancestor);
    }
    visiting.delete(id);
    ancestors.set(id, result);
    return result;
  };
  for (const step of steps) visit(step.id, new Set());
  return ancestors;
}

export function validatePipelineTemplates(steps: readonly PipelineTemplateStep[]): PipelineTemplateIssue[] {
  const stepIds = new Set(steps.map(step => step.id));
  const upstreams = upstreamSteps(steps);
  const issues: PipelineTemplateIssue[] = [];
  const malformed = (stepId: string, token: string): PipelineTemplateIssue => ({
    stepId,
    token,
    reason: 'malformed',
    message: `Pipeline step ${stepId} has a malformed template token ${token}. Supported forms: {{previous.output}}, {{previous.commit}}, {{step:<id>.output}}, {{step:<id>.commit}}.`,
  });

  for (const step of steps) {
    const prompt = step.prompt ?? '';
    let index = prompt.indexOf('{{');
    while (index >= 0) {
      const lineEnd = prompt.indexOf('\n', index + 2);
      const limit = lineEnd === -1 ? prompt.length : lineEnd;
      const close = prompt.indexOf('}}', index + 2);
      if (close === -1 || close > limit) {
        const head = prompt.slice(index + 2, limit).trim();
        if (head.startsWith('previous') || head.startsWith('step:')) {
          const token = shortenToken(prompt.slice(index, limit));
          issues.push({
            stepId: step.id,
            token,
            reason: 'unclosed',
            message: `Pipeline step ${step.id} has an unclosed template token ${token}.`,
          });
        }
        index = prompt.indexOf('{{', limit);
        continue;
      }
      const token = shortenToken(prompt.slice(index, close + 2));
      const body = prompt.slice(index + 2, close).trim();
      if (body.startsWith('previous')) {
        if (!PREVIOUS_BODY.test(body)) {
          issues.push(malformed(step.id, token));
        } else if (!upstreams.get(step.id)?.size) {
          issues.push({
            stepId: step.id,
            token,
            reason: 'no-upstream',
            message: `Pipeline step ${step.id} has template token ${token} but no upstream step to expand it.`,
          });
        }
      } else if (body.startsWith('step:')) {
        const match = STEP_BODY.exec(body);
        if (!match) {
          issues.push(malformed(step.id, token));
        } else {
          const referenced = match[1]!;
          const field = match[2]!;
          if (!stepIds.has(referenced)) {
            issues.push({
              stepId: step.id,
              token,
              reason: 'unknown-step',
              message: `Pipeline step ${step.id} references unknown step ${referenced} in template token ${token}.`,
            });
          } else if (referenced === step.id) {
            issues.push({
              stepId: step.id,
              token,
              reason: 'self-reference',
              message: `Pipeline step ${step.id} cannot reference its own ${field} in template token ${token}.`,
            });
          } else if (!upstreams.get(step.id)?.has(referenced)) {
            issues.push({
              stepId: step.id,
              token,
              reason: 'not-upstream',
              message: `Pipeline step ${step.id} has template token ${token} referencing step ${referenced}, which is not guaranteed to complete before it.`,
            });
          }
        }
      }
      index = prompt.indexOf('{{', close + 2);
    }
  }
  return issues;
}


function pick(snapshot: PipelineTemplateSnapshot | undefined, field: 'output' | 'commit'): string | undefined {
  if (!snapshot) return undefined;
  const value = field === 'output' ? snapshot.output : snapshot.commitSha;
  if (typeof value !== 'string' || value.length === 0) return undefined;
  if (field === 'output' && snapshot.outputTruncated) {
    return `${value}\n[The output above was truncated to ${PIPELINE_STEP_OUTPUT_LIMIT} characters.]`;
  }
  return value;
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
