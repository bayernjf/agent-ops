import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, GitFork, ListTodo, Play, Plus, RefreshCw, RotateCcw, Square, Trash2, Users, X } from 'lucide-react';
import { useI18n, type KeyPath } from '../i18n/i18n';
import type { AgentRole, BudgetStatus, DagPipelineResult, KernelRun, KernelTask, KernelTaskState, ParallelTeamResult, TaskBudgetStatus, TaskPipeline, TaskPipelineStep, TaskPipelineStepResult } from '../types';
import { apiFetch, apiStreamFetch } from '../lib/api';

type RunAction = 'execute' | 'accept' | 'reject';
type WorktreePolicy = 'keep' | 'fresh';

type PipelineStepForm = {
  name: string;
  roleId: string;
  profileId: string;
  agentId: string;
  prompt: string;
  requiresApproval: boolean;
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

const emptyStep: PipelineStepForm = { name: '', roleId: '', profileId: '', agentId: '', prompt: '', requiresApproval: false };

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

// Pipeline and fan-out endpoints run synchronously until the model finishes. The shared
// apiFetch default is 15s, which aborts a real model run and leaves the daemon working on a
// request the UI has already abandoned. Give these the same budget as a long dogfood run.
const PIPELINE_REQUEST_TIMEOUT_MS = 10 * 60_000;

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
    || (artifacts.toolCalls?.length ?? 0) > 0
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
  const [budgetByTask, setBudgetByTask] = useState<Record<string, TaskBudgetStatus>>({});
  const [selectedFilesByRun, setSelectedFilesByRun] = useState<Record<string, string[]>>({});
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [executingRunId, setExecutingRunId] = useState<string | null>(null);
  const [liveOutputByRun, setLiveOutputByRun] = useState<Record<string, string>>({});
  const liveAbortRef = useRef<AbortController | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [roles, setRoles] = useState<AgentRole[]>([]);
  const [creating, setCreating] = useState(false);
  const [taskForm, setTaskForm] = useState<TaskForm>(emptyTaskForm);
  const [pipelineBusyId, setPipelineBusyId] = useState<string | null>(null);
  const [fanoutBusy, setFanoutBusy] = useState<string | null>(null);
  const [dagResultByTask, setDagResultByTask] = useState<Record<string, DagPipelineResult>>({});
  const [parallelResultByTask, setParallelResultByTask] = useState<Record<string, ParallelTeamResult>>({});
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);

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
      const runs = Array.isArray(payload) ? (payload as KernelRun[]) : [];
      setRunsByTask(prev => ({ ...prev, [taskId]: runs }));
      setSelectedFilesByRun(prev => {
        const next = { ...prev };
        for (const run of runs) {
          if (run.status !== 'review') {
            delete next[run.id];
            continue;
          }
          const changed = run.artifacts?.changedFiles ?? [];
          const current = next[run.id];
          // Preserve an explicit selection across refreshes, but drop paths the new evidence no
          // longer contains. A first sighting starts with every changed file accepted.
          next[run.id] = current === undefined
            ? changed
            : current.filter(file => changed.includes(file));
        }
        return next;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('tasks.loadRuns'));
    }
  }, [t]);

  useEffect(() => { void loadTasks(); }, [loadTasks]);

  const loadBudget = useCallback(async (taskId: string) => {
    try {
      const response = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/budget`);
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) return;
      setBudgetByTask(prev => ({ ...prev, [taskId]: payload as TaskBudgetStatus }));
    } catch {
      // Budget is an optional read; a failed fetch leaves the panel hidden.
    }
  }, []);

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
          requiresApproval: step.requiresApproval || undefined,
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

  const ensureProvisioned = async (task: KernelTask, fallback: KeyPath) => {
    // The create form does not provision a worktree, so a fresh task cannot run until it has one.
    if (task.worktreePath) return;
    const provision = await apiFetch(`/api/tasks/${encodeURIComponent(task.id)}/provision`, { method: 'POST' });
    const provisionBody = (await provision.json().catch(() => null)) as { error?: string } | null;
    if (!provision.ok) throw new Error(provisionBody?.error ?? t(fallback));
  };

  const executePipeline = async (task: KernelTask) => {
    setPipelineBusyId(task.id);
    setError('');
    try {
      await ensureProvisioned(task, 'tasks.pipelineExecute');
      const response = await apiFetch(`/api/tasks/${encodeURIComponent(task.id)}/pipeline/execute`, { method: 'POST' }, PIPELINE_REQUEST_TIMEOUT_MS);
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? t('tasks.pipelineExecute'));
      await loadTasks();
      // The expanded task cached its run list when it was opened; a pipeline run just added
      // entries, so refresh it the same way retry/approve/reject do.
      if (expandedId === task.id) await loadRuns(task.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('tasks.pipelineExecute'));
    } finally {
      setPipelineBusyId(null);
    }
  };

  const retryPipeline = async (task: KernelTask) => {
    setPipelineBusyId(task.id);
    setError('');
    try {
      const response = await apiFetch(`/api/tasks/${encodeURIComponent(task.id)}/pipeline/retry`, { method: 'POST' }, PIPELINE_REQUEST_TIMEOUT_MS);
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? t('tasks.pipelineRetry'));
      await loadTasks();
      if (expandedId === task.id) await loadRuns(task.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('tasks.pipelineRetry'));
    } finally {
      setPipelineBusyId(null);
    }
  };

  const rerunPipeline = async (task: KernelTask) => {
    if (!window.confirm(t('tasks.pipelineRerunConfirm'))) return;
    setPipelineBusyId(task.id);
    setError('');
    try {
      const response = await apiFetch(`/api/tasks/${encodeURIComponent(task.id)}/pipeline/rerun`, { method: 'POST' }, PIPELINE_REQUEST_TIMEOUT_MS);
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? t('tasks.pipelineRerun'));
      await loadTasks();
      if (expandedId === task.id) await loadRuns(task.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('tasks.pipelineRerun'));
    } finally {
      setPipelineBusyId(null);
    }
  };

  const runDagPipeline = async (task: KernelTask) => {
    if (!window.confirm(t('tasks.dagConfirm'))) return;
    const busyKey = `${task.id}:dag`;
    setFanoutBusy(busyKey);
    setError('');
    try {
      await ensureProvisioned(task, 'tasks.dagRun');
      const response = await apiFetch(`/api/tasks/${encodeURIComponent(task.id)}/pipeline/dag`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }, PIPELINE_REQUEST_TIMEOUT_MS);
      const body = (await response.json().catch(() => null)) as (DagPipelineResult & { error?: string }) | null;
      if (!response.ok || !body) throw new Error(body?.error ?? t('tasks.dagRun'));
      setDagResultByTask(previous => ({ ...previous, [task.id]: body }));
      await loadTasks();
      if (expandedId === task.id) await loadRuns(task.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('tasks.dagRun'));
    } finally {
      setFanoutBusy(null);
    }
  };

  const runParallelTeam = async (task: KernelTask) => {
    if (!window.confirm(t('tasks.parallelConfirm'))) return;
    const busyKey = `${task.id}:parallel`;
    setFanoutBusy(busyKey);
    setError('');
    try {
      await ensureProvisioned(task, 'tasks.parallelRun');
      const response = await apiFetch(`/api/tasks/${encodeURIComponent(task.id)}/parallel/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }, PIPELINE_REQUEST_TIMEOUT_MS);
      const body = (await response.json().catch(() => null)) as (ParallelTeamResult & { error?: string }) | null;
      if (!response.ok || !body) throw new Error(body?.error ?? t('tasks.parallelRun'));
      setParallelResultByTask(previous => ({ ...previous, [task.id]: body }));
      await loadTasks();
      if (expandedId === task.id) await loadRuns(task.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('tasks.parallelRun'));
    } finally {
      setFanoutBusy(null);
    }
  };

  const deleteTask = async (task: KernelTask) => {
    if (!window.confirm(t('tasks.deleteConfirm'))) return;
    setDeletingTaskId(task.id);
    setError('');
    try {
      const response = await apiFetch(`/api/tasks/${encodeURIComponent(task.id)}`, { method: 'DELETE' });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? t('tasks.deleteFailed'));
      setExpandedId(current => (current === task.id ? null : current));
      await loadTasks();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('tasks.deleteFailed'));
    } finally {
      setDeletingTaskId(null);
    }
  };

  const approvePipeline = async (task: KernelTask) => {
    setPipelineBusyId(task.id);
    setError('');
    try {
      const response = await apiFetch(`/api/tasks/${encodeURIComponent(task.id)}/pipeline/approve`, { method: 'POST' }, PIPELINE_REQUEST_TIMEOUT_MS);
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? t('tasks.pipelineApprove'));
      await loadTasks();
      if (expandedId === task.id) await loadRuns(task.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('tasks.pipelineApprove'));
    } finally {
      setPipelineBusyId(null);
    }
  };

  const rejectPipeline = async (task: KernelTask) => {
    setPipelineBusyId(task.id);
    setError('');
    try {
      const response = await apiFetch(`/api/tasks/${encodeURIComponent(task.id)}/pipeline/reject`, { method: 'POST' });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? t('tasks.pipelineReject'));
      await loadTasks();
      if (expandedId === task.id) await loadRuns(task.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('tasks.pipelineReject'));
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
    if (expandedId) {
      await loadRuns(expandedId);
      await loadBudget(expandedId);
    }
  }, [expandedId, loadBudget, loadRuns, loadTasks]);

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
    if (!(taskId in budgetByTask)) void loadBudget(taskId);
  };

  const changedFilesFor = (run: KernelRun) => run.artifacts?.changedFiles ?? [];
  const selectedFilesFor = (run: KernelRun) => selectedFilesByRun[run.id] ?? changedFilesFor(run);

  const toggleRunFile = (run: KernelRun, file: string) => {
    const current = selectedFilesFor(run);
    setSelectedFilesByRun(prev => ({
      ...prev,
      [run.id]: current.includes(file)
        ? current.filter(candidate => candidate !== file)
        : [...current, file],
    }));
  };

  const runAction = async (run: KernelRun, action: RunAction, files?: string[], worktree?: WorktreePolicy): Promise<boolean> => {
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
      const body = action === 'accept' && files !== undefined
        ? { files }
        : action === 'execute' && worktree !== undefined
          ? { worktree }
          : undefined;
      const response = await apiFetch(`/api/runs/${encodeURIComponent(run.id)}/${action}`, {
        method: 'POST',
        ...(body !== undefined
          ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? t(`tasks.${action}Run` as KeyPath));
      await loadRuns(run.taskId);
      await loadTasks();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t(`tasks.${action}Run` as KeyPath));
      if (isExecute) await loadRuns(run.taskId);
      return false;
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

  const updateParallelLaneStatus = (taskId: string, runId: string, status: string) => {
    setParallelResultByTask(previous => {
      const result = previous[taskId];
      if (!result) return previous;
      return {
        ...previous,
        [taskId]: {
          ...result,
          lanes: result.lanes.map(lane => lane.runId === runId ? { ...lane, status } : lane),
        },
      };
    });
  };

  const laneAction = async (task: KernelTask, lane: ParallelTeamResult['lanes'][number], action: 'accept' | 'reject') => {
    const run = taskRuns(task.id).find(candidate => candidate.id === lane.runId);
    if (!run) return;
    const changed = await runAction(run, action);
    if (changed) updateParallelLaneStatus(task.id, run.id, action === 'accept' ? 'done' : 'queued');
  };

  const selectFinalLane = async (task: KernelTask, lane: ParallelTeamResult['lanes'][number]) => {
    const run = taskRuns(task.id).find(candidate => candidate.id === lane.runId);
    if (!run) return;
    setBusyRunId(run.id);
    setError('');
    try {
      const response = await apiFetch(`/api/tasks/${encodeURIComponent(task.id)}/final-lane`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runId: run.id }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? t('tasks.selectFinalLaneFailed'));
      await loadTasks();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('tasks.selectFinalLaneFailed'));
    } finally {
      setBusyRunId(null);
    }
  };

  const configuredBudgetScopes = (status: TaskBudgetStatus): BudgetStatus[] =>
    [status.role, status.team].filter((scope): scope is BudgetStatus => Boolean(scope?.configured));

  const formatBudgetCost = (value: number | null | undefined, limit = false) =>
    value == null ? '—' : (limit ? `$${value}` : `$${value.toFixed(4)}`);
  const formatBudgetTokens = (value: number | null | undefined) =>
    value == null ? '—' : value.toLocaleString();

  const budgetRows = (scope: BudgetStatus) => [
    { label: t('tasks.budgetCost'), spend: formatBudgetCost(scope.spend.costUsd), limit: formatBudgetCost(scope.limits.maxCostUsd, true) },
    { label: t('tasks.budgetInputTokens'), spend: formatBudgetTokens(scope.spend.inputTokens), limit: formatBudgetTokens(scope.limits.maxInputTokens) },
    { label: t('tasks.budgetOutputTokens'), spend: formatBudgetTokens(scope.spend.outputTokens), limit: formatBudgetTokens(scope.limits.maxOutputTokens) },
  ];

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
                    <label className="pipeline-step-approval">
                      <input type="checkbox" checked={step.requiresApproval} onChange={e => updateStep(index, 'requiresApproval', e.target.checked)} />
                      {t('tasks.stepRequiresApproval')}
                    </label>
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
                    {task.status === 'queued' && taskRuns(task.id).length === 0 && (
                      <div className="task-danger-row">
                        <button className="quiet-button" type="button" onClick={() => void deleteTask(task)} disabled={deletingTaskId === task.id}>
                          <Trash2 size={14} aria-hidden="true" /> {t('tasks.deleteTask')}
                        </button>
                      </div>
                    )}
                    {task.pipeline && (() => {
                      const pipeline = task.pipeline;
                      return (
                        <div className="pipeline-panel">
                          <div className="pipeline-head">
                            <span className={`state ${pipeline.status}`}>{t(`tasks.pipelineStatus.${pipeline.status}` as KeyPath)}</span>
                            {pipeline.status === 'idle' && (
                              <button className="secondary-button" type="button" onClick={() => void executePipeline(task)} disabled={pipelineBusyId === task.id}>
                                <Play size={14} aria-hidden="true" /> {pipelineBusyId === task.id ? t('tasks.pipelineRunning') : t('tasks.pipelineExecute')}
                              </button>
                            )}
                            {pipeline.status === 'failed' && (
                              <button className="secondary-button" type="button" onClick={() => void retryPipeline(task)} disabled={pipelineBusyId === task.id}>
                                <RotateCcw size={14} aria-hidden="true" /> {pipelineBusyId === task.id ? t('tasks.pipelineRunning') : t('tasks.pipelineRetry')}
                              </button>
                            )}
                            {pipeline.status === 'completed' && (
                              <button className="secondary-button" type="button" onClick={() => void rerunPipeline(task)} disabled={pipelineBusyId === task.id}>
                                <RefreshCw size={14} aria-hidden="true" /> {pipelineBusyId === task.id ? t('tasks.pipelineRunning') : t('tasks.pipelineRerun')}
                              </button>
                            )}
                            {pipeline.status === 'awaiting_approval' && (
                              <>
                                <button className="secondary-button" type="button" onClick={() => void approvePipeline(task)} disabled={pipelineBusyId === task.id}>
                                  <Check size={14} aria-hidden="true" /> {t('tasks.pipelineApprove')}
                                </button>
                                <button className="secondary-button" type="button" onClick={() => void rejectPipeline(task)} disabled={pipelineBusyId === task.id}>
                                  <X size={14} aria-hidden="true" /> {t('tasks.pipelineReject')}
                                </button>
                              </>
                            )}
                            {(task.status === 'queued' || task.status === 'review') && pipeline.status !== 'running' && pipeline.status !== 'awaiting_approval' && !pipeline.steps.some(step => step.requiresApproval) && (
                              <button className="secondary-button" type="button" onClick={() => void runDagPipeline(task)} disabled={fanoutBusy === `${task.id}:dag`}>
                                <GitFork size={14} aria-hidden="true" /> {fanoutBusy === `${task.id}:dag` ? t('tasks.pipelineRunning') : t('tasks.dagRun')}
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
                    {task.teamId && (task.status === 'queued' || task.status === 'review') && (
                      <div className="fanout-actions">
                        <button className="secondary-button" type="button" onClick={() => void runParallelTeam(task)} disabled={fanoutBusy === `${task.id}:parallel`}>
                          <Users size={14} aria-hidden="true" /> {fanoutBusy === `${task.id}:parallel` ? t('tasks.pipelineRunning') : t('tasks.parallelRun')}
                        </button>
                      </div>
                    )}
                    {dagResultByTask[task.id] && (() => {
                      const result = dagResultByTask[task.id];
                      return (
                        <div className="fanout-panel" aria-label={t('tasks.dagResultTitle')}>
                          <div className="fanout-head">
                            <strong>{t('tasks.dagResultTitle')}</strong>
                            <span>{t('tasks.fanoutConcurrency', { count: result.maxConcurrency })}</span>
                          </div>
                          <div className="fanout-rows">
                            {result.steps.map(step => (
                              <div className="fanout-row" key={step.stepId}>
                                <span>{step.name}</span>
                                <span className={`state ${step.status}`}>{t(`tasks.fanoutStatus.${step.status}` as KeyPath)}</span>
                                <span className="pipeline-step-commit">{step.commitSha ? step.commitSha.slice(0, 10) : '—'}</span>
                                {step.error ? <small>{step.error}</small> : null}
                              </div>
                            ))}
                          </div>
                          {result.conflicts.length > 0 && (
                            <div className="fanout-notes">
                              <strong>{t('tasks.conflictsTitle')}</strong>
                              <ul>{result.conflicts.map(conflict => <li key={conflict.file}>{conflict.file} — {conflict.stepIds.join(', ')}</li>)}</ul>
                            </div>
                          )}
                          {result.warnings.length > 0 && (
                            <div className="fanout-notes">
                              <strong>{t('tasks.warningsTitle')}</strong>
                              <ul>{result.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {parallelResultByTask[task.id] && (() => {
                      const result = parallelResultByTask[task.id];
                      return (
                        <div className="fanout-panel" aria-label={t('tasks.parallelResultTitle')}>
                          <div className="fanout-head">
                            <strong>{t('tasks.parallelResultTitle')}</strong>
                            <span>{t('tasks.fanoutConcurrency', { count: result.maxConcurrency })}</span>
                          </div>
                          <div className="fanout-rows">
                            {result.lanes.map(lane => {
                              const laneRun = taskRuns(task.id).find(candidate => candidate.id === lane.runId);
                              const finalLane = task.finalRunId === lane.runId;
                              return (
                                <div className="fanout-row fanout-row-decision" key={lane.roleId}>
                                  <span>{lane.roleName}{finalLane ? <span className="final-lane-badge">{t('tasks.finalLane')}</span> : null}</span>
                                  <span className={`state ${lane.status}`}>{stateLabel(lane.status as KernelTaskState)}</span>
                                  <span className="pipeline-step-commit">{t('tasks.changedFileCount', { count: lane.changedFiles.length })}</span>
                                  <span className="fanout-lane-actions">
                                    {lane.status === 'review' && laneRun ? (
                                      <>
                                        <button className="secondary-button" type="button" onClick={() => void laneAction(task, lane, 'accept')} disabled={busyRunId === laneRun.id}>
                                          <Check size={14} aria-hidden="true" /> {t('tasks.acceptLane')}
                                        </button>
                                        <button className="secondary-button" type="button" onClick={() => void laneAction(task, lane, 'reject')} disabled={busyRunId === laneRun.id}>
                                          <X size={14} aria-hidden="true" /> {t('tasks.rejectLane')}
                                        </button>
                                      </>
                                    ) : null}
                                    {lane.status === 'done' && !finalLane && laneRun ? (
                                      <button className="secondary-button" type="button" title={t('tasks.finalLaneHint')} onClick={() => void selectFinalLane(task, lane)} disabled={busyRunId === laneRun.id}>
                                        {t('tasks.selectFinalLane')}
                                      </button>
                                    ) : null}
                                  </span>
                                  {lane.error ? <small>{lane.error}</small> : null}
                                </div>
                              );
                            })}
                          </div>
                          {result.conflicts.length > 0 && (
                            <div className="fanout-notes">
                              <strong>{t('tasks.conflictsTitle')}</strong>
                              <ul>{result.conflicts.map(conflict => <li key={conflict.file}>{conflict.file} — {conflict.roleIds.join(', ')}</li>)}</ul>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {budgetByTask[task.id] && (() => {
                      const status = budgetByTask[task.id];
                      const scopes = configuredBudgetScopes(status);
                      return (
                        <div className="budget-panel">
                          <div className="budget-head">
                            <strong>{t('tasks.budgetTitle')}</strong>
                          </div>
                          {scopes.length === 0 ? (
                            <p className="budget-empty">{t('tasks.budgetNone')}</p>
                          ) : (
                            <div className="budget-scopes">
                              {scopes.map(scope => (
                                <div className={`budget-scope${scope.exceeded ? ' exceeded' : ''}`} key={scope.scope}>
                                  <div className="budget-scope-head">
                                    <strong>{scope.scope === 'role' ? t('tasks.role') : t('tasks.team')}</strong>
                                    <span className="budget-scope-id">{scope.scopeId}</span>
                                    {scope.exceeded && <span className="budget-exceeded">{t('tasks.budgetExceeded')}</span>}
                                  </div>
                                  <div className="budget-table">
                                    <div className="budget-row budget-row-head">
                                      <span aria-hidden="true" />
                                      <span>{t('tasks.budgetSpend')}</span>
                                      <span>{t('tasks.budgetLimit')}</span>
                                    </div>
                                    {budgetRows(scope).map(row => (
                                      <div className="budget-row" key={row.label}>
                                        <span>{row.label}</span>
                                        <span>{row.spend}</span>
                                        <span>{row.limit}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
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
                                {run.status === 'failed' && (
                                  <>
                                    <button className="secondary-button" type="button" onClick={() => void runAction(run, 'execute')} disabled={busyRunId === run.id || executingRunId === run.id}>
                                      <RotateCcw size={14} aria-hidden="true" /> {t('common.retry')}
                                    </button>
                                    <button className="secondary-button" type="button" onClick={() => void runAction(run, 'execute', undefined, 'keep')} disabled={busyRunId === run.id || executingRunId === run.id}>
                                      {t('tasks.retryKeep')}
                                    </button>
                                    <button className="secondary-button" type="button" onClick={() => void runAction(run, 'execute', undefined, 'fresh')} disabled={busyRunId === run.id || executingRunId === run.id}>
                                      {t('tasks.retryFresh')}
                                    </button>
                                  </>
                                )}
                                {run.status === 'running' && (
                                  <button className="secondary-button" type="button" onClick={() => void cancelRun(run)} disabled={busyRunId === run.id}>
                                    <Square size={14} aria-hidden="true" /> {busyRunId === run.id ? t('tasks.cancelling') : t('tasks.cancel')}
                                  </button>
                                )}
                                {run.status === 'review' && (
                                  <>
                                    <button
                                      className="secondary-button"
                                      type="button"
                                      onClick={() => void runAction(run, 'accept', changedFilesFor(run).length ? selectedFilesFor(run) : undefined)}
                                      disabled={busyRunId === run.id || (changedFilesFor(run).length > 0 && selectedFilesFor(run).length === 0)}
                                    >
                                      <Check size={14} aria-hidden="true" /> {t('tasks.acceptSelected')}
                                      {changedFilesFor(run).length > 0 ? ` (${selectedFilesFor(run).length}/${changedFilesFor(run).length})` : ''}
                                    </button>
                                    <button className="secondary-button" type="button" onClick={() => void runAction(run, 'reject')} disabled={busyRunId === run.id}>
                                      <X size={14} aria-hidden="true" /> {t('tasks.reject')}
                                    </button>
                                  </>
                                )}
                              </span>
                            </div>

                            {(run.roleId || run.runtimeId || run.commitSha || run.runtimeVersion || run.inputTokens != null || run.outputTokens != null || run.costUsd != null) && (
                              <div className="run-evidence-meta run-identity">
                                <span>{t('tasks.role')}: {run.roleId ?? '—'}</span>
                                <span>{t('tasks.runtime')}: {run.runtimeId ?? '—'}</span>
                                <span>{t('tasks.version')}: {run.runtimeVersion ?? '—'}</span>
                                <span>{t('tasks.commit')}: {run.commitSha ? run.commitSha.slice(0, 10) : '—'}</span>
                                {run.laneId && <span>{t('tasks.lane')}: {run.laneId}</span>}
                                <span>{t('tasks.tokens')}: {run.inputTokens ?? '—'} / {run.outputTokens ?? '—'}</span>
                                <span>{t('tasks.cost')}: {run.costUsd != null ? `$${run.costUsd.toFixed(4)}` : '—'}</span>
                              </div>
                            )}

                            {run.handoff && (
                              <div className="run-evidence-meta run-handoff">
                                <span>{t('tasks.handoff')}: {run.handoff.fromStepId} → {run.handoff.toStepId}</span>
                                <span>{t('tasks.commit')}: {run.handoff.fromCommitSha.slice(0, 10)}</span>
                                <span>{t('tasks.changedFiles')}: {run.handoff.artifacts.length}</span>
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
                                  run.status === 'review' ? (
                                    <div className="run-file-picker">
                                      <h4>{t('tasks.filesToAccept')}</h4>
                                      {run.artifacts.changedFiles.map(file => (
                                        <label className="run-file-row" key={file}>
                                          <input
                                            type="checkbox"
                                            checked={selectedFilesFor(run).includes(file)}
                                            onChange={() => toggleRunFile(run, file)}
                                          />
                                          <span>{file}</span>
                                        </label>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="run-evidence-files">{run.artifacts.changedFiles.join(', ')}</p>
                                  )
                                ) : null}
                                {run.command ? (
                                  <>
                                    <h4>{t('tasks.command')}</h4>
                                    <pre className="run-evidence-pre">{run.command}</pre>
                                  </>
                                ) : null}
                                <h4>{t('tasks.toolAudit')}</h4>
                                {(run.artifacts?.toolCalls?.length ?? 0) > 0 ? (
                                  <ul className="run-tool-list">
                                    {run.artifacts?.toolCalls?.map(call => (
                                      <li key={`${call.name}-${call.status}-${call.reason ?? ''}`}>
                                        <span>{call.name}</span>
                                        <span className={`state ${call.status === 'denied' ? 'failed' : call.status === 'ok' ? 'done' : 'queued'}`}>
                                          {t(`tasks.toolStatus.${call.status}` as KeyPath)}
                                        </span>
                                        {call.reason && <small>{call.reason}</small>}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="run-evidence-note">{run.artifacts?.toolAudit?.reason ?? t('tasks.toolAuditUnknown')}</p>
                                )}
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
