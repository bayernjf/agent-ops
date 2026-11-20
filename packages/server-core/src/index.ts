import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { KernelStore, RunEvent, CreateRoleInput, UpdateRoleInput, KernelAuditEventType } from '@agent-ops/storage-core';
import {
  type CodexProcessRunner,
  type CustomAgentInput,
  runDoctor,
  probeCodexRuntime,
  probeAgentCapabilities,
  getAgentAdapterStatus,
  discoverAgentRuntimes,
  isAgentExecutable,
  agentProfileCreateSchema,
  agentProfileUpdateSchema,
  agentRoleCreateSchema,
  agentRoleUpdateSchema,
  agentTeamCreateSchema,
  agentTeamUpdateSchema,
  evaluateToolPolicy,
  roleTemplates,
  getRoleTemplate,
  resolveRoleRuntime,
  runtimeRegistry,
  type AgentRole,
} from '@agent-ops/agent-runtime';
import { createTokenAuthMiddleware } from './auth.js';
import { loadCustomAgents, saveCustomAgents } from './agent-catalog.js';

export { daemonTokenPath, loadOrCreateDaemonToken, createTokenAuthMiddleware } from './auth.js';

// The kernel HTTP control plane: the Task/Run API that turns KernelStore (the core data
// layer) into a callable service. It has zero dependency on the webapp-delivery plugin,
// so a daemon can serve this surface without mounting Project/Blueprint/Apply/Release.

const pipelineStepSchema = z.object({
  id: z.string().trim().min(1).max(100).optional(),
  name: z.string().trim().min(1).max(100),
  roleId: z.string().trim().min(1).max(100).optional(),
  profileId: z.string().trim().min(1).max(100).optional(),
  agentId: z.string().trim().min(1).max(100).optional(),
  prompt: z.string().trim().max(10_000).optional(),
  requiresApproval: z.boolean().optional(),
}).refine(step => Boolean(step.roleId || step.profileId || step.agentId), 'A pipeline step needs a roleId, profileId, or agentId.');

const pipelineSchema = z.object({
  steps: z.array(pipelineStepSchema).min(1).max(20),
});

const createTaskSchema = z.object({
  repo: z.string().trim().min(1),
  baseRef: z.string().trim().min(1),
  title: z.string().trim().min(1),
  objective: z.string().optional(),
  recipe: z.string().optional(),
  worktreePath: z.string().optional(),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  baseCommit: z.string().trim().optional(),
  roleId: z.string().trim().min(1).optional(),
  teamId: z.string().trim().min(1).optional(),
  pipeline: pipelineSchema.optional(),
});

const createRunSchema = z.object({
  agentId: z.string().trim().min(1),
  roleId: z.string().trim().min(1).optional(),
});

const acceptRunSchema = z.object({
  files: z.array(z.string().trim().min(1).max(4_096)).min(1).max(1_000).optional(),
});

const roleTemplateInstantiateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  baseAgentId: z.string().trim().min(1).max(100).optional(),
  profileId: z.string().trim().min(1).max(100).regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
});

const roleTestSchema = z.object({
  objective: z.string().trim().max(2_000).optional(),
});

const executeParallelSchema = z.object({
  maxConcurrency: z.number().int().min(1).max(8).optional(),
});

const policyEvaluateSchema = z.object({
  allowedTools: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  blockedTools: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  approvalMode: z.enum(['auto', 'human', 'strict']).default('human'),
});

const customAgentSchema = z.object({
  name: z.string().trim().min(1),
  launchCommand: z.string().trim().min(1),
});

export type KernelAppOptions = {
  /** Bearer token for /api/* (health stays exempt). Omit to leave routes open in tests. */
  authToken?: string;
  /** Test seam for POST /api/runs/:id/execute; production uses the real runtime executor. */
  runner?: CodexProcessRunner;
  /** Directory holding the custom agent catalog (agents.conf). Omit to run with no custom agents. */
  dataDirectory?: string;
  /**
   * Register health/doctor/runtime diagnostics. Default true (standalone kernel
   * daemon). A webapp-enabled host already owns those routes, so it mounts the
   * kernel task/run surface with `diagnostics: false` instead of shadowing.
   */
  diagnostics?: boolean;
};

