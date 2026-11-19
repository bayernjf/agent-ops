import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ListTodo, RefreshCw, X } from 'lucide-react';
import { useI18n, type KeyPath } from '../i18n/i18n';
import type { KernelRun, KernelTask, KernelTaskState } from '../types';
import { apiFetch } from '../lib/api';

type RunAction = 'execute' | 'accept' | 'reject';

function formatDuration(durationMs: number): string {
  return durationMs < 1000 ? `${durationMs} ms` : `${(durationMs / 1000).toFixed(1)} s`;
}

function hasEvidence(run: KernelRun): boolean {
  const artifacts = run.artifacts;
  return Boolean(artifacts && (
    artifacts.output
    || artifacts.diff
    || artifacts.exitCode !== null
    || artifacts.timedOut
    || artifacts.changedFiles.length > 0
  ));
}

/**
 * The kernel Task/Run board. It is a read-and-gate view over server-core's
 * `/api/tasks` and `/api/runs` control plane, kept parallel to the webapp
 * delivery views rather than replacing them. The only mutations it offers are
 * the three human gates of the run lifecycle: execute (queued -> running),
 * accept (review -> done) and reject (review -> queued).
 */
export function TasksView() {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<KernelTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [runsByTask, setRunsByTask] = useState<Record<string, KernelRun[]>>({});
  const [busyRunId, setBusyRunId] = useState<string | null>(null);

  const stateLabel = (state: KernelTaskState) => t(`tasks.state.${state}` as KeyPath);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch('/api/tasks');
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        const body = payload as { error?: string } | null;
        throw new Error(body?.error ?? t('tasks.loadTasks'));
      }
      setTasks(Array.isArray(payload) ? (payload as KernelTask[]) : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('tasks.loadTasks'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadRuns = useCallback(async (taskId: string) => {
    setError('');
    try {
      const response = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/runs`);
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        const body = payload as { error?: string } | null;
        throw new Error(body?.error ?? t('tasks.loadRuns'));
      }
      setRunsByTask(prev => ({ ...prev, [taskId]: Array.isArray(payload) ? (payload as KernelRun[]) : [] }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('tasks.loadRuns'));
    }
  }, [t]);

  useEffect(() => { void loadTasks(); }, [loadTasks]);

  const toggleTask = (taskId: string) => {
    if (expandedId === taskId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(taskId);
    if (!runsByTask[taskId]) void loadRuns(taskId);
  };

  const runAction = async (run: KernelRun, action: RunAction) => {
    setBusyRunId(run.id);
    setError('');
    try {
      const response = await apiFetch(`/api/runs/${encodeURIComponent(run.id)}/${action}`, { method: 'POST' });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? t(`tasks.${action}Run` as KeyPath));
      await loadRuns(run.taskId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t(`tasks.${action}Run` as KeyPath));
    } finally {
      setBusyRunId(null);
    }
  };

  const taskRuns = (taskId: string) => runsByTask[taskId] ?? [];

  return (
    <section className="tasks-view" aria-label={t('tasks.title')}>
      <div className="dashboard-content">
        <div className="section-heading">
          <div>
            <h2><ListTodo size={18} aria-hidden="true" /> {t('tasks.title')}</h2>
            <p>{t('tasks.description')}</p>
          </div>
          <button className="icon-button" type="button" onClick={() => void loadTasks()} aria-label={t('common.refresh')} title={t('common.refresh')}>
            <RefreshCw size={18} />
          </button>
        </div>

        {error && <p className="error">{error}</p>}

        <div className="task-table" role="table" aria-label={t('tasks.title')}>
          <div className="task-head" role="row">
            <span aria-hidden="true" />
            <span>{t('tasks.titleCol')}</span>
            <span>{t('tasks.repoCol')}</span>
            <span>{t('tasks.statusCol')}</span>
          </div>

          {loading ? (
            <p className="empty-state">{t('tasks.loading')}</p>
          ) : tasks.length === 0 ? (
            <p className="empty-state">{t('tasks.empty')}</p>
          ) : (
            tasks.map(task => (
              <div key={task.id}>
                <button
                  className={`task-row ${expandedId === task.id ? 'expanded' : ''}`}
                  role="row"
                  type="button"
                  onClick={() => toggleTask(task.id)}
                  aria-expanded={expandedId === task.id}
                >
                  <span className="task-caret" aria-hidden="true">{expandedId === task.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
                  <strong>{task.title}</strong>
                  <span className="task-repo">{task.repo}<small>@{task.baseRef}</small></span>
                  <span className={`state task-state ${task.status}`}>{stateLabel(task.status)}</span>
                </button>

                {expandedId === task.id && (
                  <div className="run-list">
                    {taskRuns(task.id).length === 0 ? (
                      <p className="run-empty">{t('tasks.noRuns')}</p>
                    ) : (
                      <div className="run-table" role="table" aria-label={t('tasks.runs')}>
                        <div className="run-head" role="row">
                          <span>{t('tasks.agentCol')}</span>
                          <span>{t('tasks.statusCol')}</span>
                          <span>{t('tasks.diffCol')}</span>
                          <span aria-hidden="true" />
                        </div>
                        {taskRuns(task.id).map(run => (
                          <div className="run-record" key={run.id}>
                            <div className="run-row" role="row">
                              <span className="run-agent">{run.agentId}</span>
                              <span className={`state ${run.status}`}>{stateLabel(run.status)}</span>
                              <span className="run-diff">{run.diffStat || '—'}</span>
                              <span className="run-actions">
                                {run.status === 'queued' && (
                                  <button className="secondary-button" type="button" onClick={() => void runAction(run, 'execute')} disabled={busyRunId === run.id}>
                                    {t('tasks.execute')}
                                  </button>
                                )}
                                {run.status === 'review' && (
                                  <>
                                    <button className="secondary-button" type="button" onClick={() => void runAction(run, 'accept')} disabled={busyRunId === run.id}>
                                      <Check size={14} aria-hidden="true" /> {t('tasks.accept')}
                                    </button>
                                    <button className="secondary-button" type="button" onClick={() => void runAction(run, 'reject')} disabled={busyRunId === run.id}>
                                      <X size={14} aria-hidden="true" /> {t('tasks.reject')}
                                    </button>
                                  </>
                                )}
                              </span>
                            </div>

                            {hasEvidence(run) && (
                              <details className="run-evidence">
                                <summary>{t('tasks.evidence')}</summary>
                                <div className="run-evidence-meta">
                                  <span>{t('tasks.exitCode')}: {run.artifacts?.exitCode ?? '—'}</span>
                                  <span>{t('tasks.duration')}: {formatDuration(run.artifacts?.durationMs ?? 0)}</span>
                                  <span>{t('tasks.changedFiles')}: {run.artifacts?.changedFiles.length ?? 0}</span>
                                  {run.artifacts?.timedOut && <span className="run-evidence-warning">{t('tasks.timedOut')}</span>}
                                </div>
                                {run.artifacts?.changedFiles.length ? (
                                  <p className="run-evidence-files">{run.artifacts.changedFiles.join(', ')}</p>
                                ) : null}
                                <h4>{t('tasks.output')}</h4>
                                <pre className="run-evidence-pre">{run.artifacts?.output || t('tasks.noOutput')}</pre>
                                {run.artifacts?.outputTruncated && <p className="run-evidence-note">{t('tasks.outputTruncated')}</p>}
                                <h4>{t('tasks.fullDiff')}</h4>
                                <pre className="run-evidence-pre">{run.artifacts?.diff || t('tasks.noDiff')}</pre>
                                {run.artifacts?.diffTruncated && <p className="run-evidence-note">{t('tasks.diffTruncated')}</p>}
                              </details>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
