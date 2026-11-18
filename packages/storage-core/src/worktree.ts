import { execFile } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type WorktreeResult = {
  path: string;
  headCommit: string;
};

/**
 * Attach an isolated worktree to an existing local repository. The checkout is detached so an
 * agent can commit freely without advancing the branch another checkout may hold.
 */
export async function addWorktree(repo: string, baseRef: string, path: string): Promise<WorktreeResult> {
  await access(repo);
  await mkdir(dirname(path), { recursive: true });
  await execFileAsync('git', ['worktree', 'add', '--detach', path, baseRef], { cwd: repo });
  const headCommit = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: path })).stdout.trim();
  return { path, headCommit };
}

/** Remove a worktree, discarding any uncommitted changes it may still hold. */
export async function removeWorktree(repo: string, path: string): Promise<void> {
  await execFileAsync('git', ['worktree', 'remove', '--force', path], { cwd: repo });
}
