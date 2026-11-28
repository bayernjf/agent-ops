import { useEffect } from 'react';
import { useI18n, type KeyPath } from '../i18n/i18n';
import type { KernelTask, KernelTaskState } from '../types';

export const TASK_BOARD_STATES: KernelTaskState[] = ['queued', 'running', 'review', 'done', 'failed', 'cancelled'];

type TaskBoardProps = {
  tasks: KernelTask[];
  loading: boolean;
  onOpenTask: (task: KernelTask) => void;
  /** A `running` card jumps to Lanes instead of the list (PRD D6). */
  onOpenLanes: (task: KernelTask) => void;
  /** Task id to scroll into view and highlight once the board has rendered. */
  focusTaskId?: string | null;
};

/**
 * A status-column overview of the kernel task list. It intentionally stays an index: clicking a
 * card returns to the list view with that task expanded, where the run evidence and gate actions
 * already live — except for `running` cards, which jump straight to the matching live lane.
 */
export function TaskBoard({ tasks, loading, onOpenTask, onOpenLanes, focusTaskId }: TaskBoardProps) {
  const { t } = useI18n();

  // A lane header sent us back here to locate its card; bring it into view once mounted.
  useEffect(() => {
    if (!focusTaskId) return;
    document.getElementById(`task-card-${focusTaskId}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusTaskId]);

  if (loading) {
    return <p className="empty-state task-board-loading">{t('tasks.loading')}</p>;
  }

  return (
    <div className="task-board-wrap" role="region" aria-label={t('tasks.boardTitle')}>
      <p className="task-board-hint">{t('tasks.boardHint')}</p>
      <div className="task-board">
        {TASK_BOARD_STATES.map(state => {
          const columnTasks = tasks.filter(task => task.status === state);
          return (
            <section className={`task-board-column ${state}`} key={state} aria-label={`${t(`tasks.state.${state}` as KeyPath)} (${columnTasks.length})`}>
              <header className="task-board-column-head">
                <span className={`state task-state ${state}`}>{t(`tasks.state.${state}` as KeyPath)}</span>
                <span className="task-board-count">{columnTasks.length}</span>
              </header>
              <div className="task-board-column-body">
                {columnTasks.length === 0 ? (
                  <p className="task-board-empty">{t('tasks.boardEmpty')}</p>
                ) : (
                  columnTasks.map(task => {
                    const running = task.status === 'running';
                    return (
                      <button
                        className={`task-card${task.id === focusTaskId ? ' task-card-focused' : ''}`}
                        id={`task-card-${task.id}`}
                        key={task.id}
                        type="button"
                        onClick={() => (running ? onOpenLanes(task) : onOpenTask(task))}
                        title={running ? t('tasks.openLanes') : t('tasks.openDetails')}
                        aria-label={running ? `${task.title} — ${t('tasks.openLanes')}` : `${task.title} — ${t('tasks.openDetails')}`}
                      >
                        <strong>{task.title}</strong>
                        <span className="task-card-repo">{task.repo}<small>@{task.baseRef}</small></span>
                        <span className="task-card-meta">
                          {task.pipeline && (
                            <span className={`state ${task.pipeline.status}`}>
                              {t(`tasks.pipelineStatus.${task.pipeline.status}` as KeyPath)}
                            </span>
                          )}
                          {task.teamId && <span className="task-card-chip">{t('tasks.team')}: {task.teamId}</span>}
                          {!task.teamId && task.roleId && <span className="task-card-chip">{t('tasks.role')}: {task.roleId}</span>}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
