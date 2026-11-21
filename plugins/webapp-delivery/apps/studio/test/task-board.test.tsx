import { describe, expect, it } from 'vitest';
import { renderAsync } from './render';
import { I18nProvider } from '../src/i18n/i18n';
import { TaskBoard } from '../src/views/TaskBoard';
import type { KernelTask, KernelTaskState } from '../src/types';

const task = (id: string, status: KernelTaskState, patch: Partial<KernelTask> = {}): KernelTask => ({
  id,
  repo: '/tmp/repo',
  baseRef: 'dev',
  worktreePath: '',
  recipe: '',
  title: id,
  objective: '',
  status,
  createdAt: '2026-11-21T00:00:00.000Z',
  updatedAt: '2026-11-21T00:00:00.000Z',
  ...patch,
});

describe('Task board', () => {
  it('renders one column per kernel task state with the matching cards', async () => {
    const tasks = [
      task('queued task', 'queued'),
      task('running task', 'running', { teamId: 'alpha-team' }),
      task('review task', 'review', {
        pipeline: {
          steps: [{ id: 'step-1', name: 'Implement' }],
          results: [{ stepId: 'step-1', status: 'awaiting_approval' }],
          status: 'awaiting_approval',
        },
      }),
      task('done task', 'done', { roleId: 'reviewer' }),
      task('failed task', 'failed'),
      task('cancelled task', 'cancelled'),
    ];

    const html = await renderAsync(
      <I18nProvider>
        <TaskBoard tasks={tasks} loading={false} onOpenTask={() => undefined} />
      </I18nProvider>,
    );

    for (const state of ['Queued', 'Running', 'Review', 'Done', 'Failed', 'Cancelled']) {
      expect(html).toContain(state);
    }
    expect(html).toContain('queued task');
    expect(html).toContain('running task');
    expect(html).toContain('review task');
    expect(html).toContain('Awaiting approval');
    expect(html).toContain('alpha-team');
    expect(html).toContain('reviewer');
    expect(html).toContain('Open in list');
  });

  it('shows the loading state before task data arrives', async () => {
    const html = await renderAsync(
      <I18nProvider>
        <TaskBoard tasks={[]} loading onOpenTask={() => undefined} />
      </I18nProvider>,
    );

    expect(html).toContain('Loading tasks');
    expect(html).not.toContain('task-board-column');
  });
});
