import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { KernelStore } from '@agent-ops/storage-core';
import type { CodexProcessRunner } from '@agent-ops/agent-runtime';
import { createTokenAuthMiddleware } from './auth.js';

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

export type KernelAppOptions = {
  /** Bearer token for /api/* (health stays exempt). Omit to leave routes open in tests. */
  authToken?: string;
  /** Test seam for POST /api/runs/:id/execute; production uses the real runtime executor. */
  runner?: CodexProcessRunner;
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

  app.get('/api/health', (c) => c.json({ service: 'agent-ops-daemon', status: 'ok' }));

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
