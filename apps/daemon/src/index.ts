// The daemon app is a thin mount layer over the webapp-delivery server plugin.
// All routes, startup logic and helpers live in @agent-ops/delivery-server so
// the daemon no longer imports blueprint/provider-*/deployment-composer
// directly (see AGENTS.md 分层边界). The public API (startDaemon,
// createDaemonApp, resolveWorkspaceRoot) is preserved for @agent-ops/cli.
export * from '@agent-ops/delivery-server';
