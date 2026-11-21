import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Download, RefreshCw, ScrollText } from 'lucide-react';
import { useI18n } from '../i18n/i18n';
import { apiFetch } from '../lib/api';
import type { KernelAuditEvent } from '../types';

const EVENT_TYPES = [
  'role.created', 'role.updated', 'role.deleted',
  'team.created', 'team.updated', 'team.deleted',
  'task.created', 'task.deleted', 'task.final_lane.selected',
  'run.accepted', 'run.rejected', 'run.rerun',
  'pipeline.step.approved', 'pipeline.step.rejected', 'pipeline.retried', 'pipeline.rerun',
  'pipeline.planned', 'pipeline.dag.executed', 'pipeline.dag.paused', 'pipeline.dag.resumed', 'parallel.executed',
  'budget.blocked', 'handoff.recorded',
] as const;

type AuditFilters = {
  taskId: string;
  teamId: string;
  type: string;
  limit: string;
};

const initialFilters: AuditFilters = { taskId: '', teamId: '', type: '', limit: '200' };

function timestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can cancel the download in some browsers; let the click settle first.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function responseFilename(response: Response, fallback: string): string {
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  return match?.[1] ?? fallback;
}

/**
 * The kernel audit log is append-only and already served at `/api/audit`. This view exposes the
 * same filters as the API, renders the event payload inline, and exports either the currently
 * filtered audit slice or a single task's complete evidence bundle.
 */
export function AuditView() {
  const { t } = useI18n();
  const [filters, setFilters] = useState<AuditFilters>(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState<AuditFilters>(initialFilters);
  const [events, setEvents] = useState<KernelAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportingAudit, setExportingAudit] = useState(false);
  const [exportingTask, setExportingTask] = useState(false);
  const [error, setError] = useState('');

  const loadAudit = useCallback(async (current: AuditFilters) => {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams();
      for (const key of ['taskId', 'teamId', 'type', 'limit'] as const) {
        const value = current[key].trim();
        if (value) query.set(key, value);
      }
      const response = await apiFetch(`/api/audit?${query.toString()}`);
      const payload = (await response.json().catch(() => null)) as { events?: KernelAuditEvent[]; error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? t('audit.loadFailed'));
      setEvents(Array.isArray(payload?.events) ? payload.events : []);
    } catch (cause) {
      setEvents([]);
      setError(cause instanceof Error ? cause.message : t('audit.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void loadAudit(appliedFilters); }, [loadAudit, appliedFilters]);

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAppliedFilters({ ...filters });
  };

  const exportAudit = async () => {
    setExportingAudit(true);
    setError('');
    try {
      const body = JSON.stringify({
        exportedAt: new Date().toISOString(),
        filters: appliedFilters,
        count: events.length,
        events,
      }, null, 2);
      download(new Blob([body], { type: 'application/json' }), `agent-ops-audit-${new Date().toISOString().slice(0, 10)}.json`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('audit.exportFailed'));
    } finally {
      setExportingAudit(false);
    }
  };

  const exportTaskEvidence = async () => {
    const taskId = filters.taskId.trim();
    if (!taskId) {
      setError(t('audit.taskRequired'));
      return;
    }
    setExportingTask(true);
    setError('');
    try {
      const response = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/export`);
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? t('audit.exportFailed'));
      }
      const filename = responseFilename(response, `agent-ops-task-${taskId}.json`);
      download(await response.blob(), filename);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('audit.exportFailed'));
    } finally {
      setExportingTask(false);
    }
  };

  return (
    <section className="audit-view" aria-label={t('audit.title')}>
      <div className="audit-intro">
        <div>
          <div className="panel-title">
            <h2>{t('audit.title')}</h2>
            <ScrollText size={18} aria-hidden="true" />
          </div>
          <p className="audit-description">{t('audit.description')}</p>
        </div>
        <div className="audit-actions">
          <button className="secondary-button" type="button" onClick={() => void exportAudit()} disabled={loading || exportingAudit}>
            <Download size={14} aria-hidden="true" /> {exportingAudit ? t('audit.exporting') : t('audit.exportAudit')}
          </button>
          <button className="secondary-button" type="button" onClick={() => void exportTaskEvidence()} disabled={exportingTask}>
            <Download size={14} aria-hidden="true" /> {exportingTask ? t('audit.exporting') : t('audit.exportTask')}
          </button>
        </div>
      </div>

      <form className="audit-filters" onSubmit={applyFilters}>
        <label>
          <span>{t('audit.taskId')}</span>
          <input value={filters.taskId} onChange={event => setFilters(previous => ({ ...previous, taskId: event.target.value }))} placeholder={t('audit.taskIdPlaceholder')} />
        </label>
        <label>
          <span>{t('audit.teamId')}</span>
          <input value={filters.teamId} onChange={event => setFilters(previous => ({ ...previous, teamId: event.target.value }))} placeholder={t('audit.teamIdPlaceholder')} />
        </label>
        <label>
          <span>{t('audit.type')}</span>
          <select value={filters.type} onChange={event => setFilters(previous => ({ ...previous, type: event.target.value }))}>
            <option value="">{t('audit.allTypes')}</option>
            {EVENT_TYPES.map(type => <option value={type} key={type}>{type}</option>)}
          </select>
        </label>
        <label>
          <span>{t('audit.limit')}</span>
          <select value={filters.limit} onChange={event => setFilters(previous => ({ ...previous, limit: event.target.value }))}>
            {['50', '200', '500', '1000'].map(limit => <option value={limit} key={limit}>{limit}</option>)}
          </select>
        </label>
        <button className="secondary-button audit-refresh" type="submit" disabled={loading}>
          <RefreshCw size={14} aria-hidden="true" /> {loading ? t('audit.loadingShort') : t('audit.refresh')}
        </button>
      </form>

      {error && <p className="error" role="alert">{error}</p>}
      {loading ? (
        <p className="audit-empty">{t('audit.loading')}</p>
      ) : events.length === 0 ? (
        <p className="audit-empty">{t('audit.empty')}</p>
      ) : (
        <div className="audit-results">
          <p className="audit-count">{t('audit.count', { count: events.length })}</p>
          <div className="audit-list">
            {events.map(event => (
              <details className="audit-event" key={event.id}>
                <summary>
                  <span className="audit-seq">#{event.seq}</span>
                  <span className="audit-type">{event.type}</span>
                  <time>{timestamp(event.at)}</time>
                </summary>
                <div className="audit-meta">
                  <span>{t('audit.eventActor')}: {event.actor === 'system' ? t('audit.system') : t('audit.operator')}</span>
                  <span>{t('audit.eventTask')}: {event.taskId ?? '—'}</span>
                  <span>{t('audit.eventTeam')}: {event.teamId ?? '—'}</span>
                </div>
                <pre>{JSON.stringify(event.data, null, 2)}</pre>
              </details>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
