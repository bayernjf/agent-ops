import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ListTodo, Play, Plus, RefreshCw, Square, Trash2, X } from 'lucide-react';
import { useI18n, type KeyPath } from '../i18n/i18n';
import type { AgentRole, KernelRun, KernelTask, KernelTaskState, TaskPipeline, TaskPipelineStep, TaskPipelineStepResult } from '../types';
import { apiFetch, apiStreamFetch } from '../lib/api';

type RunAction = 'execute' | 'accept' | 'reject';

type PipelineStepForm = {
  name: string;
  roleId: string;
  profileId: string;
  agentId: string;
  prompt: string;
};

type TaskForm = {
  repo: string;
  baseRef: string;
  title: string;
  objective: string;
  priority: 'low' | 'medium' | 'high';
  roleId: string;
  acceptanceCriteria: string;
  pipelineEnabled: boolean;
  steps: PipelineStepForm[];
};

const emptyStep: PipelineStepForm = { name: '', roleId: '', profileId: '', agentId: '', prompt: '' };

const emptyTaskForm: TaskForm = {
  repo: '',
  baseRef: 'dev',
  title: '',
  objective: '',
  priority: 'medium',
  roleId: '',
  acceptanceCriteria: '',
  pipelineEnabled: false,
  steps: [],
};

