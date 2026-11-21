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

  it('retries a failed step from the previous commit without rerunning completed steps', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-pipeline-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await store.createTask({
        repo,
        baseRef: 'main',
        title: 'Retry pipeline',
        pipeline: {
          steps: [
            { id: 'first', name: 'First', agentId: 'codex' },
            { id: 'second', name: 'Second', agentId: 'codex' },
            { id: 'third', name: 'Third', agentId: 'codex' },
          ],
        },
      });
      const provisioned = await store.provisionTask(task.id);

      let firstCalls = 0;
      let secondCalls = 0;
      let sawFirstFile = false;
      let sawFailedFile = false;
      const runner: CodexProcessRunner = async (_command, arguments_, options) => {
        const prompt = arguments_[arguments_.length - 1] ?? '';
        if (prompt.includes('Pipeline step 1/3')) {
          firstCalls++;
          await writeFile(join(options.cwd, 'FIRST.md'), 'first\n', 'utf8');
        } else if (prompt.includes('Pipeline step 2/3')) {
          secondCalls++;
          if (secondCalls === 1) {
            await writeFile(join(options.cwd, 'FAILED.md'), 'failed\n', 'utf8');
            return { ...success('boom'), exitCode: 1 };
          }
          sawFirstFile = await access(join(options.cwd, 'FIRST.md')).then(() => true).catch(() => false);
          sawFailedFile = await access(join(options.cwd, 'FAILED.md')).then(() => true).catch(() => false);
          await writeFile(join(options.cwd, 'SECOND.md'), 'second\n', 'utf8');
        } else {
          await access(join(options.cwd, 'SECOND.md'));
          await writeFile(join(options.cwd, 'THIRD.md'), 'third\n', 'utf8');
        }
        return success();
      };

      const failed = await store.executeTaskPipeline(task.id, runner);
      expect(failed.status).toBe('failed');
      expect(failed.results.map(result => result.status)).toEqual(['completed', 'failed']);
      const firstCommit = failed.results[0]?.commitSha;
      expect(firstCommit).toMatch(/^[0-9a-f]{40}$/);
      expect((await execFileAsync('git', ['status', '--porcelain'], { cwd: provisioned.worktreePath })).stdout).toContain('FAILED.md');

      const retried = await store.retryTaskPipeline(task.id, runner);
      expect(retried.status).toBe('completed');
      expect(retried.results.map(result => result.status)).toEqual(['completed', 'completed', 'completed']);
      expect(retried.results[0]?.commitSha).toBe(firstCommit);
      expect(firstCalls).toBe(1);
      expect(secondCalls).toBe(2);
      expect(sawFirstFile).toBe(true);
      expect(sawFailedFile).toBe(false);
      expect(store.listRuns(task.id)).toHaveLength(4);
      expect(store.getTask(task.id)?.status).toBe('done');

      const count = (await execFileAsync('git', ['rev-list', '--count', 'HEAD'], { cwd: provisioned.worktreePath })).stdout.trim();
      expect(count).toBe('4');
      expect((await execFileAsync('git', ['status', '--porcelain'], { cwd: provisioned.worktreePath })).stdout.trim()).toBe('');
      expect((await execFileAsync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: provisioned.worktreePath })).stdout).toContain('THIRD.md');
      await expect(store.retryTaskPipeline(task.id)).rejects.toThrow('cannot be retried');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('keeps completed step commits when a later approval is rejected', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-pipeline-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await store.createTask({
        repo,
        baseRef: 'main',
        title: 'Reject after a completed step',
        pipeline: {
          steps: [
            { id: 'first', name: 'First', agentId: 'codex' },
            { id: 'gated', name: 'Gated', agentId: 'codex', requiresApproval: true },
          ],
        },
      });
      const provisioned = await store.provisionTask(task.id);

      let calls = 0;
      const paused = await store.executeTaskPipeline(task.id, async (_command, _arguments, options) => {
        calls++;
        await writeFile(join(options.cwd, `STEP-${calls}.md`), `step ${calls}\n`, 'utf8');
        return success();
      });
      expect(paused.status).toBe('awaiting_approval');
      const firstCommit = paused.results[0]?.commitSha;
      expect(firstCommit).toMatch(/^[0-9a-f]{40}$/);

      const rejected = await store.rejectPipelineStep(task.id);
      expect(rejected.status).toBe('failed');
      expect(rejected.results[0]).toMatchObject({ stepId: 'first', status: 'completed', commitSha: firstCommit });
      expect(rejected.results[1]).toMatchObject({ stepId: 'gated', status: 'failed' });
      expect((await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: provisioned.worktreePath })).stdout.trim()).toBe(firstCommit);
      expect(await access(join(provisioned.worktreePath, 'STEP-1.md')).then(() => true).catch(() => false)).toBe(true);
      expect(await access(join(provisioned.worktreePath, 'STEP-2.md')).then(() => true).catch(() => false)).toBe(false);
      expect((await execFileAsync('git', ['rev-list', '--count', 'HEAD'], { cwd: provisioned.worktreePath })).stdout.trim()).toBe('2');
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

  it('pauses at a step that requires approval and resumes it after approval', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-pipeline-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await store.createTask({
        repo,
        baseRef: 'main',
        title: 'Approval pipeline',
        pipeline: {
          steps: [
            { id: 'gated', name: 'Gated', agentId: 'codex', requiresApproval: true },
            { id: 'tail', name: 'Tail', agentId: 'codex' },
          ],
        },
      });
      const provisioned = await store.provisionTask(task.id);

      let calls = 0;
      const runner: CodexProcessRunner = async (_command, _arguments, options) => {
        calls++;
        await writeFile(join(options.cwd, `STEP-${calls}.md`), `step ${calls}\n`, 'utf8');
        return success();
      };

      const paused = await store.executeTaskPipeline(task.id, runner);
      expect(calls).toBe(1);
      expect(paused.status).toBe('awaiting_approval');
      expect(paused.results[0]).toMatchObject({ stepId: 'gated', status: 'awaiting_approval' });
      expect(paused.results[0]?.runId).toBeTruthy();
      expect(paused.results[0]?.commitSha).toBeUndefined();
      expect(store.getTask(task.id)?.status).toBe('review');
      const gatedRun = store.getRun(paused.results[0]?.runId ?? '');
      expect(gatedRun?.status).toBe('review');

      const resumed = await store.approvePipelineStep(task.id, runner);
      expect(calls).toBe(2);
      expect(resumed.status).toBe('completed');
      expect(resumed.results.map(result => result.status)).toEqual(['completed', 'completed']);
      expect(resumed.results[0]?.commitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(resumed.results[1]?.commitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(resumed.results[0]?.commitSha).not.toBe(resumed.results[1]?.commitSha);
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

  it('rejects a gated step, resets the worktree and stops the pipeline', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-pipeline-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await store.createTask({
        repo,
        baseRef: 'main',
        title: 'Rejected pipeline',
        pipeline: {
          steps: [
            { id: 'gated', name: 'Gated', agentId: 'codex', requiresApproval: true },
            { id: 'tail', name: 'Tail', agentId: 'codex' },
          ],
        },
      });
      const provisioned = await store.provisionTask(task.id);
      let calls = 0;
      const paused = await store.executeTaskPipeline(task.id, async (_command, _arguments, options) => {
        calls++;
        await writeFile(join(options.cwd, 'REJECTED.md'), 'step\n', 'utf8');
        return success();
      });
      expect(paused.status).toBe('awaiting_approval');

      const rejected = await store.rejectPipelineStep(task.id);
      expect(calls).toBe(1);
      expect(rejected.status).toBe('failed');
      expect(rejected.results[0]).toMatchObject({ stepId: 'gated', status: 'failed' });
      expect(rejected.results[0]?.error).toContain('Rejected');
      expect(rejected.results[1]).toBeUndefined();
      expect(store.getTask(task.id)?.status).toBe('failed');
      expect(store.listRuns(task.id)).toHaveLength(1);
      // Reject resets the worktree, so the rejected step leaves no uncommitted file.
      expect((await execFileAsync('git', ['status', '--porcelain'], { cwd: provisioned.worktreePath })).stdout.trim()).toBe('');
      expect((await execFileAsync('git', ['rev-list', '--count', 'HEAD'], { cwd: provisioned.worktreePath })).stdout.trim()).toBe('1');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('refuses pipeline gates when nothing is awaiting approval', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-pipeline-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await store.createTask({
        repo,
        baseRef: 'main',
        title: 'Idle pipeline',
        pipeline: { steps: [{ id: 'only', name: 'Only', agentId: 'codex' }] },
      });
      await expect(store.approvePipelineStep(task.id)).rejects.toThrow('nothing is awaiting approval');
      await expect(store.rejectPipelineStep(task.id)).rejects.toThrow('nothing is awaiting approval');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('runs a four-step pipeline with a mid-chain approval gate and commits every step', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-pipeline-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const architect = await store.roles.createRole({ name: 'Architect', baseAgentId: 'codex' });
      const implementer = await store.roles.createRole({ name: 'Implementer', baseAgentId: 'codex' });
      const reviewer = await store.roles.createRole({ name: 'Reviewer', baseAgentId: 'codex' });
      const verifier = await store.roles.createRole({ name: 'Verifier', baseAgentId: 'codex' });
      const task = await store.createTask({
        repo,
        baseRef: 'main',
        title: 'Four-step pipeline',
        objective: 'Ship the feature.',
        acceptanceCriteria: ['Feature works', 'Tests pass'],
        priority: 'high',
        pipeline: {
          steps: [
            { id: 'plan', name: 'Plan', roleId: architect.id, prompt: 'Draft the plan.' },
            { id: 'implement', name: 'Implement', roleId: implementer.id, prompt: 'Implement the plan.', requiresApproval: true },
            { id: 'review', name: 'Review', roleId: reviewer.id, prompt: 'Review the implementation.' },
            { id: 'verify', name: 'Verify', roleId: verifier.id, prompt: 'Verify the result.' },
          ],
        },
      });
      const provisioned = await store.provisionTask(task.id);

      const prompts: string[] = [];
      const runner: CodexProcessRunner = async (_command, arguments_, options) => {
        const prompt = arguments_[arguments_.length - 1] ?? '';
        prompts.push(prompt);
        if (prompt.includes('Pipeline step 1/4')) {
          await writeFile(join(options.cwd, 'PLAN.md'), '# plan\n', 'utf8');
        } else if (prompt.includes('Pipeline step 2/4')) {
          await access(join(options.cwd, 'PLAN.md'));
          await writeFile(join(options.cwd, 'IMPL.md'), '# impl\n', 'utf8');
        } else if (prompt.includes('Pipeline step 3/4')) {
          await access(join(options.cwd, 'IMPL.md'));
          await writeFile(join(options.cwd, 'REVIEW.md'), '# review\n', 'utf8');
        } else {
          await access(join(options.cwd, 'REVIEW.md'));
          await writeFile(join(options.cwd, 'VERIFY.md'), '# verify\n', 'utf8');
        }
        return success();
      };

      const paused = await store.executeTaskPipeline(task.id, runner);
      expect(prompts).toHaveLength(2);
      expect(paused.status).toBe('awaiting_approval');
      expect(paused.results.map(result => result.status)).toEqual(['completed', 'awaiting_approval']);
      expect(paused.results[0]?.commitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(store.getTask(task.id)?.status).toBe('review');

      const resumed = await store.approvePipelineStep(task.id, runner);
      expect(prompts).toHaveLength(4);
      expect(prompts.map(prompt => prompt.match(/Pipeline step \d\/4: \w+/)?.[0])).toEqual([
        'Pipeline step 1/4: Plan',
        'Pipeline step 2/4: Implement',
        'Pipeline step 3/4: Review',
        'Pipeline step 4/4: Verify',
      ]);
      expect(prompts.map(prompt => prompt.match(/Acting Role: (\w+)/)?.[1])).toEqual([
        'Architect',
        'Implementer',
        'Reviewer',
        'Verifier',
      ]);
      expect(resumed.status).toBe('completed');
      expect(resumed.results.map(result => result.status)).toEqual(['completed', 'completed', 'completed', 'completed']);
      const commits = resumed.results.map(result => result.commitSha);
      expect(commits.every(sha => /^[0-9a-f]{40}$/.test(sha ?? ''))).toBe(true);
      expect(new Set(commits).size).toBe(4);
      expect(resumed.results[0]?.commitSha).toBe(paused.results[0]?.commitSha);

      const runs = store.listRuns(task.id);
      expect(runs.map(run => run.roleId)).toEqual([architect.id, implementer.id, reviewer.id, verifier.id]);
      expect(runs.map(run => run.runtimeId)).toEqual(['codex', 'codex', 'codex', 'codex']);
      expect(store.getTask(task.id)?.status).toBe('done');
      expect(store.getTask(task.id)?.pipeline?.status).toBe('completed');

      const count = (await execFileAsync('git', ['rev-list', '--count', 'HEAD'], { cwd: provisioned.worktreePath })).stdout.trim();
      expect(count).toBe('5');
      expect((await execFileAsync('git', ['status', '--porcelain'], { cwd: provisioned.worktreePath })).stdout.trim()).toBe('');
      expect((await execFileAsync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: provisioned.worktreePath })).stdout).toContain('VERIFY.md');

      const handoffs = store.listHandoffs(task.id);
      expect(handoffs).toHaveLength(3);
      const byTarget = new Map(handoffs.map(handoff => [handoff.toStepId, handoff]));
      const stepCommit = (stepId: string) => resumed.results.find(result => result.stepId === stepId)?.commitSha;
      const stepRun = (stepId: string) => resumed.results.find(result => result.stepId === stepId)?.runId;

      expect(byTarget.get('implement')).toMatchObject({
        fromStepId: 'plan',
        fromCommitSha: stepCommit('plan'),
        toRunId: stepRun('implement'),
        teamId: null,
      });
      expect(byTarget.get('implement')?.artifacts).toContain('PLAN.md');
      expect(byTarget.get('review')).toMatchObject({
        fromStepId: 'implement',
        fromCommitSha: stepCommit('implement'),
        toRunId: stepRun('review'),
      });
      expect(byTarget.get('review')?.artifacts).toContain('IMPL.md');
      expect(byTarget.get('verify')).toMatchObject({
        fromStepId: 'review',
        fromCommitSha: stepCommit('review'),
        toRunId: stepRun('verify'),
      });
      expect(byTarget.get('verify')?.artifacts).toContain('REVIEW.md');
      expect(store.getHandoffForRun(stepRun('verify') ?? '')?.fromStepId).toBe('review');
      expect(store.getHandoffForRun(stepRun('plan') ?? '')).toBeNull();
      await store.close();

      const reopened = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      expect(reopened.listHandoffs(task.id)).toHaveLength(3);
      await reopened.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
});

describe('KernelStore pipeline step templates', () => {
  it('expands previous output and commit into the next step prompt', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-pipeline-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await store.createTask({
        repo,
        baseRef: 'main',
        title: 'Template task',
        pipeline: {
          steps: [
            { id: 'architecture', name: 'Architect', agentId: 'codex', prompt: 'Write the architecture.' },
            { id: 'implementation', name: 'Implement', agentId: 'codex', prompt: 'Implement it.\nPlan: {{previous.output}}\nBase: {{previous.commit}}\nAgain: {{step:architecture.commit}}' },
          ],
        },
      });
      await store.provisionTask(task.id);

      const prompts: string[] = [];
      const runner: CodexProcessRunner = async (_command, arguments_) => {
        const prompt = arguments_[arguments_.length - 1] ?? '';
        prompts.push(prompt);
        return success(prompt.includes('Pipeline step 1/2') ? 'Use a queue.' : 'done');
      };

      const pipeline = await store.executeTaskPipeline(task.id, runner);
      expect(pipeline.status).toBe('completed');
      expect(prompts[1]).toContain('Plan: Use a queue.');
      expect(prompts[1]).not.toContain('{{previous.output}}');
      expect(prompts[1]).not.toContain('{{previous.commit}}');
      expect(prompts[1]).not.toContain('{{step:architecture.commit}}');
      expect(prompts[1]).toContain(`Base: ${pipeline.results[0]?.commitSha}`);
      expect(prompts[1]).toContain(`Again: ${pipeline.results[0]?.commitSha}`);
      expect(store.listRuns(task.id)[1]?.instruction).toContain('Plan: Use a queue.');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
});
