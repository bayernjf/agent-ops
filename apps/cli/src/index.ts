import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runConnectorPreflight } from '@agent-ops/policy';
import { startDaemon } from '@agent-ops/daemon';

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
    const taskId = process.argv[3];
    if (!taskId || taskId.startsWith('--')) {
      console.error('Usage: agent-ops export <taskId> [--out <file>]');
      process.exitCode = 1;
      return;
    }
    const daemonBaseUrl = process.env.AGENT_OPS_DAEMON_URL ?? 'http://127.0.0.1:3737';
    const tokenPath = process.env.AGENT_OPS_DAEMON_TOKEN_PATH ?? join(homedir(), '.agent-ops', 'daemon-token');
    const authToken = process.env.AGENT_OPS_DAEMON_TOKEN ?? (existsSync(tokenPath) ? readFileSync(tokenPath, 'utf8').trim() : '');
    const response = await fetch(`${daemonBaseUrl}/api/tasks/${encodeURIComponent(taskId)}/export`, {
      headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
    });
    const body = await response.text();
    if (!response.ok) {
      console.error(body);
      process.exitCode = 1;
      return;
    }
    const outIndex = process.argv.indexOf('--out');
    const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;
    if (outPath) {
      await writeFile(outPath, body.endsWith('\n') ? body : `${body}\n`, 'utf8');
      console.log(JSON.stringify({ written: outPath, bytes: Buffer.byteLength(body, 'utf8') }, null, 2));
      return;
    }
    console.log(body);
    return;
  }

  console.log('Usage: agent-ops <doctor|start|mcp|export>');
  process.exitCode = 1;
}

void main();
