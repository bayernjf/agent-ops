import { describe, expect, it } from 'vitest';
import { renderAsync } from './render';
import { I18nProvider } from '../src/i18n/i18n';
import { LaneCard, LanesView } from '../src/views/LanesView';
import type { KernelRun, KernelTask, KernelTaskState } from '../src/types';

const task = (id: string, patch: Partial<KernelTask> = {}): KernelTask => ({
  id,
  repo: '/tmp/repo',
  baseRef: 'dev',
  worktreePath: '',
  recipe: '',
  title: id,
  objective: '',
  status: 'running',
  createdAt: '2026-11-21T00:00:00.000Z',
  updatedAt: '2026-11-21T00:00:00.000Z',
  ...patch,
});

const run = (id: string, status: KernelTaskState, patch: Partial<KernelRun> = {}): KernelRun => ({
  id,
  taskId: 'task-1',
  agentId: 'codebuddy',
  status,
  diffStat: '',
  createdAt: '2026-11-21T00:00:00.000Z',
  updatedAt: '2026-11-21T00:00:00.000Z',
  ...patch,
});

const renderLane = (runData: KernelRun, focused = false, live = '') =>
  renderAsync(
    <I18nProvider>
      <LaneCard
        run={runData}
        task={task('Implement login', { repo: '/tmp/repo' })}
        live={live}
        now={0}
        busy={false}
        focused={focused}
        onOpenBoard={() => undefined}
        onRunAction={() => undefined}
      />
    </I18nProvider>,
  );

describe('Lane card', () => {
  it('renders the lane header with agent, role, repo and the running gate', async () => {
    const html = await renderLane(
      run('run-1', 'running', { roleId: 'reviewer', inputTokens: 2000, outputTokens: 2000, laneId: 'lane-1' }),
    );

    expect(html).toContain('codebuddy');
    expect(html).toContain('Role');
    expect(html).toContain('reviewer');
    expect(html).toContain('/tmp/repo');
    expect(html).toContain('lane-1');
    expect(html).toContain('Running');
    expect(html).toContain('Duration');
    expect(html).toContain('Tokens');
    expect(html).toContain('4000');
    // A running lane offers only the cancel gate, never accept/reject.
    expect(html).toContain('Cancel');
    expect(html).not.toContain('Accept');
    expect(html).not.toContain('Reject');
    // The header jumps back to the board (PRD D6).
    expect(html).toContain('Open in board');
  });

  it('offers accept/reject instead of cancel for a review lane', async () => {
    const html = await renderLane(run('run-2', 'review'));

    expect(html).toContain('Review');
    expect(html).toContain('Accept');
    expect(html).toContain('Reject');
    expect(html).not.toContain('Cancel');
  });

  it('renders the token fill proportionally to the temporary 8000 cap', async () => {
    const html = await renderLane(run('run-3', 'running', { inputTokens: 2000, outputTokens: 2000 }));

    // (2000 + 2000) / 8000 = 50%.
    expect(html).toContain('width:50%');
  });

  it('shows the waiting placeholder when a lane has no output yet', async () => {
    const html = await renderLane(run('run-4', 'running'));

    expect(html).toContain('Waiting for output');
    // No usage reported means no token gauge: an empty track would be misleading.
    expect(html).not.toContain('lane-token-track');
  });

  it('accumulates live output into the stream pane', async () => {
    const html = await renderLane(run('run-5', 'running'), false, 'npm run build\n> ok');

    expect(html).toContain('npm run build');
  });

  it('marks the focused lane with the highlight class', async () => {
    const plain = await renderLane(run('run-6', 'running'));
    const focused = await renderLane(run('run-6', 'running'), true);

    expect(plain).not.toContain('lane-focused');
    expect(focused).toContain('lane-focused');
  });
});

describe('Lanes view shell', () => {
  it('mounts the lane region with its title and the loading state', async () => {
    const html = await renderAsync(
      <I18nProvider>
        <LanesView tasks={[task('active task', { status: 'running' })]} onOpenBoard={() => undefined} />
      </I18nProvider>,
    );

    expect(html).toContain('Execution lanes');
    expect(html).toContain('Loading lanes');
  });
});
