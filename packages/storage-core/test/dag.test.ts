import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { KernelStore } from '../src/index.js';
import type { CodexProcessRunner } from '@agent-ops/agent-runtime';

const execFileAsync = promisify(execFile);

async function initRepo(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  await execFileAsync('git', ['init', '-q'], { cwd: dir });
  await execFileAsync('git', ['branch', '-M', 'main'], { cwd: dir });
  await writeFile(join(dir, 'README.md'), '# repo\n', 'utf8');
  await execFileAsync('git', ['add', '-A'], { cwd: dir });
  await execFileAsync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

const success = (output = 'ok') => ({
  exitCode: 0,
  signal: null,
  timedOut: false,
  output,
  startedAt: new Date(Date.now() - 5).toISOString(),
  completedAt: new Date().toISOString(),
});

const exists = (path: string) => access(path).then(() => true).catch(() => false);

describe('KernelStore DAG pipeline', () => {
  it('runs ready steps in parallel and merges every dependency into a join', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-dag-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const left = await store.roles.createRole({ name: 'Left', baseAgentId: 'codex' });
      const right = await store.roles.createRole({ name: 'Right', baseAgentId: 'codex' });
      const joinRole = await store.roles.createRole({ name: 'Join', baseAgentId: 'codex' });
      const task = await store.createTask({
        repo,
        baseRef: 'main',
        title: 'DAG',
        pipeline: {
          steps: [
            { id: 'left', name: 'Left', roleId: left.id, dependsOn: [] },
            { id: 'right', name: 'Right', roleId: right.id, dependsOn: [] },
            { id: 'join', name: 'Join', roleId: joinRole.id, dependsOn: ['left', 'right'], prompt: 'Use {{step:left.output}}.' },
          ],
        },
      });
      await store.provisionTask(task.id);

      let active = 0;
      let maxActive = 0;
      const observed: Record<string, { right: boolean; left: boolean; prompt: string }> = {};
      const runner: CodexProcessRunner = async (_command, arguments_, options) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, 10));
        active--;
        const stepId = basename(options.cwd);
        if (stepId === 'left') {
          await writeFile(join(options.cwd, 'LEFT.md'), 'left\n', 'utf8');
          await writeFile(join(options.cwd, 'SHARED.md'), 'left\n', 'utf8');
        } else if (stepId === 'right') {
          await writeFile(join(options.cwd, 'RIGHT.md'), 'right\n', 'utf8');
        } else {
          observed[stepId] = {
            right: await exists(join(options.cwd, 'RIGHT.md')),
            left: await exists(join(options.cwd, 'LEFT.md')),
            prompt: arguments_[arguments_.length - 1] ?? '',
          };
          await writeFile(join(options.cwd, 'JOIN.md'), 'join\n', 'utf8');
        }
        return stepId === 'left' ? success('L'.repeat(2500)) : success();
      };

      const result = await store.executeDagPipeline(task.id, { runner, maxConcurrency: 2 });
      expect(result.steps.map(step => step.status)).toEqual(['completed', 'completed', 'completed']);
      expect(maxActive).toBe(2);
      // The join merges both dependency commits, so files from both sides are present.
      expect(observed.join).toMatchObject({ right: true, left: true });
      expect(result.steps[0]?.output).toHaveLength(2000);
      expect(result.steps[0]?.outputTruncated).toBe(true);
      expect(observed.join?.prompt).toContain('[The output above was truncated to 2000 characters.]');
      expect(result.warnings.join(' ')).not.toContain('not merged');
      expect(result.conflicts).toEqual([]);
      expect(result.taskStatus).toBe('review');
      expect(store.getTask(task.id)?.pipeline?.results.map(entry => entry.status)).toEqual(['completed', 'completed', 'completed']);
      expect(store.listAudit({ taskId: task.id }).map(event => event.type)).toContain('pipeline.dag.executed');

      const commits = result.steps.map(step => step.commitSha);
      expect(new Set(commits).size).toBe(3);
      for (const step of result.steps) await execFileAsync('git', ['cat-file', '-e', `${step.commitSha}^{commit}`], { cwd: repo });
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('fails a join whose dependency commits conflict and names the conflicting files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-dag-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await store.createTask({
        repo,
        baseRef: 'main',
        title: 'DAG conflict',
        pipeline: {
          steps: [
            { id: 'left', name: 'Left', agentId: 'codex', dependsOn: [] },
            { id: 'right', name: 'Right', agentId: 'codex', dependsOn: [] },
            { id: 'join', name: 'Join', agentId: 'codex', dependsOn: ['left', 'right'] },
          ],
        },
      });
      await store.provisionTask(task.id);

      const runner: CodexProcessRunner = async (_command, _arguments, options) => {
        const stepId = basename(options.cwd);
        if (stepId !== 'join') {
          await writeFile(join(options.cwd, 'SHARED.md'), `${stepId}\n`, 'utf8');
        } else {
          await writeFile(join(options.cwd, 'JOIN.md'), 'join\n', 'utf8');
        }
        return success();
      };

      const result = await store.executeDagPipeline(task.id, { runner, maxConcurrency: 2 });
      expect(result.steps.map(step => [step.stepId, step.status])).toEqual([
        ['left', 'completed'],
        ['right', 'completed'],
        ['join', 'failed'],
      ]);
      expect(result.steps[2]?.error).toContain('merge conflict');
      expect(result.steps[2]?.error).toContain('SHARED.md');
      expect(result.conflicts.map(conflict => ({ file: conflict.file, stepIds: [...conflict.stepIds].sort() })))
        .toEqual([{ file: 'SHARED.md', stepIds: ['left', 'right'] }]);
      expect(store.getTask(task.id)?.pipeline?.results[2]).toMatchObject({ stepId: 'join', status: 'failed' });
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('skips dependents of a failed step without blocking the rest of the DAG', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-dag-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await store.createTask({
        repo,
        baseRef: 'main',
        title: 'DAG failure',
        pipeline: {
          steps: [
            { id: 'root', name: 'Root', agentId: 'codex', dependsOn: [] },
            { id: 'other', name: 'Other', agentId: 'codex', dependsOn: [] },
            { id: 'child', name: 'Child', agentId: 'codex', dependsOn: ['root'] },
          ],
        },
      });
      await store.provisionTask(task.id);

      const calls: string[] = [];
      const runner: CodexProcessRunner = async (_command, _arguments, options) => {
        const stepId = basename(options.cwd);
        calls.push(stepId);
        if (stepId === 'root') return { ...success('boom'), exitCode: 1 };
        await writeFile(join(options.cwd, `${stepId.toUpperCase()}.md`), 'ok\n', 'utf8');
        return success();
      };

      const result = await store.executeDagPipeline(task.id, { runner, maxConcurrency: 2 });
      expect(result.steps.map(step => [step.stepId, step.status])).toEqual([
        ['root', 'failed'],
        ['other', 'completed'],
        ['child', 'skipped'],
      ]);
      expect(result.steps[2]?.error).toContain('root');
      expect(calls.sort()).toEqual(['other', 'root']);
      expect(result.taskStatus).toBe('review');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('refuses cyclic or unknown dependencies', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-dag-'));
    try {
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      await expect(store.createTask({
        repo: '/r',
        baseRef: 'main',
        title: 'Cycle',
        pipeline: {
          steps: [
            { id: 'a', name: 'A', agentId: 'codex', dependsOn: ['b'] },
            { id: 'b', name: 'B', agentId: 'codex', dependsOn: ['a'] },
          ],
        },
      })).rejects.toThrow('cycle');

      await expect(store.createTask({
        repo: '/r',
        baseRef: 'main',
        title: 'Ghost',
        pipeline: { steps: [{ id: 'a', name: 'A', agentId: 'codex', dependsOn: ['ghost'] }] },
      })).rejects.toThrow('unknown step');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
});

describe('KernelStore DAG step templates', () => {
  it('expands the last dependency output when a join step runs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-dag-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await store.createTask({
        repo,
        baseRef: 'main',
        title: 'DAG template',
        pipeline: {
          steps: [
            { id: 'left', name: 'Left', agentId: 'codex', dependsOn: [], prompt: 'Do the left side.' },
            { id: 'join', name: 'Join', agentId: 'codex', dependsOn: ['left'], prompt: 'Join after {{previous.output}} at {{step:left.commit}}' },
          ],
        },
      });
      await store.provisionTask(task.id);

      const prompts: string[] = [];
      const runner: CodexProcessRunner = async (_command, arguments_, options) => {
        const prompt = arguments_[arguments_.length - 1] ?? '';
        prompts.push(prompt);
        if (basename(options.cwd) === 'left') {
          await writeFile(join(options.cwd, 'LEFT.md'), 'left\n', 'utf8');
          return success('Left finished.');
        }
        await writeFile(join(options.cwd, 'JOIN.md'), 'join\n', 'utf8');
        return success('joined');
      };

      const result = await store.executeDagPipeline(task.id, { runner });
      const left = result.steps.find(step => step.stepId === 'left');
      expect(result.steps.map(step => step.status)).toEqual(['completed', 'completed']);
      expect(prompts[1]).toContain('Join after Left finished.');
      expect(prompts[1]).not.toContain('{{previous.output}}');
      expect(prompts[1]).toContain(`at ${left?.commitSha}`);
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
});

