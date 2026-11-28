import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, RefreshCw, Square, X } from 'lucide-react';
import { useI18n, type KeyPath } from '../i18n/i18n';
import type { KernelRun, KernelTask } from '../types';
import { apiFetch, apiStreamFetch } from '../lib/api';

type LanesViewProps = {
  tasks: KernelTask[];
  onOpenTask: (task: KernelTask) => void;
};

type ActiveLane = {
  run: KernelRun;
  task: KernelTask;
  /** Live stdout/stderr accumulated from the run SSE stream; seeds from persisted output. */
  live: string;
};

/** A lane is a live session, not a status column: only runs that are actually moving show here. */
const ACTIVE_STATES: ReadonlySet<KernelTask['status']> = new Set(['running', 'review']);

function formatElapsed(startedAt: string | undefined, now: number): string {
  const start = startedAt ? Date.parse(startedAt) : NaN;
  if (Number.isNaN(start)) return '—';
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

async function subscribeRun(runId: string, signal: AbortSignal, onChunk: (chunk: string) => void): Promise<void> {
  try {
    const response = await apiStreamFetch(`/api/runs/${encodeURIComponent(runId)}/events`, { signal });
    if (!response.ok || !response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
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
          onChunk(event.data);
        }
      }
    }
  } catch {
    // Aborted on unmount/refresh, or the stream simply ended; both are benign.
  }
}

/**
 * The Lanes view renders each active agent session as a vertical swimlane. A lane is one run,
 * not one agent: the same agent can own several parallel lanes. It is read-only plus the human
 * gates that already exist on the run lifecycle — cancel a running run, accept or reject a
 * review run. It never types into the agent.
 */
export function LanesView({ tasks, onOpenTask }: LanesViewProps) {
  const { t } = useI18n();
  const [lanes, setLanes] = useState<ActiveLane[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const loadAbortRef = useRef<AbortController | null>(null);
  const streamControllers = useRef(new Map<string, AbortController>());

  const activeTasks = useMemo(() => tasks.filter(task => ACTIVE_STATES.has(task.status)), [tasks]);

  const loadLanes = useCallback(async () => {
    setLoading(true);
    setError('');
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    try {
      const found: ActiveLane[] = [];
      for (const task of activeTasks) {
        const response = await apiFetch(`/api/tasks/${encodeURIComponent(task.id)}/runs`, {
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as unknown;
        if (!response.ok) continue;
        const runs = Array.isArray(payload) ? (payload as KernelRun[]) : [];
        for (const run of runs) {
          if (run.status === 'running' || run.status === 'review') {
            found.push({ run, task, live: run.artifacts?.output ?? '' });
          }
        }
      }
      setLanes(found);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [activeTasks]);

  useEffect(() => {
    void loadLanes();
    return () => loadAbortRef.current?.abort();
  }, [loadLanes]);

  // Tick once a second so the elapsed-time labels keep moving without re-fetching.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Keep one SSE subscription per running lane; drop it the moment the lane leaves `running`.
  useEffect(() => {
    const runningIds = new Set(lanes.filter(lane => lane.run.status === 'running').map(lane => lane.run.id));
    for (const [id, controller] of streamControllers.current) {
      if (!runningIds.has(id)) {
        controller.abort();
        streamControllers.current.delete(id);
      }
    }
    for (const lane of lanes) {
      if (lane.run.status !== 'running' || streamControllers.current.has(lane.run.id)) continue;
      const controller = new AbortController();
      streamControllers.current.set(lane.run.id, controller);
      void subscribeRun(lane.run.id, controller.signal, chunk => {
        setLanes(prev => prev.map(l => (
          l.run.id === lane.run.id ? { ...l, live: l.live + chunk } : l
        )));
      });
    }
  }, [lanes]);

  useEffect(() => () => {
    for (const controller of streamControllers.current.values()) controller.abort();
    streamControllers.current.clear();
  }, []);

  const runAction = useCallback(async (run: KernelRun, action: 'cancel' | 'accept' | 'reject') => {
    setBusyRunId(run.id);
    setError('');
    try {
      const endpoint = action === 'cancel'
        ? `/api/runs/${encodeURIComponent(run.id)}/cancel`
        : `/api/runs/${encodeURIComponent(run.id)}/${action}`;
      const response = await apiFetch(endpoint, { method: 'POST' });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? t('lanes.actionFailed'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyRunId(null);
      void loadLanes();
    }
  }, [loadLanes, t]);

  const tokenTotal = (run: KernelRun) => (run.inputTokens ?? 0) + (run.outputTokens ?? 0);

  return (
    <div className="lanes-view" role="region" aria-label={t('lanes.title')}>
      <div className="lanes-toolbar">
        <p className="lanes-hint">{t('lanes.hint')}</p>
        <button className="icon-button" type="button" onClick={() => void loadLanes()} aria-label={t('common.refresh')} title={t('common.refresh')}>
          <RefreshCw size={18} />
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {loading ? (
        <p className="empty-state lanes-loading">{t('lanes.loading')}</p>
      ) : lanes.length === 0 ? (
        <p className="empty-state">{t('lanes.empty')}</p>
      ) : (
        <div className="lanes-scroll">
          {lanes.map(lane => {
            const { run, task } = lane;
            const running = run.status === 'running';
            const review = run.status === 'review';
            return (
              <section
                className={`lane ${run.status}`}
                key={run.id}
                aria-label={`${run.agentId} — ${task.title}`}
              >
                <header className="lane-head">
                  <button
                    className="lane-title"
                    type="button"
                    onClick={() => onOpenTask(task)}
                    title={t('tasks.openDetails')}
                  >
                    <strong>{run.agentId}</strong>
                    {run.roleId && <span className="lane-chip">{t('tasks.role')}: {run.roleId}</span>}
                    <span className="lane-repo">{task.repo}<small>@{task.baseRef}</small></span>
                  </button>
                  <span className={`lane-state state task-state ${run.status}`}>
                    {t(`tasks.state.${run.status}` as KeyPath)}
                  </span>
                </header>

                <div className="lane-meta">
                  <span>{t('lanes.duration')}: {formatElapsed(run.artifacts?.startedAt ?? run.createdAt, now)}</span>
                  {tokenTotal(run) > 0 && <span>{t('lanes.tokens')}: {tokenTotal(run)}</span>}
                  {run.laneId && <span className="lane-chip">lane: {run.laneId}</span>}
                </div>

                <div className="lane-token-track" aria-hidden="true">
                  <div
                    className="lane-token-fill"
                    style={{ width: `${Math.min(100, Math.round((tokenTotal(run) / 8000) * 100))}%` }}
                  />
                </div>

                <pre className="lane-stream" aria-live="polite">
                  {lane.live || t('lanes.waiting')}
                </pre>

                <footer className="lane-actions">
                  {running && (
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void runAction(run, 'cancel')}
                      disabled={busyRunId === run.id}
                    >
                      <Square size={14} aria-hidden="true" /> {t('lanes.cancel')}
                    </button>
                  )}
                  {review && (
                    <>
                      <button
                        className="primary-button"
                        type="button"
                        onClick={() => void runAction(run, 'accept')}
                        disabled={busyRunId === run.id}
                      >
                        <Check size={14} aria-hidden="true" /> {t('lanes.accept')}
                      </button>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => void runAction(run, 'reject')}
                        disabled={busyRunId === run.id}
                      >
                        <X size={14} aria-hidden="true" /> {t('lanes.reject')}
                      </button>
                    </>
                  )}
                </footer>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
