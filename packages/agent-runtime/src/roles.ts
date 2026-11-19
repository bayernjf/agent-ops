import { z } from 'zod';
import type { AgentProfile } from './profiles.js';
import type { AgentAdapterStatus, RuntimeCapabilities } from './runtime-registry.js';
import { runtimeRegistry } from './runtime-registry.js';

export type RoleApprovalMode = 'auto' | 'human' | 'strict';

/**
 * The policy a Role carries into a Run. It is stored now; adapters enforce the parts they can
 * express (allowed/blocked tools). Approval mode is consumed by the human gate, not invented by
 * an adapter, so a Runtime that cannot express a tool policy still reports that honestly.
 */
export type RoleRuntimePolicy = {
  allowedTools: string[];
  blockedTools: string[];
  approvalMode: RoleApprovalMode;
};

export type AgentRole = {
  id: string;
  name: string;
  description?: string;
  /** Base Agent for a role that does not reference an existing Profile. */
  baseAgentId?: string;
  /** Existing Profile binding. When present, its baseAgentId wins. */
  profileId?: string;
  systemPrompt?: string;
  acceptanceCriteria: string[];
  runtimePolicy: RoleRuntimePolicy;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

const roleIdPattern = /^[a-z0-9][a-z0-9-]*$/;
const toolName = z.string().trim().min(1).max(100);

export const roleRuntimePolicySchema = z.object({
  allowedTools: z.array(toolName).max(100).default([]),
  blockedTools: z.array(toolName).max(100).default([]),
  approvalMode: z.enum(['auto', 'human', 'strict']).default('human'),
});

export const agentRoleSchema = z.object({
  id: z.string().min(1).max(100).regex(roleIdPattern, 'Role ID must be lowercase alphanumeric with hyphens'),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  baseAgentId: z.string().trim().min(1).max(100).optional(),
  profileId: z.string().trim().min(1).max(100).regex(roleIdPattern, 'Profile ID must be lowercase alphanumeric with hyphens').optional(),
  systemPrompt: z.string().max(10_000).optional(),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  runtimePolicy: roleRuntimePolicySchema,
  enabled: z.boolean().default(true),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).superRefine((role, context) => {
  if (!role.baseAgentId && !role.profileId) {
    context.addIssue({
      code: 'custom',
      path: ['baseAgentId'],
      message: 'A Role must name a baseAgentId or reference a profileId.',
    });
  }
});

export const agentRoleCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  baseAgentId: z.string().trim().min(1).max(100).optional(),
  profileId: z.string().trim().min(1).max(100).regex(roleIdPattern, 'Profile ID must be lowercase alphanumeric with hyphens').optional(),
  systemPrompt: z.string().max(10_000).optional(),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  runtimePolicy: roleRuntimePolicySchema.default({ allowedTools: [], blockedTools: [], approvalMode: 'human' }),
  enabled: z.boolean().default(true),
}).superRefine((role, context) => {
  if (!role.baseAgentId && !role.profileId) {
    context.addIssue({
      code: 'custom',
      path: ['baseAgentId'],
      message: 'A Role must name a baseAgentId or reference a profileId.',
    });
  }
});

export const agentRoleUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  baseAgentId: z.string().trim().min(1).max(100).optional(),
  profileId: z.string().trim().min(1).max(100).regex(roleIdPattern, 'Profile ID must be lowercase alphanumeric with hyphens').optional(),
  systemPrompt: z.string().max(10_000).optional(),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
  runtimePolicy: roleRuntimePolicySchema.optional(),
  enabled: z.boolean().optional(),
}).refine(value => Object.keys(value).length > 0, 'At least one field must change.');

export function slugifyRoleName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'role';
}

export function ensureUniqueRoleId(baseId: string, existingIds: string[]): string {
  if (!existingIds.includes(baseId)) return baseId;
  let counter = 2;
  while (existingIds.includes(`${baseId}-${counter}`)) counter++;
  return `${baseId}-${counter}`;
}

export type ResolveRoleOptions = {
  getProfile: (id: string) => Promise<AgentProfile | null>;
  registry?: typeof runtimeRegistry;
};

export type RoleRuntimeResolution = {
  role: AgentRole;
  baseAgentId?: string;
  profile?: AgentProfile;
  adapterStatus: AgentAdapterStatus;
  capabilities: RuntimeCapabilities | null;
  executable: boolean;
  reason?: 'profile-not-found' | 'no-base-agent' | 'profile-base-mismatch' | 'adapter-not-executable';
};

/**
 * Resolve a Role to the Runtime that would execute it. This is deliberately a resolution, not a
 * launch: callers can show the candidate Runtime and capabilities before a human creates a Run.
 */
export async function resolveRoleRuntime(
  role: AgentRole,
  options: ResolveRoleOptions,
): Promise<RoleRuntimeResolution> {
  const registry = options.registry ?? runtimeRegistry;
  if (role.profileId) {
    const profile = await options.getProfile(role.profileId);
    if (!profile) {
      return {
        role,
        baseAgentId: role.baseAgentId,
        adapterStatus: 'unsupported',
        capabilities: null,
        executable: false,
        reason: 'profile-not-found',
      };
    }
    if (role.baseAgentId && role.baseAgentId !== profile.baseAgentId) {
      return {
        role,
        baseAgentId: profile.baseAgentId,
        profile,
        adapterStatus: registry.status(profile.baseAgentId),
        capabilities: registry.capabilities(profile.baseAgentId),
        executable: false,
        reason: 'profile-base-mismatch',
      };
    }
    const adapterStatus = registry.status(profile.baseAgentId);
    return {
      role,
      baseAgentId: profile.baseAgentId,
      profile,
      adapterStatus,
      capabilities: registry.capabilities(profile.baseAgentId),
      executable: adapterStatus === 'verified',
      ...(adapterStatus === 'verified' ? {} : { reason: 'adapter-not-executable' as const }),
    };
  }

  if (!role.baseAgentId) {
    return {
      role,
      adapterStatus: 'unsupported',
      capabilities: null,
      executable: false,
      reason: 'no-base-agent',
    };
  }

  const adapterStatus = registry.status(role.baseAgentId);
  return {
    role,
    baseAgentId: role.baseAgentId,
    adapterStatus,
    capabilities: registry.capabilities(role.baseAgentId),
    executable: adapterStatus === 'verified',
    ...(adapterStatus === 'verified' ? {} : { reason: 'adapter-not-executable' as const }),
  };
}
