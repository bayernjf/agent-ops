import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentDevStore } from '../src/index.js';

describe('AgentDevStore task/run', () => {
  it('persists a task and reopens it with its queued status', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-task-'));
    try {
      const store = await AgentDevStore.open(join(directory, 'agent-ops.sqlite'));
      const created = await store.createTask({
        repo: '/work/repo',
        baseRef: 'main',
        title: 'Rename bin',
        objective: 'Rename the CLI bin to agent-ops.',
        recipe: 'generic',
      });
      await store.close();

      const reopened = await AgentDevStore.open(join(directory, 'agent-ops.sqlite'));
      const task = reopened.getTask(created.id);
      expect(task).toMatchObject({
        repo: '/work/repo',
        baseRef: 'main',
        recipe: 'generic',
        status: 'queued',
      });
      expect(reopened.listTasks()).toHaveLength(1);
      await reopened.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('advances a task status and persists the transition', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-task-'));
    try {
      const store = await AgentDevStore.open(join(directory, 'agent-ops.sqlite'));
      const created = await store.createTask({ repo: '/r', baseRef: 'main', title: 'T' });
      await store.updateTaskStatus(created.id, 'running');
      await store.updateTaskStatus(created.id, 'review');
      await store.close();

      const reopened = await AgentDevStore.open(join(directory, 'agent-ops.sqlite'));
      expect(reopened.getTask(created.id)?.status).toBe('review');
      await reopened.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('creates runs under a task and lists them by task', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-task-'));
    try {
      const store = await AgentDevStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await store.createTask({ repo: '/r', baseRef: 'main', title: 'T' });
      const run = await store.createRun(task.id, 'codex');
      expect(run.status).toBe('queued');
      expect(run.agentId).toBe('codex');

      await store.updateRunStatus(run.id, 'running');
      await store.updateRunStatus(run.id, 'review', '2 files changed, +12 -3');

      const reopened = await AgentDevStore.open(join(directory, 'agent-ops.sqlite'));
      const listed = reopened.listRuns(task.id);
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ status: 'review', diffStat: '2 files changed, +12 -3' });
      await reopened.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('rejects a run for a missing task', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-task-'));
    try {
      const store = await AgentDevStore.open(join(directory, 'agent-ops.sqlite'));
      await expect(store.createRun('missing-task', 'codex')).rejects.toThrow('Task missing-task was not found.');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('throws when updating a missing task or run', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-task-'));
    try {
      const store = await AgentDevStore.open(join(directory, 'agent-ops.sqlite'));
      await expect(store.updateTaskStatus('missing', 'running')).rejects.toThrow('Task missing was not found.');
      await expect(store.updateRunStatus('missing', 'running')).rejects.toThrow('Run missing was not found.');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
});
