import { writeFile } from 'node:fs/promises';

export type ExportTotals = {
  runs?: number;
  acceptedCommits?: number;
  changedFiles?: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
  durationMs?: number;
};

export type ExportCommandDeps = {
  daemonBaseUrl: string;
  authToken?: string;
  fetchImpl?: typeof fetch;
  writeFileImpl?: typeof writeFile;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
};

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  // Round before splitting, or 359.96s prints as "5m 60.0s" instead of "6m 0.0s".
  const rounded = Math.round(seconds * 10) / 10;
  const minutes = Math.floor(rounded / 60);
  return `${minutes}m ${(rounded - minutes * 60).toFixed(1)}s`;
}

export function formatSummary(doc: {
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

/** Run `agent-ops export` against a daemon without reading process.argv. */
export async function runExportCommand(argv: string[], deps: ExportCommandDeps): Promise<number> {
  const stdout = deps.stdout ?? console.log;
  const stderr = deps.stderr ?? console.error;
  const taskId = argv[0];
  if (!taskId || taskId.startsWith('--')) {
    stderr('Usage: agent-ops export <taskId> [--summary] [--out <file>]');
    return 1;
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const response = await fetchImpl(`${deps.daemonBaseUrl}/api/tasks/${encodeURIComponent(taskId)}/export`, {
    headers: deps.authToken ? { authorization: `Bearer ${deps.authToken}` } : {},
  });
  const body = await response.text();
  if (!response.ok) {
    stderr(body);
    return 1;
  }

  const summary = argv.includes('--summary');
  const outIndex = argv.indexOf('--out');
  const outPath = outIndex >= 0 ? argv[outIndex + 1] : undefined;
  const output = summary ? formatSummary(JSON.parse(body)) : body;
  if (outPath) {
    await (deps.writeFileImpl ?? writeFile)(outPath, output.endsWith('\n') ? output : `${output}\n`, 'utf8');
    stdout(JSON.stringify({ written: outPath, bytes: Buffer.byteLength(output, 'utf8') }, null, 2));
    return 0;
  }
  stdout(output);
  return 0;
}