const splitLines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean);

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
  const [showCreate, setShowCreate] = useState(false);
  const [roles, setRoles] = useState<AgentRole[]>([]);
  const [creating, setCreating] = useState(false);
  const [taskForm, setTaskForm] = useState<TaskForm>(emptyTaskForm);
  const [pipelineBusyId, setPipelineBusyId] = useState<string | null>(null);

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

  const loadRoles = useCallback(async () => {
    try {
      const response = await apiFetch('/api/roles');
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) return;
      const body = payload as { roles?: AgentRole[] } | null;
      setRoles(Array.isArray(body?.roles) ? body.roles : []);
    } catch {
      // Roles are optional inputs to the create form; a failed read leaves the select empty.
    }
  }, []);

  useEffect(() => { void loadRoles(); }, [loadRoles]);

  const startCreate = () => {
    setShowCreate(true);
    setTaskForm(emptyTaskForm);
    setError('');
  };

  const cancelCreate = () => {
    setShowCreate(false);
    setTaskForm(emptyTaskForm);
  };

  const submitTask = async () => {
    if (!taskForm.repo.trim() || !taskForm.baseRef.trim() || !taskForm.title.trim()) return;
    const steps = taskForm.pipelineEnabled
      ? taskForm.steps
        .map(step => ({
          name: step.name.trim(),
          roleId: step.roleId || undefined,
          profileId: step.profileId || undefined,
          agentId: step.agentId || undefined,
          prompt: step.prompt.trim() || undefined,
        }))
        .filter(step => step.name && (step.roleId || step.profileId || step.agentId))
      : [];
    if (taskForm.pipelineEnabled && steps.length === 0) {
      setError(t('tasks.pipelineNeedsStep'));
      return;
    }
    setCreating(true);
    setError('');
    try {
      const criteria = splitLines(taskForm.acceptanceCriteria);
      const response = await apiFetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          repo: taskForm.repo.trim(),
          baseRef: taskForm.baseRef.trim(),
          title: taskForm.title.trim(),
          objective: taskForm.objective.trim() || undefined,
          priority: taskForm.priority,
          roleId: taskForm.roleId || undefined,
          ...(criteria.length ? { acceptanceCriteria: criteria } : {}),
          ...(taskForm.pipelineEnabled ? { pipeline: { steps } } : {}),
        }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? t('tasks.createTask'));
      setShowCreate(false);
      setTaskForm(emptyTaskForm);
      await loadTasks();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('tasks.createTask'));
    } finally {
      setCreating(false);
    }
  };

  const updateTaskForm = <K extends keyof TaskForm>(key: K, value: TaskForm[K]) => setTaskForm(prev => ({ ...prev, [key]: value }));

  const addStep = () => setTaskForm(prev => ({ ...prev, steps: [...prev.steps, { ...emptyStep }] }));
  const removeStep = (index: number) => setTaskForm(prev => ({ ...prev, steps: prev.steps.filter((_, i) => i !== index) }));
  const updateStep = <K extends keyof PipelineStepForm>(index: number, key: K, value: PipelineStepForm[K]) => setTaskForm(prev => ({
    ...prev,
    steps: prev.steps.map((step, i) => (i === index ? { ...step, [key]: value } : step)),
  }));

  const executePipeline = async (task: KernelTask) => {
    setPipelineBusyId(task.id);
    setError('');
    try {
      const response = await apiFetch(`/api/tasks/${encodeURIComponent(task.id)}/pipeline/execute`, { method: 'POST' });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? t('tasks.pipelineExecute'));
      await loadTasks();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('tasks.pipelineExecute'));
    } finally {
      setPipelineBusyId(null);
    }
  };

  const stepIdentity = (step: TaskPipelineStep) => step.roleId ?? step.profileId ?? step.agentId ?? '—';

  const pipelineStepResult = (pipeline: TaskPipeline, stepId: string): TaskPipelineStepResult | undefined =>
    pipeline.results.find(result => result.stepId === stepId);

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
          <div className="tasks-actions">
            <button className="icon-button" type="button" onClick={() => void refreshTasks()} aria-label={t('common.refresh')} title={t('common.refresh')}>
              <RefreshCw size={18} />
            </button>
            <button className="quiet-button" type="button" onClick={startCreate}><Plus size={16} aria-hidden="true" /> {t('tasks.newTask')}</button>
          </div>
        </div>

        {error && <p className="error">{error}</p>}

        {showCreate && (
          <div className="task-form">
            <h3>{t('tasks.newTaskTitle')}</h3>
            <div className="task-form-grid">
              <label>{t('tasks.repo')}<input value={taskForm.repo} onChange={e => updateTaskForm('repo', e.target.value)} placeholder={t('tasks.repoPlaceholder')} /></label>
              <label>{t('tasks.baseRef')}<input value={taskForm.baseRef} onChange={e => updateTaskForm('baseRef', e.target.value)} placeholder={t('tasks.baseRefPlaceholder')} /></label>
            </div>
            <label>{t('tasks.formTitle')}<input value={taskForm.title} onChange={e => updateTaskForm('title', e.target.value)} placeholder={t('tasks.titlePlaceholder')} /></label>
            <label>{t('tasks.objective')}<textarea rows={3} value={taskForm.objective} onChange={e => updateTaskForm('objective', e.target.value)} /></label>
            <div className="task-form-grid">
              <label>{t('tasks.priority')}
                <select value={taskForm.priority} onChange={e => updateTaskForm('priority', e.target.value as TaskForm['priority'])}>
                  <option value="low">{t('tasks.priorityLow')}</option>
                  <option value="medium">{t('tasks.priorityMedium')}</option>
                  <option value="high">{t('tasks.priorityHigh')}</option>
                </select>
              </label>
              <label>{t('tasks.taskRole')}
                <select value={taskForm.roleId} onChange={e => updateTaskForm('roleId', e.target.value)}>
                  <option value="">{t('tasks.roleNone')}</option>
                  {roles.map(role => <option value={role.id} key={role.id}>{`${role.name} (${role.id})`}</option>)}
                </select>
              </label>
            </div>
            <label>{t('tasks.criteria')}<textarea rows={3} value={taskForm.acceptanceCriteria} onChange={e => updateTaskForm('acceptanceCriteria', e.target.value)} placeholder={t('tasks.criteriaPlaceholder')} /></label>

            <label className="pipeline-toggle"><input type="checkbox" checked={taskForm.pipelineEnabled} onChange={e => updateTaskForm('pipelineEnabled', e.target.checked)} /> {t('tasks.pipelineEnabled')}</label>

            {taskForm.pipelineEnabled && (
              <div className="pipeline-editor">
                <h4>{t('tasks.pipelineSteps')}</h4>
                {taskForm.steps.map((step, index) => (
                  <div className="pipeline-step" key={index}>
                    <div className="pipeline-step-head">
                      <strong>{t('tasks.pipelineStepIndex', { index: index + 1 })}</strong>
                      <button className="icon-button" type="button" onClick={() => removeStep(index)} aria-label={t('common.delete')} title={t('common.delete')}><Trash2 size={14} /></button>
                    </div>
                    <div className="task-form-grid">
                      <label>{t('tasks.stepName')}<input value={step.name} onChange={e => updateStep(index, 'name', e.target.value)} placeholder={t('tasks.stepNamePlaceholder')} /></label>
                      <label>{t('tasks.stepRole')}
                        <select value={step.roleId} onChange={e => updateStep(index, 'roleId', e.target.value)}>
                          <option value="">{t('tasks.roleNone')}</option>
                          {roles.map(role => <option value={role.id} key={role.id}>{`${role.name} (${role.id})`}</option>)}
                        </select>
                      </label>
                    </div>
                    <label>{t('tasks.stepPrompt')}<textarea rows={2} value={step.prompt} onChange={e => updateStep(index, 'prompt', e.target.value)} /></label>
                  </div>
                ))}
                <button className="quiet-button" type="button" onClick={addStep}><Plus size={14} aria-hidden="true" /> {t('tasks.addStep')}</button>
              </div>
            )}

            <div className="task-form-actions">
              <button className="secondary-button" type="button" onClick={cancelCreate} disabled={creating}><X size={14} aria-hidden="true" /> {t('common.cancel')}</button>
              <button className="primary-button" type="button" onClick={() => void submitTask()} disabled={creating || !taskForm.repo.trim() || !taskForm.baseRef.trim() || !taskForm.title.trim()}>
                <Check size={14} aria-hidden="true" /> {creating ? t('common.saving') : t('tasks.create')}
              </button>
            </div>
          </div>
        )}

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
                    {task.pipeline && (() => {
                      const pipeline = task.pipeline;
                      return (
                        <div className="pipeline-panel">
                          <div className="pipeline-head">
                            <span className={`state ${pipeline.status}`}>{t(`tasks.pipelineStatus.${pipeline.status}` as KeyPath)}</span>
                            {(pipeline.status === 'idle' || pipeline.status === 'failed') && (
                              <button className="secondary-button" type="button" onClick={() => void executePipeline(task)} disabled={pipelineBusyId === task.id}>
                                <Play size={14} aria-hidden="true" /> {pipelineBusyId === task.id ? t('tasks.pipelineRunning') : t('tasks.pipelineExecute')}
                              </button>
                            )}
                          </div>
                          <div className="pipeline-steps">
                            {pipeline.steps.map(step => {
                              const result = pipelineStepResult(pipeline, step.id);
                              return (
                                <div className="pipeline-step-row" key={step.id}>
                                  <strong>{step.name}</strong>
                                  <span className="pipeline-step-identity">{stepIdentity(step)}</span>
                                  <span className={`state ${result?.status ?? 'pending'}`}>{t(`tasks.pipelineStepStatus.${result?.status ?? 'pending'}` as KeyPath)}</span>
                                  {result?.commitSha ? <span className="pipeline-step-commit">{result.commitSha.slice(0, 10)}</span> : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
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
                              <span className="run-agent" title={run.agentId}>{run.runtimeId ?? run.agentId}</span>
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

                            {(run.roleId || run.runtimeId || run.commitSha) && (
                              <div className="run-evidence-meta run-identity">
                                <span>{t('tasks.role')}: {run.roleId ?? '—'}</span>
                                <span>{t('tasks.runtime')}: {run.runtimeId ?? '—'}</span>
                                <span>{t('tasks.commit')}: {run.commitSha ? run.commitSha.slice(0, 10) : '—'}</span>
                              </div>
                            )}

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
