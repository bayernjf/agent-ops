import { execFile } from 'node:child_process';
import { access, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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

/**
 * A `node_modules` directory is normally ignored by `.gitignore`, but the linked entry is a
 * symlink and some patterns only match directories. Add a plain `node_modules` rule to the
 * repository's shared `info/exclude` so no run reports the link as a changed file.
 */
async function ensureNodeModulesExcluded(repo: string): Promise<void> {
  try {
    // `--git-common-dir` prints a relative path in older invocations; ask for the absolute one.
    const { stdout } = await execFileAsync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: repo });
    const excludePath = join(stdout.trim(), 'info', 'exclude');
    await mkdir(dirname(excludePath), { recursive: true });
    let current = '';
    try {
      current = await readFile(excludePath, 'utf8');
    } catch {
      // No exclude file yet.
    }
    if (current.split(/\r?\n/).some(line => line.trim() === 'node_modules')) return;
    await writeFile(excludePath, `${current}${current && !current.endsWith('\n') ? '\n' : ''}node_modules\n`, 'utf8');
  } catch {
    // Best effort: a missing rule only means the link shows up as an untracked file.
  }
}

/**
 * Give a fresh worktree the repository's installed dependencies instead of paying a second
 * `npm install` per task. Only the root `node_modules` is symlinked: third-party packages come
 * from there, while `@agent-ops/*` imports still resolve through the worktree's own config
 * (vitest aliases are computed from the worktree's paths). Best-effort by design — a repository
 * without installed dependencies, or a worktree that already has its own, makes this a no-op.
 * Set `AGENT_OPS_LINK_NODE_MODULES=0` to opt out.
 */
export async function linkNodeModules(repo: string, worktreePath: string): Promise<boolean> {
  if (process.env.AGENT_OPS_LINK_NODE_MODULES === '0') return false;
  const source = join(repo, 'node_modules');
  try {
    await access(source);
  } catch {
    return false;
  }
  await ensureNodeModulesExcluded(repo);
  const target = join(worktreePath, 'node_modules');
  try {
    await access(target);
    return false;
  } catch {
    // Nothing is there yet; linking is safe.
  }
  try {
    await symlink(await realpath(source), target, 'dir');
    return true;
  } catch {
    return false;
  }
}

/**
 * Keep an accepted detached-HEAD commit reachable after its worktree is removed. Without a
 * ref, the commit is only a loose object and can be pruned by `git gc`. A parallel lane pins
 * under its own ref so accepting a second lane cannot overwrite the first.
 */
export async function pinWorktreeCommit(repo: string, taskId: string, sha: string, laneId?: string): Promise<void> {
  const ref = laneId ? `refs/agent-ops/tasks/${taskId}/lanes/${laneId}` : `refs/agent-ops/tasks/${taskId}`;
  await execFileAsync('git', ['update-ref', ref, sha], { cwd: repo });
}
