import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { KernelStore, RunEvent } from '@agent-ops/storage-core';
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
} from '@agent-ops/agent-runtime';
import { createTokenAuthMiddleware } from './auth.js';
import { loadCustomAgents, saveCustomAgents } from './agent-catalog.js';

export { daemonTokenPath, loadOrCreateDaemonToken, createTokenAuthMiddleware } from './auth.js';

// The kernel HTTP control plane: the Task/Run API that turns KernelStore (the core data
// layer) into a callable service. It has zero dependency on the webapp-delivery plugin,
// so a daemon can serve this surface without mounting Project/Blueprint/Apply/Release.

const createTaskSchema = z.object({
  repo: z.string().trim().min(1),
  baseRef: z.string().trim().min(1),
  title: z.string().trim().min(1),
  objective: z.string().optional(),
  recipe: z.string().optional(),
  worktreePath: z.string().optional(),
});

const createRunSchema = z.object({
  agentId: z.string().trim().min(1),
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
  if (message.includes('cannot be') || message.includes('no worktree')) {
    return context.json({ error: message }, 409);
  }
  return context.json({ error: message }, 500);
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

  app.post('/api/tasks/:id/runs', async (c) => {
    const parsed = createRunSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid run payload.', details: parsed.error.issues }, 400);
    try {
      return c.json(await store.createRun(c.req.param('id'), parsed.data.agentId), 201);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.get('/api/tasks/:id/runs', (c) => c.json(store.listRuns(c.req.param('id'))));

  app.get('/api/runs/:id', (c) => {
    const run = store.getRun(c.req.param('id'));
    return run ? c.json(run) : c.json({ error: `Run ${c.req.param('id')} was not found.` }, 404);
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
      return c.json(await store.acceptRun(c.req.param('id')));
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