/** Maps KernelStore's Error messages onto HTTP status codes instead of always returning 500. */
function errorResponse(context: Context, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('was not found')) return context.json({ error: message }, 404);
  if (message.includes('not part of run') || message.includes('Select at least one changed file') || message.includes('invalid worktree path')) {
    return context.json({ error: message }, 400);
  }
  if (message.includes('is disabled')) return context.json({ error: message }, 400);
  if (message.includes('is not assigned to a Team') || message.includes('produced an empty plan')) {
    return context.json({ error: message }, 400);
  }
  if (message.includes('cannot be') || message.includes('no worktree') || message.includes('nothing is awaiting approval') || message.includes('can only be applied') || message.includes('parallel execution starts from')) {
    return context.json({ error: message }, 409);
  }
  return context.json({ error: message }, 500);
}

/**
 * A Role may point at an existing Profile or carry its own baseAgentId. Resolve the effective
 * binding here so API validation and RoleResolver cannot disagree about which Agent will run.
 */
async function validateRoleBinding(
  store: KernelStore,
  input: CreateRoleInput | UpdateRoleInput,
  existing?: AgentRole,
): Promise<{ baseAgentId?: string; profileId?: string; error?: string }> {
  const profileId = input.profileId ?? existing?.profileId;
  // Switching to a Profile should let that Profile's base agent win; keeping the old base agent
  // here would turn every Profile change into a false mismatch.
  const baseAgentId = input.baseAgentId ?? (input.profileId ? undefined : existing?.baseAgentId);
  const profile = profileId ? await store.profiles.getProfile(profileId) : null;

  if (profileId && !profile) return { profileId, baseAgentId, error: `Profile "${profileId}" was not found.` };
  if (profile && baseAgentId && baseAgentId !== profile.baseAgentId) {
    return {
      profileId,
      baseAgentId,
      error: `Role baseAgentId "${baseAgentId}" conflicts with Profile "${profile.id}" (${profile.baseAgentId}).`,
    };
  }
  const effectiveBaseAgentId = profile?.baseAgentId ?? baseAgentId;
  if (!effectiveBaseAgentId) return { profileId, baseAgentId, error: 'A Role must name a baseAgentId or reference a profileId.' };
  if (!isAgentExecutable(effectiveBaseAgentId)) {
    return {
      profileId,
      baseAgentId: effectiveBaseAgentId,
      error: `Base agent "${effectiveBaseAgentId}" is not verified. Roles can only bind verified agents in this version.`,
    };
  }
  return { profileId, baseAgentId: effectiveBaseAgentId };
}

