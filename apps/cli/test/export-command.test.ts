import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatDuration, formatSummary, runExportCommand } from '../src/export-command.js';

const doc = {
  task: { title: 'Ship', status: 'done' },
  totals: {
    runs: 2,
    acceptedCommits: 1,
    changedFiles: 3,
    inputTokens: 1200,
    outputTokens: 340,
    costUsd: 0.42,
    durationMs: 359_960,
  },
  audit: [{}, {}],
};

const okFetch = async (): Promise<Response> => new Response(JSON.stringify(doc), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

describe('export command', () => {
  it('formats reported totals and rounds duration before splitting minutes', () => {
    expect(formatSummary(doc)).toBe([
      'Title: Ship',
      'Status: done',
      'Runs: 2',
      'Accepted commits: 1',
      'Changed files: 3',
      'Duration: 6m 0.0s',
      'Cost (USD): 0.42',
      'Input tokens: 1200',
      'Output tokens: 340',
      'Audit events: 2',
    ].join('\n'));
    expect(formatDuration(999)).toBe('999ms');
    expect(formatDuration(1000)).toBe('1.0s');
    expect(formatDuration(59_000)).toBe('59.0s');
  });

  it('falls back to zero counts and not-reported usage', () => {
    expect(formatSummary({
      task: {},
      totals: { runs: 0, acceptedCommits: 0, changedFiles: 0, inputTokens: null, outputTokens: null, costUsd: null, durationMs: 0 },
      audit: [],
    })).toBe([
      'Title: unknown',
      'Status: unknown',
      'Runs: 0',
      'Accepted commits: 0',
      'Changed files: 0',
      'Duration: 0ms',
      'Cost (USD): not reported',
      'Input tokens: not reported',
      'Output tokens: not reported',
      'Audit events: 0',
    ].join('\n'));
  });

  it('fetches the export with auth and prints the summary', async () => {
    const calls: string[] = [];
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exit = await runExportCommand(['task-1', '--summary'], {
      daemonBaseUrl: 'http://daemon.test',
      authToken: 'secret',
      fetchImpl: async (input, init) => {
        calls.push(String(input));
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret');
        return okFetch();
      },
      stdout: line => stdout.push(line),
      stderr: line => stderr.push(line),
    });
    expect(exit).toBe(0);
    expect(stderr).toEqual([]);
    expect(calls).toEqual(['http://daemon.test/api/tasks/task-1/export']);
    expect(stdout.join('\n')).toBe(formatSummary(doc));
  });

  it('writes the summary to --out and reports its byte count', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-export-'));
    try {
      const outPath = join(directory, 'summary.txt');
      const stdout: string[] = [];
      const exit = await runExportCommand(['task-1', '--summary', '--out', outPath], {
        daemonBaseUrl: 'http://daemon.test',
        fetchImpl: okFetch,
        stdout: line => stdout.push(line),
      });
      expect(exit).toBe(0);
      expect(await readFile(outPath, 'utf8')).toBe(`${formatSummary(doc)}\n`);
      expect(JSON.parse(stdout.join('\n'))).toMatchObject({
        written: outPath,
        bytes: Buffer.byteLength(formatSummary(doc), 'utf8'),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('prints usage without a task id and returns daemon errors', async () => {
    const usage: string[] = [];
    expect(await runExportCommand([], {
      daemonBaseUrl: 'http://daemon.test',
      stderr: line => usage.push(line),
    })).toBe(1);
    expect(usage.join('\n')).toContain('Usage: agent-ops export <taskId>');

    const daemonError: string[] = [];
    const exit = await runExportCommand(['missing-task'], {
      daemonBaseUrl: 'http://daemon.test',
      fetchImpl: async () => new Response('{"error":"Task missing-task was not found."}', { status: 404 }),
      stderr: line => daemonError.push(line),
    });
    expect(exit).toBe(1);
    expect(daemonError.join('\n')).toContain('Task missing-task was not found.');
  });
});
