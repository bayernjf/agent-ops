import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runConnectorPreflight } from '@agent-ops/policy';
import { startDaemon } from '@agent-ops/daemon';
import { runExportCommand } from './export-command.js';

type Check = {
  command: string;
  available: boolean;
  version: string | null;
};

const commands = ['git', 'node', 'npm', 'gh', 'vercel', 'wrangler', 'supabase', 'codex'] as const;

function checkCommand(command: (typeof commands)[number]): Check {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  return {
    command,
    available: !result.error && result.status === 0,
    version: output ? output.split('\n')[0] : null,
  };
}

async function main() {
  const command = process.argv[2];
  if (command === 'doctor') {
    const checks = commands.map(checkCommand);
    const connectors = await runConnectorPreflight();
    console.log(JSON.stringify({
      checks,
      connectors,
      ready: checks.every(check => check.available) && connectors.readyForAccountDiscovery,
    }, null, 2));
    return;
  }

  if (command === 'start') {
    const { port, databasePath } = await startDaemon();
    console.log(JSON.stringify({ status: 'running', port, databasePath }, null, 2));
    return;
  }

  if (command === 'mcp') {
    const { runAgentOpsMcp } = await import('./mcp.js');
    await runAgentOpsMcp();
    return;
  }

  if (command === 'export') {
    const daemonBaseUrl = process.env.AGENT_OPS_DAEMON_URL ?? 'http://127.0.0.1:3737';
    const tokenPath = process.env.AGENT_OPS_DAEMON_TOKEN_PATH ?? join(homedir(), '.agent-ops', 'daemon-token');
    const authToken = process.env.AGENT_OPS_DAEMON_TOKEN ?? (existsSync(tokenPath) ? readFileSync(tokenPath, 'utf8').trim() : '');
    process.exitCode = await runExportCommand(process.argv.slice(3), {
      daemonBaseUrl,
      authToken,
      stdout: console.log,
      stderr: console.error,
    });
    return;
  }

  console.log('Usage: agent-ops <doctor|start|mcp|export>');
  process.exitCode = 1;
}

void main();
