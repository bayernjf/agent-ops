/**
 * Runtime-neutral tool policy. This module answers "what may this Role do" in one canonical
 * vocabulary (allow / deny / ask) and states how faithfully a Runtime can express it. Adapter
 * dialects (Codex sandbox flags, Claude `--allowedTools`) stay in the Adapter; nothing here
 * depends on them.
 */

export type CanonicalToolPolicy = {
  allowedTools: string[];
  blockedTools: string[];
  approvalMode: 'auto' | 'human' | 'strict';
};

/** How a Runtime expresses tool decisions: natively, through an external wrapper, or not at all. */
export type ToolPolicyCapability = 'native' | 'wrapper' | 'unsupported';

export type ToolDecision = {
  tool: string;
  decision: 'allow' | 'deny';
  reason: string | null;
};

export type UnifiedPolicyVerdict = {
  /** Whether the policy restricts the Role to non-mutating tools. */
  readOnly: boolean;
  /** How closely the Runtime can enforce the decisions: exact, coarse, or not at all. */
  enforcement: 'exact' | 'coarse' | 'unsupported';
  allowedTools: string[];
  blockedTools: string[];
  decisions: ToolDecision[];
  /** The human gate the policy asks for; this is never delegated to a CLI flag. */
  approval: { mode: CanonicalToolPolicy['approvalMode']; humanGate: boolean };
  warnings: string[];
  unsupportedReason: string | null;
};

/** Tools that cannot mutate the worktree when used on their own. */
export const READ_ONLY_TOOL_NAMES = new Set(['read', 'grep', 'glob', 'ls', 'list', 'search', 'view', 'git_status', 'git-status']);

export const WRITE_TOOL_NAMES = new Set(['write', 'edit', 'bash', 'shell', 'multiedit', 'notebookedit', 'apply_patch', 'patch', 'create', 'delete', 'move']);

/** The tools the built-in Adapters understand; used for decisions outside the allowlist. */
export const KNOWN_TOOL_NAMES = [...READ_ONLY_TOOL_NAMES, ...WRITE_TOOL_NAMES];

export const DEFAULT_ALLOWED_TOOLS = ['Read', 'Write', 'Edit', 'Bash'];

export function normalizeToolName(name: string): string {
  return name.trim().toLowerCase();
}

export function isReadOnlyTool(tool: string): boolean {
  return READ_ONLY_TOOL_NAMES.has(normalizeToolName(tool));
}

export function hasRestrictedToolPolicy(policy: CanonicalToolPolicy | undefined): boolean {
  return Boolean(policy && (policy.allowedTools.length > 0 || policy.blockedTools.length > 0));
}

/**
 * A policy is read-only only when its allowlist is non-empty and every allowed tool is known to be
 * non-mutating. A blocked-only policy can still leave Write or Bash available, so it is not treated
 * as read-only; that would overstate the guarantee.
 */
export function isReadOnlyToolPolicy(policy: CanonicalToolPolicy): boolean {
  if (policy.allowedTools.length === 0) return false;
  return policy.allowedTools.every(isReadOnlyTool);
}

export function effectiveAllowedTools(policy: CanonicalToolPolicy, defaults: string[] = DEFAULT_ALLOWED_TOOLS): string[] {
  const allowed = policy.allowedTools.length > 0 ? policy.allowedTools : defaults;
  const blocked = new Set(policy.blockedTools.map(normalizeToolName));
  return allowed.filter(tool => !blocked.has(normalizeToolName(tool)));
}

/**
 * Evaluate a Role policy against one Runtime's capability. It never throws: an unsupported Runtime
 * yields `enforcement: 'unsupported'` plus a reason, so a caller can report or refuse deliberately.
 */
export function evaluateToolPolicy(
  policy: CanonicalToolPolicy,
  capability: ToolPolicyCapability,
): UnifiedPolicyVerdict {
  const approval = { mode: policy.approvalMode, humanGate: policy.approvalMode !== 'auto' };
  const allowedTools = effectiveAllowedTools(policy);
  const warnings: string[] = [];
  const decisions: ToolDecision[] = [];

  if (!hasRestrictedToolPolicy(policy)) {
    // Nothing was asked for, so there is nothing a Runtime could fail to enforce.
    return {
      readOnly: false,
      enforcement: 'exact',
      allowedTools: [],
      blockedTools: [],
      decisions: [],
      approval,
      warnings,
      unsupportedReason: null,
    };
  }

  const allowedNames = new Set(allowedTools.map(normalizeToolName));
  const blockedNames = new Set(policy.blockedTools.map(normalizeToolName));

  for (const tool of allowedTools) {
    decisions.push({ tool, decision: 'allow', reason: null });
  }
  for (const tool of policy.blockedTools) {
    decisions.push({ tool, decision: 'deny', reason: 'Blocked by the Role tool policy.' });
  }
  if (policy.allowedTools.length > 0) {
    for (const tool of KNOWN_TOOL_NAMES) {
      if (!allowedNames.has(tool) && !blockedNames.has(tool)) {
        decisions.push({ tool, decision: 'deny', reason: 'Not in the Role allowlist.' });
      }
    }
  }

  const readOnly = isReadOnlyToolPolicy(policy);

  if (capability === 'unsupported') {
    return {
      readOnly,
      enforcement: 'unsupported',
      allowedTools,
      blockedTools: policy.blockedTools,
      decisions,
      approval,
      warnings: ['This Runtime cannot enforce a Role tool policy; it would run with its own defaults.'],
      unsupportedReason: 'The Runtime has no tool-policy support, so allow/deny decisions are advisory only.',
    };
  }

  if (capability === 'wrapper') {
    warnings.push('The Runtime enforces tool policy through an external wrapper; allow/deny decisions are advisory to this Adapter.');
  }

  return {
    readOnly,
    // A native Runtime restricts to the decisions; a wrapper only advises the Adapter.
    enforcement: capability === 'native' ? 'exact' : 'coarse',
    allowedTools,
    blockedTools: policy.blockedTools,
    decisions,
    approval,
    warnings,
    unsupportedReason: null,
  };
}
