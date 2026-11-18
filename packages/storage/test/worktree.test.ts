import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { AgentDevStore } from '../src/index.js';
import { addWorktree, removeWorktree } from '../src/worktree.js';

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

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('worktree', () => {
  it('attaches and removes a detached worktree on a real repo', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-worktree-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const worktreePath = join(directory, 'wt');

      const result = await addWorktree(repo, 'main', worktreePath);
      expect(result.headCommit).toMatch(/^[0-9a-f]{40}$/);
      await expect(exists(join(worktreePath, 'README.md'))).resolves.toBe(true);

      await removeWorktree(repo, worktreePath);
      await expect(exists(worktreePath)).resolves.toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
});

describe('AgentDevStore task provisioning', () => {
  it('provisions a task worktree and releases it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-provision-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await AgentDevStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await store.createTask({ repo, baseRef: 'main', title: 'Rename bin' });

      const provisioned = await store.provisionTask(task.id);
      expect(provisioned.worktreePath).toContain('tasks');
      await expect(exists(join(provisioned.worktreePath, 'README.md'))).resolves.toBe(true);

      // Provisioning twice is idempotent and does not create a second checkout.
      const again = await store.provisionTask(task.id);
      expect(again.worktreePath).toBe(provisioned.worktreePath);

      const released = await store.releaseTask(task.id);
      expect(released.worktreePath).toBe('');
      await expect(exists(provisioned.worktreePath)).resolves.toBe(false);
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
});
