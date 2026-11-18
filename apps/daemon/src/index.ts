import { serve } from '@hono/node-server';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, parse } from 'node:path';
import { KernelStore } from '@agent-ops/storage-core';
import { createKernelApp, loadOrCreateDaemonToken } from '@agent-ops/server-core';

// The daemon is now the kernel control plane first. It serves the Task/Run API
// from @agent-ops/server-core by default; the webapp-delivery vertical (Project/
// Blueprint/Apply/Release + cloud providers) is an optional layer enabled with
// AGENT_OPS_ENABLE_WEBAPP=1, and is loaded lazily so the kernel never imports it
// on the default path. createDaemonApp stays re-exported for the CLI's tests.

export { createDaemonApp } from '@agent-ops/delivery-server';

export type StartDaemonOptions = {
  port?: number;
  databasePath?: string;
};

// The database must resolve to the same file whether the daemon is launched from the repository root
// or through `npm run -w @agent-ops/daemon dev`, which sets cwd to the package directory. Anchoring on
// cwd created two separate databases and silently split project state between them.
export function resolveWorkspaceRoot(startDirectory: string): string {
  const { root } = parse(startDirectory);
  let current = startDirectory;
  while (true) {
    const manifestPath = join(current, 'package.json');
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { workspaces?: unknown };
        if (manifest.workspaces !== undefined) return current;
      } catch {
        // An unreadable manifest is not the root we are looking for; keep walking up.
      }
    }
    if (current === root) return startDirectory;
    current = dirname(current);
  }
}

export async function startDaemon(options: StartDaemonOptions = {}) {
  const port = options.port ?? Number(process.env.AGENT_OPS_PORT ?? 3737);
  const databasePath =
    options.databasePath ??
    process.env.AGENT_OPS_DATABASE_PATH ??
    join(resolveWorkspaceRoot(process.cwd()), '.agent-ops', 'agent-ops.sqlite');

  // Optional webapp-delivery vertical: delegate to its full daemon. Loaded lazily
  // so the kernel control plane does not pull provider-*/blueprint on this path.
  if (process.env.AGENT_OPS_ENABLE_WEBAPP === '1') {
    const { startDaemon: startWebappDaemon } = await import('@agent-ops/delivery-server');
    return startWebappDaemon(options);
  }

  const store = await KernelStore.open(databasePath);
  const authToken = loadOrCreateDaemonToken();
  const app = createKernelApp(store, { authToken, dataDirectory: dirname(databasePath) });
  // Loopback only, on purpose: the API is unauthenticated beyond the bearer token.
  const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
  });

  return {
    app,
    port,
    databasePath,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
      await store.close();
    },
  };
}
