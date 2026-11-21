import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { KernelStore } from '../src/index.js';
import { addWorktree, linkNodeModules, removeWorktree } from '../src/worktree.js';

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

describe('KernelStore task provisioning', () => {
  it('provisions a task worktree and releases it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-provision-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await store.createTask({ repo, baseRef: 'main', title: 'Rename bin' });

      const provisioned = await store.provisionTask(task.id);
      expect(provisioned.worktreePath).toContain('tasks');
      expect(provisioned.baseCommit).toMatch(/^[0-9a-f]{40}$/);
      await expect(exists(join(provisioned.worktreePath, 'README.md'))).resolves.toBe(true);

      // Provisioning twice is idempotent and does not create a second checkout.
      const again = await store.provisionTask(task.id);
      expect(again.worktreePath).toBe(provisioned.worktreePath);

      // A dirty worktree cannot be released: --force would discard unaccepted work.
      await writeFile(join(provisioned.worktreePath, 'DIRTY.md'), '# dirty\n', 'utf8');
      await expect(store.releaseTask(task.id)).rejects.toThrow('uncommitted changes');
      await rm(join(provisioned.worktreePath, 'DIRTY.md'), { force: true });

      const released = await store.releaseTask(task.id);
      expect(released.worktreePath).toBe('');
      await expect(exists(provisioned.worktreePath)).resolves.toBe(false);
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('links the repository node_modules into a fresh worktree once', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-worktree-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      await mkdir(join(repo, 'node_modules', 'demo'), { recursive: true });
      await writeFile(join(repo, 'node_modules', 'demo', 'index.js'), 'module.exports = 1;\n', 'utf8');
      const worktreePath = join(directory, 'wt');

      await addWorktree(repo, 'main', worktreePath);
      expect(await linkNodeModules(repo, worktreePath)).toBe(true);
      await expect(exists(join(worktreePath, 'node_modules', 'demo', 'index.js'))).resolves.toBe(true);
      // The link must not look like a change: the shared info/exclude hides it.
      expect((await execFileAsync('git', ['status', '--porcelain'], { cwd: worktreePath })).stdout.trim()).toBe('');
      // A second call must not replace the link.
      expect(await linkNodeModules(repo, worktreePath)).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('skips linking without installed dependencies or when disabled', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-worktree-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      const worktreePath = join(directory, 'wt');
      await addWorktree(repo, 'main', worktreePath);
      expect(await linkNodeModules(repo, worktreePath)).toBe(false);

      await mkdir(join(repo, 'node_modules'), { recursive: true });
      process.env.AGENT_OPS_LINK_NODE_MODULES = '0';
      try {
        expect(await linkNodeModules(repo, worktreePath)).toBe(false);
      } finally {
        delete process.env.AGENT_OPS_LINK_NODE_MODULES;
      }
      await expect(exists(join(worktreePath, 'node_modules'))).resolves.toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('links dependencies when provisioning a task', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-ops-worktree-'));
    try {
      const repo = await initRepo(join(directory, 'repo'));
      await mkdir(join(repo, 'node_modules', 'demo'), { recursive: true });
      await writeFile(join(repo, 'node_modules', 'demo', 'index.js'), 'module.exports = 1;\n', 'utf8');
      const store = await KernelStore.open(join(directory, 'agent-ops.sqlite'));
      const task = await store.createTask({ repo, baseRef: 'main', title: 'Linked task' });
      const provisioned = await store.provisionTask(task.id);
      await expect(exists(join(provisioned.worktreePath, 'node_modules', 'demo', 'index.js'))).resolves.toBe(true);
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
});
