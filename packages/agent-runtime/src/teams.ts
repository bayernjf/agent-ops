import { z } from 'zod';
import { ensureUniqueRoleId, slugifyRoleName } from './roles.js';

/**
 * A Team is nothing but a roster plus the handoff edges between its Roles. It deliberately carries
 * no execution state: work still runs as a Task/Run, and a handoff's deliverable is the upstream
 * commit (and its artifacts), not a chat transcript.
 */
export type TeamHandoff = {
  fromRoleId: string;
  toRoleId: string;
  /** What the downstream Role should pick up; the deliverable itself is the upstream commit. */
  note?: string;
};

export type AgentTeam = {
  id: string;
  name: string;
  description?: string;
  roleIds: string[];
  handoffs: TeamHandoff[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

const teamIdPattern = /^[a-z0-9][a-z0-9-]*$/;
const roleIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(teamIdPattern, 'Role ID must be lowercase alphanumeric with hyphens');

export const teamHandoffSchema = z.object({
  fromRoleId: roleIdSchema,
  toRoleId: roleIdSchema,
  note: z.string().trim().max(500).optional(),
});

export type TeamGraphIssue = {
  path: (string | number)[];
  message: string;
};

/**
 * Roster and handoff rules shared by the stored shape and the create/update inputs:
 * every Role appears once, every edge joins two members, no self-handoff, no duplicate edge,
 * and the handoff graph stays acyclic so a downstream Role always has a defined upstream.
 */
export function validateTeamGraph(roleIds: string[], handoffs: TeamHandoff[]): TeamGraphIssue[] {
  const issues: TeamGraphIssue[] = [];
  if (roleIds.length === 0) {
    issues.push({ path: ['roleIds'], message: 'A Team needs at least one Role.' });
  }

  const members = new Set<string>();
  roleIds.forEach((roleId, index) => {
    if (members.has(roleId)) {
      issues.push({ path: ['roleIds', index], message: `Role ${roleId} appears more than once.` });
    }
    members.add(roleId);
  });

  const adjacency = new Map<string, Set<string>>();
  const seenEdges = new Set<string>();
  let hasBlockingEdgeIssue = false;

  handoffs.forEach((handoff, index) => {
    const edge = `${handoff.fromRoleId}->${handoff.toRoleId}`;
    if (!members.has(handoff.fromRoleId)) {
      issues.push({ path: ['handoffs', index, 'fromRoleId'], message: `Role ${handoff.fromRoleId} is not on this Team.` });
      hasBlockingEdgeIssue = true;
    }
    if (!members.has(handoff.toRoleId)) {
      issues.push({ path: ['handoffs', index, 'toRoleId'], message: `Role ${handoff.toRoleId} is not on this Team.` });
      hasBlockingEdgeIssue = true;
    }
    if (handoff.fromRoleId === handoff.toRoleId) {
      issues.push({ path: ['handoffs', index, 'toRoleId'], message: 'A Role cannot hand off to itself.' });
    }
    if (seenEdges.has(edge)) {
      issues.push({ path: ['handoffs', index], message: `Duplicate handoff ${edge}.` });
    }
    seenEdges.add(edge);
    if (members.has(handoff.fromRoleId) && members.has(handoff.toRoleId) && handoff.fromRoleId !== handoff.toRoleId) {
      const outgoing = adjacency.get(handoff.fromRoleId) ?? new Set<string>();
      outgoing.add(handoff.toRoleId);
      adjacency.set(handoff.fromRoleId, outgoing);
    }
  });

  if (hasBlockingEdgeIssue) return issues;

  const visited = new Set<string>();
  const onStack = new Set<string>();
  const findCycle = (node: string): string[] | null => {
    visited.add(node);
    onStack.add(node);
    for (const next of adjacency.get(node) ?? []) {
      if (onStack.has(next)) return [node, next];
      if (!visited.has(next)) {
        const cycle = findCycle(next);
        if (cycle) return cycle;
      }
    }
    onStack.delete(node);
    return null;
  };

  for (const roleId of members) {
    if (visited.has(roleId)) continue;
    const cycle = findCycle(roleId);
    if (cycle) {
      issues.push({ path: ['handoffs'], message: `Handoff cycle detected: ${cycle.join(' → ')}.` });
      break;
    }
  }

  return issues;
}

function addTeamIssues(
  team: { roleIds: string[]; handoffs: TeamHandoff[] },
  context: z.RefinementCtx,
): void {
  for (const issue of validateTeamGraph(team.roleIds, team.handoffs)) {
    context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  }
}

const teamBaseShape = {
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  roleIds: z.array(roleIdSchema).max(50),
  handoffs: z.array(teamHandoffSchema).max(200).default([]),
  enabled: z.boolean().default(true),
};

export const agentTeamSchema = z
  .object({
    id: z.string().min(1).max(100).regex(teamIdPattern, 'Team ID must be lowercase alphanumeric with hyphens'),
    ...teamBaseShape,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .superRefine(addTeamIssues);

export const agentTeamCreateSchema = z.object(teamBaseShape).superRefine(addTeamIssues);

export const agentTeamUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    roleIds: z.array(roleIdSchema).max(50).optional(),
    handoffs: z.array(teamHandoffSchema).max(200).optional(),
    enabled: z.boolean().optional(),
  })
  .refine(value => Object.keys(value).length > 0, 'At least one field must change.');

export function slugifyTeamName(name: string): string {
  return slugifyRoleName(name);
}

export function ensureUniqueTeamId(baseId: string, existingIds: string[]): string {
  return ensureUniqueRoleId(baseId, existingIds);
}