export function createKernelApp(store: KernelStore, options: KernelAppOptions = {}): Hono {
  const app = new Hono();

  if (options.authToken) app.use('/api/*', createTokenAuthMiddleware(options.authToken));

  // Diagnostics double as the kernel's standalone surface. A webapp-enabled
  // daemon already owns health/doctor/runtime, so it mounts task/run only.
  if (options.diagnostics !== false) {
    app.get('/api/health', (c) => c.json({ service: 'agent-ops-daemon', status: 'ok' }));

    const customAgents: CustomAgentInput[] = options.dataDirectory ? loadCustomAgents(options.dataDirectory) : [];
    const discoverRuntimes = () => discoverAgentRuntimes(customAgents);

    app.get('/api/doctor', async (c) => c.json({ report: await runDoctor() }));

    app.get('/api/runtime/probe', (c) => c.json({ probe: probeCodexRuntime() }));

  app.get('/api/runtime/probe/:agentId', async (c) => {
    const agentId = c.req.param('agentId');
    const catalog = await discoverRuntimes();
    const agent = catalog.find(a => a.id === agentId);
    if (!agent) return c.json({ error: 'Agent not found in catalog.' }, 404);
    return c.json({
      probe: await probeAgentCapabilities(agent.id, agent.launchCommand),
      adapterStatus: getAgentAdapterStatus(agent.id),
    });
  });

  app.get('/api/runtime/catalog', async (c) =>
    c.json({
      agents: (await discoverRuntimes()).map(agent => ({ ...agent, adapterStatus: getAgentAdapterStatus(agent.id) })),
    }),
  );

  app.post('/api/runtime/catalog', async (c) => {
    const parsed = customAgentSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Custom Agent requires a name and launchCommand.' }, 400);
    if (customAgents.some(agent => agent.name.toLowerCase() === parsed.data.name.toLowerCase())) {
      return c.json({ error: 'An Agent with this name already exists.' }, 409);
    }
    customAgents.push(parsed.data);
    if (options.dataDirectory) saveCustomAgents(options.dataDirectory, customAgents);
    const agent = (await discoverRuntimes()).at(-1);
    return c.json({ agent: agent ? { ...agent, adapterStatus: getAgentAdapterStatus(agent.id) } : agent }, 201);
  });

  app.get('/api/runtime/profiles', async (c) => c.json({ profiles: await store.profiles.listProfiles() }));

  app.get('/api/runtime/profiles/:profileId', async (c) => {
    const profile = await store.profiles.getProfile(c.req.param('profileId'));
    if (!profile) return c.json({ error: 'Profile not found.' }, 404);
    return c.json({ profile });
  });

  app.post('/api/runtime/profiles', async (c) => {
    const parsed = agentProfileCreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid profile input.', details: parsed.error.flatten() }, 400);
    if (!isAgentExecutable(parsed.data.baseAgentId)) {
      return c.json({ error: `Base agent "${parsed.data.baseAgentId}" is not verified. Profiles can only be based on verified agents.` }, 400);
    }
    const { profile, validation } = await store.profiles.createProfile(parsed.data, {
      verifyBaseAgent: id => isAgentExecutable(id),
    });
    if (!validation.valid) return c.json({ error: 'Profile validation failed.', details: validation.errors }, 400);
    return c.json({ profile }, 201);
  });

  app.put('/api/runtime/profiles/:profileId', async (c) => {
    const parsed = agentProfileUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid profile update.', details: parsed.error.flatten() }, 400);
    const profileId = c.req.param('profileId');
    const existing = await store.profiles.getProfile(profileId);
    if (!existing) return c.json({ error: 'Profile not found.' }, 404);
    const { profile, validation } = await store.profiles.updateProfile(profileId, parsed.data);
    if (!validation.valid) return c.json({ error: 'Profile validation failed.', details: validation.errors }, 400);
    return c.json({ profile });
  });

  app.delete('/api/runtime/profiles/:profileId', async (c) => {
    const profileId = c.req.param('profileId');
    const deleted = await store.profiles.deleteProfile(profileId);
    if (!deleted) return c.json({ error: 'Profile not found.' }, 404);
    return c.json({ deleted: true });
  });
  }

  app.get('/api/roles', async (c) => c.json({ roles: await store.roles.listRoles() }));

  app.get('/api/roles/:roleId/resolve', async (c) => {
    const role = await store.roles.getRole(c.req.param('roleId'));
    if (!role) return c.json({ error: 'Role not found.' }, 404);
    return c.json({
      resolution: await resolveRoleRuntime(role, {
        getProfile: id => store.profiles.getProfile(id),
      }),
    });
  });

  app.get('/api/roles/:roleId', async (c) => {
    const role = await store.roles.getRole(c.req.param('roleId'));
    return role ? c.json({ role }) : c.json({ error: 'Role not found.' }, 404);
  });

  app.post('/api/roles/:roleId/test', async (c) => {
    const parsed = roleTestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'Invalid role test input.', details: parsed.error.flatten() }, 400);
    const plan = await store.testRolePlan(c.req.param('roleId'), parsed.data);
    return plan ? c.json({ plan }) : c.json({ error: 'Role not found.' }, 404);
  });

  app.post('/api/roles', async (c) => {
    const parsed = agentRoleCreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid role input.', details: parsed.error.flatten() }, 400);
    const binding = await validateRoleBinding(store, parsed.data);
    if (binding.error) return c.json({ error: binding.error }, 400);
    try {
      const role = await store.roles.createRole({
        ...parsed.data,
        baseAgentId: binding.baseAgentId,
      });
      return c.json({ role }, 201);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.put('/api/roles/:roleId', async (c) => {
    const parsed = agentRoleUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid role update.', details: parsed.error.flatten() }, 400);
    const roleId = c.req.param('roleId');
    const existing = await store.roles.getRole(roleId);
    if (!existing) return c.json({ error: 'Role not found.' }, 404);
    const binding = await validateRoleBinding(store, parsed.data, existing);
    if (binding.error) return c.json({ error: binding.error }, 400);
    try {
      const role = await store.roles.updateRole(roleId, {
        ...parsed.data,
        baseAgentId: binding.baseAgentId,
      });
      return role ? c.json({ role }) : c.json({ error: 'Role not found.' }, 404);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.delete('/api/roles/:roleId', async (c) => {
    const deleted = await store.roles.deleteRole(c.req.param('roleId'));
    return deleted ? c.json({ deleted: true }) : c.json({ error: 'Role not found.' }, 404);
  });

  app.get('/api/role-templates', (c) => c.json({ templates: roleTemplates }));

  app.post('/api/role-templates/:templateId', async (c) => {
    const template = getRoleTemplate(c.req.param('templateId'));
    if (!template) return c.json({ error: 'Role template not found.' }, 404);
    const parsed = roleTemplateInstantiateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'Invalid role template input.', details: parsed.error.flatten() }, 400);
    const binding = await validateRoleBinding(store, {
      baseAgentId: parsed.data.baseAgentId ?? (parsed.data.profileId ? undefined : template.baseAgentId),
      profileId: parsed.data.profileId,
    });
    if (binding.error) return c.json({ error: binding.error }, 400);
    try {
      const role = await store.roles.createRole({
        name: parsed.data.name ?? template.name,
        description: parsed.data.description ?? template.description,
        baseAgentId: binding.baseAgentId,
        profileId: binding.profileId,
        systemPrompt: template.systemPrompt,
        acceptanceCriteria: template.acceptanceCriteria,
        runtimePolicy: template.runtimePolicy,
        enabled: true,
      });
      return c.json({ role, templateId: template.id }, 201);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.get('/api/teams', async (c) => c.json({ teams: await store.teams.listTeams() }));

  app.get('/api/teams/:teamId', async (c) => {
    const team = await store.teams.getTeam(c.req.param('teamId'));
    return team ? c.json({ team }) : c.json({ error: 'Team not found.' }, 404);
  });

  app.post('/api/teams', async (c) => {
    const parsed = agentTeamCreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid team input.', details: parsed.error.flatten() }, 400);
    try {
      const team = await store.teams.createTeam(parsed.data);
      return c.json({ team }, 201);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.put('/api/teams/:teamId', async (c) => {
    const parsed = agentTeamUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid team update.', details: parsed.error.flatten() }, 400);
    const teamId = c.req.param('teamId');
    if (!(await store.teams.getTeam(teamId))) return c.json({ error: 'Team not found.' }, 404);
    try {
      const team = await store.teams.updateTeam(teamId, parsed.data);
      return team ? c.json({ team }) : c.json({ error: 'Team not found.' }, 404);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.delete('/api/teams/:teamId', async (c) => {
    const deleted = await store.teams.deleteTeam(c.req.param('teamId'));
    return deleted ? c.json({ deleted: true }) : c.json({ error: 'Team not found.' }, 404);
  });

  app.get('/api/audit', (c) => {
    const taskId = c.req.query('taskId')?.trim() || undefined;
    const teamId = c.req.query('teamId')?.trim() || undefined;
    const type = c.req.query('type')?.trim() || undefined;
    const parsedLimit = Number(c.req.query('limit') ?? '');
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined;
    return c.json({
      events: store.listAudit({
        taskId,
        teamId,
        type: type as KernelAuditEventType | undefined,
        limit,
      }),
    });
  });

  app.post('/api/policy/evaluate', async (c) => {
    const parsed = policyEvaluateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'Invalid policy input.', details: parsed.error.flatten() }, 400);
    const verdicts = runtimeRegistry.list().map(adapter => ({
      runtimeId: adapter.id,
      capability: adapter.capabilities.toolPolicy,
      ...evaluateToolPolicy(parsed.data, adapter.capabilities.toolPolicy),
    }));
    return c.json({ policy: parsed.data, verdicts });
  });

  app.post('/api/tasks', async (c) => {
    const parsed = createTaskSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid task payload.', details: parsed.error.issues }, 400);
    try {
      return c.json(await store.createTask(parsed.data), 201);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.get('/api/tasks', (c) => c.json(store.listTasks()));

  app.get('/api/tasks/:id', (c) => {
    const task = store.getTask(c.req.param('id'));
    return task ? c.json(task) : c.json({ error: `Task ${c.req.param('id')} was not found.` }, 404);
  });

  app.post('/api/tasks/:id/provision', async (c) => {
    try {
      return c.json(await store.provisionTask(c.req.param('id')));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.post('/api/tasks/:id/release', async (c) => {
    try {
      return c.json(await store.releaseTask(c.req.param('id')));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.get('/api/metrics', (c) => {
    const since = c.req.query('since')?.trim() || undefined;
    const until = c.req.query('until')?.trim() || undefined;
    const teamId = c.req.query('teamId')?.trim() || undefined;
    if (since && Number.isNaN(Date.parse(since))) return c.json({ error: 'The since timestamp is not a valid date.' }, 400);
    if (until && Number.isNaN(Date.parse(until))) return c.json({ error: 'The until timestamp is not a valid date.' }, 400);
    return c.json(store.getMetrics({ since, until, teamId }));
  });

  app.get('/api/tasks/:id/pipeline', (c) => {
    const task = store.getTask(c.req.param('id'));
    if (!task) return c.json({ error: `Task ${c.req.param('id')} was not found.` }, 404);
    return task.pipeline ? c.json(task.pipeline) : c.json({ error: `Task ${task.id} has no pipeline.` }, 404);
  });

  app.get('/api/tasks/:id/handoffs', (c) => {
    const taskId = c.req.param('id');
    const task = store.getTask(taskId);
    if (!task) return c.json({ error: `Task ${taskId} was not found.` }, 404);
    return c.json({ handoffs: store.listHandoffs(taskId) });
  });

  app.post('/api/tasks/:id/coordinator/plan', async (c) => {
    const taskId = c.req.param('id');
    try {
      const plan = await store.planTeamPipeline(taskId);
      return plan ? c.json({ plan }) : c.json({ error: `Task ${taskId} was not found.` }, 404);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.post('/api/tasks/:id/coordinator/apply', async (c) => {
    const taskId = c.req.param('id');
    try {
      const pipeline = await store.applyTeamPipeline(taskId);
      return pipeline ? c.json({ pipeline }) : c.json({ error: `Task ${taskId} was not found.` }, 404);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.get('/api/tasks/:id/coordinator', (c) => {
    const taskId = c.req.param('id');
    const summary = store.coordinatorSummary(taskId);
    return summary ? c.json({ summary }) : c.json({ error: `Task ${taskId} was not found.` }, 404);
  });

  app.post('/api/tasks/:id/parallel/execute', async (c) => {
    const parsed = executeParallelSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'Invalid parallel input.', details: parsed.error.flatten() }, 400);
    try {
      return c.json(await store.executeParallelTeam(c.req.param('id'), {
        runner: options.runner,
        maxConcurrency: parsed.data.maxConcurrency,
      }));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.get('/api/tasks/:id/export', (c) => {
    const taskId = c.req.param('id');
    const exported = store.exportTask(taskId);
    if (!exported) return c.json({ error: `Task ${taskId} was not found.` }, 404);
    c.header('content-disposition', `attachment; filename="agent-ops-task-${taskId}.json"`);
    return c.json(exported);
  });

  app.post('/api/tasks/:id/pipeline/execute', async (c) => {
    try {
      return c.json(await store.executeTaskPipeline(c.req.param('id'), options.runner));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.post('/api/tasks/:id/pipeline/retry', async (c) => {
    try {
      return c.json(await store.retryTaskPipeline(c.req.param('id'), options.runner));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.post('/api/tasks/:id/pipeline/approve', async (c) => {
    try {
      return c.json(await store.approvePipelineStep(c.req.param('id'), options.runner));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.post('/api/tasks/:id/pipeline/reject', async (c) => {
    try {
      return c.json(await store.rejectPipelineStep(c.req.param('id')));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.post('/api/tasks/:id/runs', async (c) => {
    const parsed = createRunSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid run payload.', details: parsed.error.issues }, 400);
    try {
      return c.json(await store.createRun(c.req.param('id'), parsed.data.agentId, parsed.data.roleId), 201);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.get('/api/tasks/:id/runs', (c) => {
    const taskId = c.req.param('id');
    return c.json(store.listRuns(taskId).map(run => ({ ...run, handoff: store.getHandoffForRun(run.id) })));
  });

  app.get('/api/runs/:id', (c) => {
    const run = store.getRun(c.req.param('id'));
    if (!run) return c.json({ error: `Run ${c.req.param('id')} was not found.` }, 404);
    return c.json({ ...run, handoff: store.getHandoffForRun(run.id) });
  });

  app.get('/api/runs/:id/events', (c) => {
    const id = c.req.param('id');
    const run = store.getRun(id);
    if (!run) return c.json({ error: `Run ${id} was not found.` }, 404);

    return streamSSE(c, async stream => {
      let closed = false;
      let closing = false;
      let unsubscribe = () => {};
      const isTerminal = (event: RunEvent) =>
        event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled';

      const write = async (event: RunEvent | { runId: string; type: 'done'; at: string }) => {
        if (closed) return;
        try {
          await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
        } catch {
          closed = true;
        }
      };

      const closeStream = async () => {
        if (closing) return;
        closing = true;
        closed = true;
        unsubscribe();
        await stream.close();
      };

      stream.onAbort(() => {
        closed = true;
        unsubscribe();
      });

      const replay = store.getRunEvents(id);
      const seen = new Set(replay.map(event => event.seq));
      for (const event of replay) await write(event);
      if (replay.some(isTerminal)) {
        await closeStream();
        return;
      }
      if (closed) return;

      const accept = async (event: RunEvent) => {
        if (seen.has(event.seq)) return;
        seen.add(event.seq);
        await write(event);
        if (isTerminal(event)) await closeStream();
      };

      // Subscribe before reading the post-replay tail: an event emitted in the gap between
      // replay and subscribe is then either delivered live or found in the tail, never lost.
      unsubscribe = store.subscribeRunEvents(id, event => { void accept(event); });
      for (const event of store.getRunEvents(id)) {
        if (!seen.has(event.seq)) await accept(event);
      }
      if (closed) return;

      // A run that finished before this stream connected has no in-memory events left
      // after a daemon restart; close with an explicit done frame instead of hanging.
      if (run.status !== 'running' && run.status !== 'queued' && replay.length === 0) {
        await write({ runId: id, type: 'done', at: new Date().toISOString() });
        await closeStream();
        return;
      }

      await new Promise<void>(resolve => stream.onAbort(resolve));
    });
  });

  app.post('/api/runs/:id/cancel', async (c) => {
    try {
      return c.json(await store.cancelRun(c.req.param('id')));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.post('/api/runs/:id/execute', async (c) => {
    try {
      return c.json(await store.executeRun(c.req.param('id'), options.runner));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.post('/api/runs/:id/accept', async (c) => {
    try {
      const raw = await c.req.text().catch(() => '');
      if (!raw.trim()) return c.json(await store.acceptRun(c.req.param('id')));
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return c.json({ error: 'Invalid accept payload.' }, 400);
      }
      const parsed = acceptRunSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: 'Invalid accept payload.', details: parsed.error.issues }, 400);
      }
      return c.json(await store.acceptRun(c.req.param('id'), parsed.data.files));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.post('/api/runs/:id/reject', async (c) => {
    try {
      return c.json(await store.rejectRun(c.req.param('id')));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  return app;
}
