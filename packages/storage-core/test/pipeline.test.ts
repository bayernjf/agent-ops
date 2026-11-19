import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  startedAt: new Date(Date.now() - 10).toISOString(),
  completedAt: new Date().toISOString(),
});

describe('KernelStore pipeline', () => {
  it('persists pipeline steps and assigns generated ids', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-pipeline-'));
    try {
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const role = await store.roles.createRole({ name: 'Builder', baseAgentId: 'codex' });
      const task = await store.createTask({
        repo: '/r',
        baseRef: 'main',
        title: 'T',
        pipeline: { steps: [{ name: 'Architect', roleId: role.id }, { name: 'Implementer', agentId: 'codex' }] },
      });
      expect(task.pipeline?.status).toBe('idle');
      expect(task.pipeline?.steps.map(step => step.id)).toEqual(['step-1', 'step-2']);
      expect(task.pipeline?.results).toEqual([]);
      await store.close();

      const reopened = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      expect(reopened.getTask(task.id)?.pipeline?.steps[1]?.name).toBe('Implementer');
      await reopened.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('runs each step serially and commits before the next step', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-pipeline-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const architect = await store.roles.createRole({ name: 'Architect', baseAgentId: 'codex' });
      const implementer = await store.roles.createRole({ name: 'Implementer', baseAgentId: 'codex' });
      const task = await store.createTask({
        repo,
        baseRef: 'main',
        title: 'Pipeline task',
        objective: 'Build the feature.',
        pipeline: {
          steps: [
            { id: 'architecture', name: 'Architect', roleId: architect.id, prompt: 'Write the architecture.' },
            { id: 'implementation', name: 'Implement', roleId: implementer.id, prompt: 'Implement the architecture.' },
          ],
        },
      });
      const provisioned = await store.provisionTask(task.id);

      const prompts: string[] = [];
      const runner: CodexProcessRunner = async (_command, arguments_, options) => {
        const prompt = arguments_[arguments_.length - 1] ?? '';
        prompts.push(prompt);
        if (prompt.includes('Pipeline step 1/2')) {
          await writeFile(join(options.cwd, 'ARCH.md'), '# architecture\n', 'utf8');
        } else {
          await access(join(options.cwd, 'ARCH.md'));
          await writeFile(join(options.cwd, 'IMPL.md'), '# implementation\n', 'utf8');
        }
        return success();
      };

      const pipeline = await store.executeTaskPipeline(task.id, runner);
      expect(pipeline.status).toBe('completed');
      expect(pipeline.results.map(result => result.status)).toEqual(['completed', 'completed']);
      expect(pipeline.results[0]?.commitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(pipeline.results[1]?.commitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(pipeline.results[0]?.commitSha).not.toBe(pipeline.results[1]?.commitSha);
      expect(prompts[0]).toContain('Pipeline step 1/2: Architect');
      expect(prompts[1]).toContain('Pipeline step 2/2: Implement');

      const runs = store.listRuns(task.id);
      expect(runs).toHaveLength(2);
      expect(runs[0]?.roleId).toBe(architect.id);
      expect(runs[1]?.roleId).toBe(implementer.id);
      expect(store.getTask(task.id)?.status).toBe('done');
      expect(store.getTask(task.id)?.pipeline?.status).toBe('completed');

      const count = (await execFileAsync('git', ['rev-list', '--count', 'HEAD'], { cwd: provisioned.worktreePath })).stdout.trim();
      expect(count).toBe('3');
      expect((await execFileAsync('git', ['status', '--porcelain'], { cwd: provisioned.worktreePath })).stdout.trim()).toBe('');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('stops the pipeline when a step fails and does not start the next step', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-pipeline-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await store.createTask({
        repo,
        baseRef: 'main',
        title: 'Failing pipeline',
        pipeline: {
          steps: [
            { id: 'first', name: 'First', agentId: 'codex' },
            { id: 'second', name: 'Second', agentId: 'codex' },
          ],
        },
      });
      await store.provisionTask(task.id);

      let calls = 0;
      const pipeline = await store.executeTaskPipeline(task.id, async () => {
        calls++;
        return { ...success('boom'), exitCode: 1 };
      });
      expect(calls).toBe(1);
      expect(pipeline.status).toBe('failed');
      expect(pipeline.results).toHaveLength(1);
      expect(pipeline.results[0]).toMatchObject({ stepId: 'first', status: 'failed' });
      expect(pipeline.results[0]?.error).toContain('Run ended in failed');
      expect(store.listRuns(task.id)).toHaveLength(1);
      expect(store.getTask(task.id)?.status).toBe('failed');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
});
