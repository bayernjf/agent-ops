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

type ExportTotals = {
  runs?: number;
  acceptedCommits?: number;
  changedFiles?: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
  durationMs?: number;
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  // Round before splitting, or 359.96s prints as "5m 60.0s" instead of "6m 0.0s".
  const rounded = Math.round(seconds * 10) / 10;
  const minutes = Math.floor(rounded / 60);
  return `${minutes}m ${(rounded - minutes * 60).toFixed(1)}s`;
}

function formatSummary(doc: {
  task?: { title?: string; status?: string };
  totals?: ExportTotals;
  audit?: unknown[];
}): string {
  const totals = doc.totals ?? {};
  const usage = (value: number | null | undefined): string =>
    value === null || value === undefined ? 'not reported' : String(value);
  return [
    `Title: ${doc.task?.title ?? 'unknown'}`,
    `Status: ${doc.task?.status ?? 'unknown'}`,
    `Runs: ${totals.runs ?? 0}`,
    `Accepted commits: ${totals.acceptedCommits ?? 0}`,
    `Changed files: ${totals.changedFiles ?? 0}`,
    `Duration: ${formatDuration(totals.durationMs ?? 0)}`,
    `Cost (USD): ${usage(totals.costUsd)}`,
    `Input tokens: ${usage(totals.inputTokens)}`,
    `Output tokens: ${usage(totals.outputTokens)}`,
    `Audit events: ${doc.audit?.length ?? 0}`,
  ].join('\n');
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
      console.error('Usage: agent-ops export <taskId> [--summary] [--out <file>]');
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
    const summary = process.argv.includes('--summary');
    const outIndex = process.argv.indexOf('--out');
    const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;
    const output = summary ? formatSummary(JSON.parse(body)) : body;
    if (outPath) {
      await writeFile(outPath, output.endsWith('\n') ? output : `${output}\n`, 'utf8');
      console.log(JSON.stringify({ written: outPath, bytes: Buffer.byteLength(output, 'utf8') }, null, 2));
      return;
    }
    console.log(output);
    return;
  }

  console.log('Usage: agent-ops <doctor|start|mcp|export>');
  process.exitCode = 1;
}

void main();
