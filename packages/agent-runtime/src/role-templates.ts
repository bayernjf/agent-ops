import type { RoleRuntimePolicy } from './roles.js';

/**
 * Built-in Role templates. They are plain constants, not stored data: a template only pre-fills
 * a new Role (prompt, acceptance criteria, tool policy), and the copy that is finally created
 * can be edited freely. Five shapes cover the serial team the product ships for.
 */
export type RoleTemplate = {
  id: string;
  name: string;
  description: string;
  /** Verified base agent the template assumes; instantiation can point it at a Profile instead. */
  baseAgentId: string;
  systemPrompt: string;
  acceptanceCriteria: string[];
  runtimePolicy: RoleRuntimePolicy;
};

export const roleTemplates: readonly RoleTemplate[] = [
  {
    id: 'architect',
    name: 'Architect',
    description: 'Designs the approach and hands a plan to the implementer.',
    baseAgentId: 'codex',
    systemPrompt: 'Design before building. Read the repository, name the files that will change, and write a short plan with risks and open questions. Do not modify files.',
    acceptanceCriteria: ['A written plan that names the files to change.', 'Risks and open questions are called out.'],
    runtimePolicy: { allowedTools: ['Read', 'Grep', 'Glob'], blockedTools: ['Write', 'Edit', 'Bash'], approvalMode: 'human' },
  },
  {
    id: 'implementer',
    name: 'Implementer',
    description: 'Turns an approved plan into code and keeps the change scoped.',
    baseAgentId: 'codex',
    systemPrompt: 'Implement the plan you were handed. Keep changes scoped to it, run the project checks that exist, and summarize what changed and what is still risky.',
    acceptanceCriteria: ['The change matches the plan.', 'Existing checks run and their result is reported.'],
    runtimePolicy: { allowedTools: ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Bash'], blockedTools: [], approvalMode: 'human' },
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    description: 'Reviews the diff without changing code.',
    baseAgentId: 'codex',
    systemPrompt: 'Review the diff you were given. Report correctness, regression and test-coverage problems with file and line references. Never modify files.',
    acceptanceCriteria: ['Findings reference files and lines.', 'Blocking issues are separated from nits.'],
    runtimePolicy: { allowedTools: ['Read', 'Grep', 'Glob'], blockedTools: ['Write', 'Edit', 'Bash'], approvalMode: 'strict' },
  },
  {
    id: 'tester',
    name: 'Tester',
    description: 'Adds or runs the tests that prove the change works.',
    baseAgentId: 'codex',
    systemPrompt: 'Prove the change works. Add or update the smallest useful tests, run the relevant suite, and report pass/fail output verbatim.',
    acceptanceCriteria: ['Relevant tests run and their output is reported.', 'New tests fail before the change and pass after it.'],
    runtimePolicy: { allowedTools: ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Bash'], blockedTools: [], approvalMode: 'human' },
  },
  {
    id: 'researcher',
    name: 'Researcher',
    description: 'Investigates a question and reports findings without writing code.',
    baseAgentId: 'codex',
    systemPrompt: 'Investigate the question you were given. Cite the files and commands that support each finding, and state what you could not verify.',
    acceptanceCriteria: ['Each finding cites its evidence.', 'Unverified claims are marked as such.'],
    runtimePolicy: { allowedTools: ['Read', 'Grep', 'Glob'], blockedTools: ['Write', 'Edit', 'Bash'], approvalMode: 'auto' },
  },
];

export function getRoleTemplate(id: string): RoleTemplate | undefined {
  return roleTemplates.find(template => template.id === id);
}
