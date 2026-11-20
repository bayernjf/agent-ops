import type { RuntimeAdapter } from './runtime-registry.js';
import {
  KNOWN_TOOL_NAMES,
  READ_ONLY_TOOL_NAMES,
  WRITE_TOOL_NAMES,
  effectiveAllowedTools,
  evaluateToolPolicy,
  hasRestrictedToolPolicy,
  isReadOnlyTool,
  isReadOnlyToolPolicy,
  normalizeToolName,
  type CanonicalToolPolicy,
  type ToolDecision,
  type ToolPolicyCapability,
  type UnifiedPolicyVerdict,
} from '@agent-ops/policy/tool-policy';

/**
 * The part of a Role policy an Adapter can actually express on its command line. The canonical
 * decisions and capability checks live in `@agent-ops/policy/tool-policy`; this module only adds
 * the dialect-specific notes each built-in Adapter needs.
 */
export type RuntimeToolPolicy = CanonicalToolPolicy;

export type ToolPolicyEnforcement = 'exact' | 'coarse';

export type ResolvedToolPolicy = {
  /** Tools after intersecting the allowlist with the Adapter's defaults and removing blocks. */
  allowedTools: string[];
  blockedTools: string[];
  readOnly: boolean;
  enforcement: ToolPolicyEnforcement;
  warnings: string[];
};

export {
  KNOWN_TOOL_NAMES,
  READ_ONLY_TOOL_NAMES,
  WRITE_TOOL_NAMES,
  effectiveAllowedTools,
  evaluateToolPolicy,
  hasRestrictedToolPolicy,
  isReadOnlyTool,
  isReadOnlyToolPolicy,
  normalizeToolName,
};
export type { CanonicalToolPolicy, ToolDecision, ToolPolicyCapability, UnifiedPolicyVerdict };

/** Write-tool names the built-in Adapters understand; exported for tests and documentation. */
export const KNOWN_WRITE_TOOLS = [...WRITE_TOOL_NAMES];

/**
 * Resolve the policy a specific Adapter can enforce. Unsupported Adapters reject a restricted
 * policy instead of silently running with their all-permissions default (Hermes `--yolo`).
 */
export function resolveToolPolicy(adapter: RuntimeAdapter, policy: RuntimeToolPolicy): ResolvedToolPolicy {
  if (!hasRestrictedToolPolicy(policy)) {
    return { allowedTools: [], blockedTools: [], readOnly: false, enforcement: 'exact', warnings: [] };
  }

  const verdict = evaluateToolPolicy(policy, adapter.capabilities.toolPolicy);
  if (verdict.enforcement === 'unsupported') {
    throw new Error(
      `Runtime "${adapter.id}" cannot enforce a Role tool policy. ${verdict.unsupportedReason ?? ''} `
      + 'Remove allowedTools/blockedTools or use a Runtime with native tool-policy support.',
    );
  }

  const warnings = [...verdict.warnings];

  if (adapter.id === 'codex') {
    if (!verdict.readOnly && policy.allowedTools.length > 0) {
      warnings.push('Codex maps a Role allowlist to its read-only or workspace-write sandbox; the tool list itself is advisory.');
    }
    const ignoredBlocks = policy.blockedTools.filter(tool => !isReadOnlyTool(tool));
    if (!verdict.readOnly && ignoredBlocks.length > 0) {
      warnings.push(`Codex cannot block individual non-read-only tools (${ignoredBlocks.join(', ')}); workspace-write still exposes them.`);
    }
  }

  if (adapter.id === 'claude-code' && verdict.allowedTools.length === 0) {
    throw new Error('Role tool policy leaves no tools for claude-code to run.');
  }

  if (adapter.id !== 'codex' && adapter.id !== 'claude-code' && adapter.capabilities.toolPolicy === 'native') {
    warnings.push(`Runtime "${adapter.id}" has native tool-policy support but no mapping yet; the Role policy is advisory.`);
  }

  return {
    allowedTools: verdict.allowedTools,
    blockedTools: verdict.blockedTools,
    readOnly: verdict.readOnly,
    // Codex expresses a non-read-only allowlist only through its sandbox mode.
    enforcement: adapter.id === 'codex'
      ? (verdict.readOnly ? 'exact' : 'coarse')
      : (verdict.enforcement === 'exact' ? 'exact' : 'coarse'),
    warnings,
  };
}