describe('KernelStore DAG approval gate', () => {
  it('pauses at a gated step and resumes the remaining DAG after approval', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-dag-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await store.createTask({
        repo,
        baseRef: 'main',
        title: 'DAG gate',
        pipeline: {
          steps: [
            { id: 'draft', name: 'Draft', agentId: 'codex', dependsOn: [] },
            { id: 'review', name: 'Review', agentId: 'codex', dependsOn: ['draft'], requiresApproval: true, prompt: 'Review {{previous.output}}' },
            { id: 'publish', name: 'Publish', agentId: 'codex', dependsOn: ['review'], prompt: 'Publish {{previous.output}}' },
          ],
        },
      });
      await store.provisionTask(task.id);

      const calls: string[] = [];
      const prompts: Record<string, string> = {};
      const runner: CodexProcessRunner = async (_command, arguments_, options) => {
        const stepId = basename(options.cwd);
        calls.push(stepId);
        prompts[stepId] = arguments_[arguments_.length - 1] ?? '';
        await writeFile(join(options.cwd, `${stepId.toUpperCase()}.md`), `${stepId}\n`, 'utf8');
        return success(`${stepId} output`);
      };

      const paused = await store.executeDagPipeline(task.id, { runner, maxConcurrency: 2 });
      expect(paused.steps.map(step => [step.stepId, step.status])).toEqual([
        ['draft', 'completed'],
        ['review', 'awaiting_approval'],
      ]);
      expect(paused.taskStatus).toBe('running');
      expect(calls).toEqual(['draft', 'review']);
      expect(prompts.review).toContain('Review draft output');
      const stored = store.getTask(task.id)?.pipeline;
      expect(stored).toMatchObject({ status: 'awaiting_approval', executionMode: 'dag', maxConcurrency: 2 });
      expect(stored?.results.map(result => result.status)).toEqual(['completed', 'awaiting_approval']);
      const gatedRun = store.getRun(paused.steps[1]?.runId ?? '');
      expect(gatedRun?.status).toBe('review');
      expect(gatedRun?.worktreePath).toContain(join('dag', 'review'));

      const resumed = await store.approvePipelineStep(task.id, runner);
      expect(resumed.status).toBe('completed');
      expect(resumed.results.map(result => result.status)).toEqual(['completed', 'completed', 'completed']);
      expect(resumed.results[1]?.commitSha).toBeTruthy();
      expect(calls).toEqual(['draft', 'review', 'publish']);
      expect(prompts.publish).toContain('Publish review output');
      expect(store.getRun(paused.steps[1]?.runId ?? '')?.status).toBe('done');
      const auditTypes = store.listAudit({ taskId: task.id }).map(event => event.type);
      expect(auditTypes).toContain('pipeline.dag.paused');
      expect(auditTypes).toContain('pipeline.dag.resumed');
      expect(auditTypes).toContain('pipeline.dag.executed');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('runs one gated step at a time and pauses again at the next gate', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-dag-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await store.createTask({
        repo,
        baseRef: 'main',
        title: 'Two gates',
        pipeline: {
          steps: [
            { id: 'gate1', name: 'Gate one', agentId: 'codex', dependsOn: [], requiresApproval: true },
            { id: 'gate2', name: 'Gate two', agentId: 'codex', dependsOn: [], requiresApproval: true },
          ],
        },
      });
      await store.provisionTask(task.id);

      const calls: string[] = [];
      const runner: CodexProcessRunner = async (_command, _arguments, options) => {
        const stepId = basename(options.cwd);
        calls.push(stepId);
        await writeFile(join(options.cwd, `${stepId.toUpperCase()}.md`), 'x\n', 'utf8');
        return success(`${stepId} output`);
      };

      const first = await store.executeDagPipeline(task.id, { runner, maxConcurrency: 2 });
      expect(first.steps.map(step => [step.stepId, step.status])).toEqual([['gate1', 'awaiting_approval']]);
      expect(calls).toEqual(['gate1']);

      const second = await store.approvePipelineStep(task.id, runner);
      expect(second.status).toBe('awaiting_approval');
      expect(second.results.map(result => [result.stepId, result.status])).toEqual([
        ['gate1', 'completed'],
        ['gate2', 'awaiting_approval'],
      ]);
      expect(calls).toEqual(['gate1', 'gate2']);

      const final = await store.approvePipelineStep(task.id, runner);
      expect(final.status).toBe('completed');
      expect(final.results.map(result => result.status)).toEqual(['completed', 'completed']);
      const audits = store.listAudit({ taskId: task.id }).map(event => event.type);
      expect(audits.filter(type => type === 'pipeline.dag.paused')).toHaveLength(2);
      expect(audits.filter(type => type === 'pipeline.dag.resumed')).toHaveLength(2);
      expect(audits.filter(type => type === 'pipeline.dag.executed')).toHaveLength(1);
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('fails the gated step and downstream steps when the operator rejects it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-dag-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await store.createTask({
        repo,
        baseRef: 'main',
        title: 'DAG reject',
        pipeline: {
          steps: [
            { id: 'draft', name: 'Draft', agentId: 'codex', dependsOn: [] },
            { id: 'gate', name: 'Gate', agentId: 'codex', dependsOn: ['draft'], requiresApproval: true },
            { id: 'after', name: 'After', agentId: 'codex', dependsOn: ['gate'] },
          ],
        },
      });
      await store.provisionTask(task.id);

      const calls: string[] = [];
      const runner: CodexProcessRunner = async (_command, _arguments, options) => {
        calls.push(basename(options.cwd));
        await writeFile(join(options.cwd, `${basename(options.cwd).toUpperCase()}.md`), 'x\n', 'utf8');
        return success();
      };

      await store.executeDagPipeline(task.id, { runner });
      expect(calls).toEqual(['draft', 'gate']);
      const rejected = await store.rejectPipelineStep(task.id);
      expect(rejected.status).toBe('failed');
      expect(rejected.results.map(result => [result.stepId, result.status])).toEqual([
        ['draft', 'completed'],
        ['gate', 'failed'],
        ['after', 'failed'],
      ]);
      expect(rejected.results[1]?.error).toContain('Rejected by operator');
      expect(store.getTask(task.id)?.status).toBe('failed');
      expect(store.listAudit({ taskId: task.id }).map(event => event.type)).toContain('pipeline.step.rejected');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
});
