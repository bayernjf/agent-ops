import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { KernelStore } from '../src/index.js';

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

describe('KernelStore task deletion', () => {
  it('deletes a task without runs and removes its worktree', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-delete-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await store.createTask({ repo, baseRef: 'main', title: 'Probe' });
      const provisioned = await store.provisionTask(task.id);
      expect(existsSync(provisioned.worktreePath)).toBe(true);

      expect(await store.deleteTask(task.id)).toBe(true);
      expect(store.getTask(task.id)).toBeUndefined();
      expect(existsSync(provisioned.worktreePath)).toBe(false);
      expect(await store.deleteTask(task.id)).toBe(false);
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('refuses to delete a task that already has runs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-delete-'));
    try {
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await store.createTask({ repo: '/tmp/repo', baseRef: 'main', title: 'With a run' });
      await store.createRun(task.id, 'codex');
      await expect(store.deleteTask(task.id)).rejects.toThrow(/only a task without runs can be deleted/i);
      expect(store.getTask(task.id)?.title).toBe('With a run');
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
});
