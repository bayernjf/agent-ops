import { execFile } from 'node:child_process';
import { lstat, readlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const GIT_IDENTITY = [
  '-c', 'user.name=Agent-Dev Local',
  '-c', 'user.email=agent-ops@localhost',
];

const SECRET_PATH = /(^|\/)\.env($|\.)/;

export class UnsafeCommitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeCommitError';
  }
}

export type CommitWorktreeResult = {
  sha: string;
  committed: boolean;
};

async function headSha(worktreePath: string): Promise<string> {
  const result = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath });
  return result.stdout.trim();
}

/**
 * Stage and commit all changes in a task worktree, refusing the two classes of change that
 * cannot be undone by a later fix: secrets and symlinks that point outside the workspace.
 *
 * The caller only invokes this after a run reached `review`. A refusal leaves the run in review
 * so a human can inspect and discard the unsafe change instead of silently accepting it.
 */
export async function commitWorktreeChanges(
  worktreePath: string,
  message: string,
): Promise<CommitWorktreeResult> {
  await execFileAsync('git', ['add', '-A'], { cwd: worktreePath });
  const staged = await execFileAsync('git', ['diff', '--cached', '--name-only', '-z'], {
    cwd: worktreePath,
  });
  const paths = staged.stdout.split('\0').filter(Boolean);
  if (paths.length === 0) {
    return { sha: await headSha(worktreePath), committed: false };
  }

  const secrets = paths.filter((path) => SECRET_PATH.test(path) && !path.endsWith('.env.example'));
  if (secrets.length > 0) {
    await execFileAsync('git', ['reset', '-q'], { cwd: worktreePath });
    throw new UnsafeCommitError(
      `Agent changes were not committed: ${secrets.join(', ')} would enter the repository. ` +
        'Add it to .gitignore in the workspace, then retry.',
    );
  }

  const externalLinks: string[] = [];
  for (const path of paths) {
    const stats = await lstat(join(worktreePath, path)).catch(() => null);
    if (!stats?.isSymbolicLink()) continue;
    const target = await readlink(join(worktreePath, path));
    const resolved = resolve(worktreePath, target);
    const offset = relative(worktreePath, resolved);
    if (offset.startsWith('..') || isAbsolute(offset)) externalLinks.push(path);
  }
  if (externalLinks.length > 0) {
    await execFileAsync('git', ['reset', '-q'], { cwd: worktreePath });
    throw new UnsafeCommitError(
      `Agent changes were not committed: ${externalLinks.join(', ')} ` +
        `${externalLinks.length === 1 ? 'is a symbolic link' : 'are symbolic links'} outside the workspace. ` +
        'Remove the link in the workspace, then retry.',
    );
  }

  await execFileAsync('git', [...GIT_IDENTITY, 'commit', '-q', '-m', message], {
    cwd: worktreePath,
  });
  return { sha: await headSha(worktreePath), committed: true };
}

/**
 * Refuse to remove a worktree that still holds uncommitted changes. Without this guard,
 * `git worktree remove --force` is a one-command way to lose an agent's unaccepted work.
 */
export async function assertWorktreeClean(worktreePath: string): Promise<void> {
  const status = await execFileAsync('git', ['status', '--porcelain'], { cwd: worktreePath });
  if (status.stdout.trim()) {
    throw new Error(
      `Worktree ${worktreePath} has uncommitted changes. Accept or discard them before releasing the task.`,
    );
  }
}

/**
 * Reset a rejected worktree back to the commit it was provisioned from, including untracked
 * and ignored files. The worktree is isolated, so a hard reset cannot touch the user's main
 * checkout or another task.
 */
export async function resetWorktree(worktreePath: string, baseCommit?: string): Promise<void> {
  await execFileAsync('git', ['reset', '--hard', baseCommit || 'HEAD'], { cwd: worktreePath });
  await execFileAsync('git', ['clean', '-fdx'], { cwd: worktreePath });
}
