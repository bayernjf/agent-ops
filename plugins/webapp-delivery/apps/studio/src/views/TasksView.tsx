import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ListTodo, RefreshCw, Square, X } from 'lucide-react';
import { useI18n, type KeyPath } from '../i18n/i18n';
import type { KernelRun, KernelTask, KernelTaskState } from '../types';
import { apiFetch, apiStreamFetch } from '../lib/api';

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
    || artifacts.cancelled
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
  const [executingRunId, setExecutingRunId] = useState<string | null>(null);
  const [liveOutputByRun, setLiveOutputByRun] = useState<Record<string, string>>({});
  const liveAbortRef = useRef<AbortController | null>(null);

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

  // The header refresh button is the only manual recovery when an SSE stream misses a
  // terminal frame. Reloading the task list alone left an expanded task showing its old
  // Run status forever, so the expanded Run list has to be refreshed too.
  const refreshTasks = useCallback(async () => {
    await loadTasks();
    if (expandedId) await loadRuns(expandedId);
  }, [expandedId, loadRuns, loadTasks]);

  useEffect(() => () => {
    liveAbortRef.current?.abort();
  }, []);

  const stopRunStream = useCallback(() => {
    liveAbortRef.current?.abort();
    liveAbortRef.current = null;
  }, []);

  const startRunStream = useCallback(async (run: KernelRun) => {
    stopRunStream();
    const controller = new AbortController();
    liveAbortRef.current = controller;
    try {
      const response = await apiStreamFetch(`/api/runs/${encodeURIComponent(run.id)}/events`, {
        signal: controller.signal,
      });
      if (!response.ok || !response.body) return;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;
      while (!finished) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const data = frame
            .split('\n')
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trimStart())
            .join('\n');
          if (!data) continue;
          let event: { type?: string; data?: unknown };
          try {
            event = JSON.parse(data) as { type?: string; data?: unknown };
          } catch {
            continue;
          }
          if ((event.type === 'stdout' || event.type === 'stderr') && typeof event.data === 'string') {
            setLiveOutputByRun(previous => ({
              ...previous,
              [run.id]: `${previous[run.id] ?? ''}${event.data as string}`,
            }));
          }
          if (event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled') {
            finished = true;
            void loadRuns(run.taskId);
            void loadTasks();
            break;
          }
        }
      }
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        setError(cause instanceof Error ? cause.message : t('tasks.streamRun'));
      }
    } finally {
      if (liveAbortRef.current === controller) liveAbortRef.current = null;
      controller.abort();
    }
  }, [loadRuns, loadTasks, stopRunStream, t]);

  const toggleTask = (taskId: string) => {
    if (expandedId === taskId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(taskId);
    if (!runsByTask[taskId]) void loadRuns(taskId);
  };

  const runAction = async (run: KernelRun, action: RunAction) => {
    const isExecute = action === 'execute';
    if (isExecute) {
      setExecutingRunId(run.id);
      setRunsByTask(previous => ({
        ...previous,
        [run.taskId]: (previous[run.taskId] ?? []).map(candidate => (
          candidate.id === run.id ? { ...candidate, status: 'running' } : candidate
        )),
      }));
      setLiveOutputByRun(previous => ({ ...previous, [run.id]: '' }));
      void startRunStream(run);
    } else {
      setBusyRunId(run.id);
    }
    setError('');
    try {
      const response = await apiFetch(`/api/runs/${encodeURIComponent(run.id)}/${action}`, { method: 'POST' });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? t(`tasks.${action}Run` as KeyPath));
      await loadRuns(run.taskId);
      await loadTasks();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t(`tasks.${action}Run` as KeyPath));
      if (isExecute) await loadRuns(run.taskId);
    } finally {
      if (isExecute) {
        stopRunStream();
        setExecutingRunId(null);
      } else {
        setBusyRunId(null);
      }
    }
  };

  const cancelRun = async (run: KernelRun) => {
    setBusyRunId(run.id);
    setError('');
    try {
      const response = await apiFetch(`/api/runs/${encodeURIComponent(run.id)}/cancel`, { method: 'POST' });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? t('tasks.cancelRun'));
      await loadRuns(run.taskId);
      await loadTasks();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('tasks.cancelRun'));
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
          <button className="icon-button" type="button" onClick={() => void refreshTasks()} aria-label={t('common.refresh')} title={t('common.refresh')}>
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
                                  <button className="secondary-button" type="button" onClick={() => void runAction(run, 'execute')} disabled={busyRunId === run.id || executingRunId === run.id}>
                                    {t('tasks.execute')}
                                  </button>
                                )}
                                {run.status === 'running' && (
                                  <button className="secondary-button" type="button" onClick={() => void cancelRun(run)} disabled={busyRunId === run.id}>
                                    <Square size={14} aria-hidden="true" /> {busyRunId === run.id ? t('tasks.cancelling') : t('tasks.cancel')}
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

                            {run.status === 'running' && (
                              <details className="run-evidence" open>
                                <summary>{t('tasks.liveOutput')}</summary>
                                <pre className="run-evidence-pre">{liveOutputByRun[run.id] || t('tasks.waitingOutput')}</pre>
                              </details>
                            )}

                            {hasEvidence(run) && (
                              <details className="run-evidence">
                                <summary>{t('tasks.evidence')}</summary>
                                <div className="run-evidence-meta">
                                  <span>{t('tasks.exitCode')}: {run.artifacts?.exitCode ?? '—'}</span>
                                  <span>{t('tasks.duration')}: {formatDuration(run.artifacts?.durationMs ?? 0)}</span>
                                  <span>{t('tasks.changedFiles')}: {run.artifacts?.changedFiles.length ?? 0}</span>
                                  {run.artifacts?.timedOut && <span className="run-evidence-warning">{t('tasks.timedOut')}</span>}
                                  {run.artifacts?.cancelled && <span className="run-evidence-warning">{t('tasks.cancelled')}</span>}
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
