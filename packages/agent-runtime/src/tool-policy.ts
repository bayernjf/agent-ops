import type { RuntimeAdapter } from './runtime-registry.js';

/**
 * The part of a Role policy an Adapter can actually express on its command line. This is
 * deliberately separate from RoleRuntimePolicy: `approvalMode` belongs to the human gate, not to a
 * CLI flag, so an Adapter must not pretend it enforces it.
 */
export type RuntimeToolPolicy = {
  allowedTools: string[];
  blockedTools: string[];
  approvalMode: 'auto' | 'human' | 'strict';
};

export type ToolPolicyEnforcement = 'exact' | 'coarse';

export type ResolvedToolPolicy = {
  /** Tools after intersecting the allowlist with the Adapter's defaults and removing blocks. */
  allowedTools: string[];
  blockedTools: string[];
  readOnly: boolean;
  enforcement: ToolPolicyEnforcement;
  warnings: string[];
};

/** Tools that cannot mutate the worktree when used on their own. */
const READ_ONLY_TOOLS = new Set(['read', 'grep', 'glob', 'ls', 'list', 'search', 'view', 'git_status', 'git-status']);

const WRITE_TOOLS = new Set(['write', 'edit', 'bash', 'shell', 'multiedit', 'notebookedit', 'apply_patch', 'patch', 'create', 'delete', 'move']);

const CLAUDE_DEFAULT_TOOLS = ['Read', 'Write', 'Edit', 'Bash'];

export function normalizeToolName(name: string): string {
  return name.trim().toLowerCase();
}

export function hasRestrictedToolPolicy(policy: RuntimeToolPolicy | undefined): boolean {
  return Boolean(policy && (policy.allowedTools.length > 0 || policy.blockedTools.length > 0));
}

/**
 * A policy is read-only only when its allowlist is non-empty and every allowed tool is known to be
 * non-mutating. A blocked-only policy can still leave `Write` or `Bash` available, so it is not
 * treated as read-only; that would overstate the guarantee.
 */
export function isReadOnlyToolPolicy(policy: RuntimeToolPolicy): boolean {
  if (policy.allowedTools.length === 0) return false;
  return policy.allowedTools.every(tool => READ_ONLY_TOOLS.has(normalizeToolName(tool)));
}

export function effectiveAllowedTools(policy: RuntimeToolPolicy, defaults: string[] = CLAUDE_DEFAULT_TOOLS): string[] {
  const allowed = policy.allowedTools.length > 0 ? policy.allowedTools : defaults;
  const blocked = new Set(policy.blockedTools.map(normalizeToolName));
  return allowed.filter(tool => !blocked.has(normalizeToolName(tool)));
}

function blockedNonReadOnlyTools(policy: RuntimeToolPolicy): string[] {
  return policy.blockedTools.filter(tool => !READ_ONLY_TOOLS.has(normalizeToolName(tool)));
}

/**
 * Resolve the policy a specific Adapter can enforce. Unsupported Adapters reject a restricted
 * policy instead of silently running with their all-permissions default (Hermes `--yolo`).
 */
export function resolveToolPolicy(adapter: RuntimeAdapter, policy: RuntimeToolPolicy): ResolvedToolPolicy {
  if (!hasRestrictedToolPolicy(policy)) {
    return { allowedTools: [], blockedTools: [], readOnly: false, enforcement: 'exact', warnings: [] };
  }

  if (adapter.capabilities.toolPolicy === 'unsupported') {
    throw new Error(
      `Runtime "${adapter.id}" cannot enforce a Role tool policy. Remove allowedTools/blockedTools or use a Runtime with native tool-policy support.`,
    );
  }

  if (adapter.id === 'codex') {
    const readOnly = isReadOnlyToolPolicy(policy);
    const warnings: string[] = [];
    if (!readOnly && policy.allowedTools.length > 0) {
      warnings.push('Codex maps a Role allowlist to its read-only or workspace-write sandbox; the tool list itself is advisory.');
    }
    const ignoredBlocks = blockedNonReadOnlyTools(policy);
    if (!readOnly && ignoredBlocks.length > 0) {
      warnings.push(`Codex cannot block individual non-read-only tools (${ignoredBlocks.join(', ')}); workspace-write still exposes them.`);
    }
    return {
      allowedTools: policy.allowedTools,
      blockedTools: policy.blockedTools,
      readOnly,
      enforcement: readOnly ? 'exact' : 'coarse',
      warnings,
    };
  }

  if (adapter.id === 'claude-code') {
    const allowedTools = effectiveAllowedTools(policy);
    if (allowedTools.length === 0) {
      throw new Error('Role tool policy leaves no tools for claude-code to run.');
    }
    return {
      allowedTools,
      blockedTools: policy.blockedTools,
      readOnly: isReadOnlyToolPolicy(policy),
      enforcement: 'exact',
      warnings: [],
    };
  }

  return {
    allowedTools: policy.allowedTools,
    blockedTools: policy.blockedTools,
    readOnly: false,
    enforcement: 'coarse',
    warnings: [`Runtime "${adapter.id}" has native tool-policy support but no mapping yet; the Role policy is advisory.`],
  };
}

/** Write-tool names the built-in Adapters understand; exported for tests and documentation. */
export const KNOWN_WRITE_TOOLS = [...WRITE_TOOLS];
