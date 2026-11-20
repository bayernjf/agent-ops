import { useCallback, useEffect, useState } from 'react';
import { Gauge, RefreshCw } from 'lucide-react';
import { useI18n } from '../i18n/i18n';
import { apiFetch } from '../lib/api';
import type { KernelMetrics } from '../types';

function formatDuration(durationMs: number): string {
  return durationMs < 1000 ? `${durationMs} ms` : `${(durationMs / 1000).toFixed(1)} s`;
}

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

function formatCost(value: number | null): string {
  return value === null ? '—' : `$${value.toFixed(4)}`;
}

/**
 * Aggregated kernel metrics: success, rework, usage and timing across tasks and runs, plus
 * per-runtime and per-role breakdowns. It reads `/api/metrics`, which never writes anything.
 */
export function MetricsView() {
  const { t } = useI18n();
  const [metrics, setMetrics] = useState<KernelMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadMetrics = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch('/api/metrics');
      const payload = (await response.json().catch(() => null)) as (KernelMetrics & { error?: string }) | null;
      if (!response.ok) throw new Error((payload as { error?: string } | null)?.error ?? t('metrics.load'));
      setMetrics(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('metrics.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void loadMetrics(); }, [loadMetrics]);

  return (
    <section className="metrics-view" aria-label={t('metrics.title')}>
      <div className="dashboard-content">
        <div className="section-heading">
          <div>
            <h2><Gauge size={18} aria-hidden="true" /> {t('metrics.title')}</h2>
            <p>{t('metrics.description')}</p>
          </div>
          <div className="metrics-actions">
            <button className="icon-button" type="button" onClick={() => void loadMetrics()} aria-label={t('common.refresh')} title={t('common.refresh')}><RefreshCw size={18} /></button>
          </div>
        </div>

        {error && <p className="error">{error}</p>}

        {loading ? (
          <p className="empty-state">{t('metrics.loading')}</p>
        ) : metrics ? (
          <>
            <div className="metric-grid">
              <div className="metric-card">
                <span>{t('metrics.successRate')}</span>
                <strong>{formatPercent(metrics.runs.successRate)}</strong>
                <small>{t('metrics.executedNote').replace('{executed}', String(metrics.runs.executed))}</small>
              </div>
              <div className="metric-card">
                <span>{t('metrics.runs')}</span>
                <strong>{metrics.runs.total}</strong>
                <small>{t('metrics.runsNote').replace('{succeeded}', String(metrics.runs.succeeded)).replace('{failed}', String(metrics.runs.failed)).replace('{cancelled}', String(metrics.runs.cancelled))}</small>
              </div>
              <div className="metric-card">
                <span>{t('metrics.tasks')}</span>
                <strong>{metrics.tasks.total}</strong>
                <small>{t('metrics.tasksNote').replace('{done}', String(metrics.tasks.done)).replace('{open}', String(metrics.tasks.open))}</small>
              </div>
              <div className="metric-card">
                <span>{t('metrics.rework')}</span>
                <strong>{formatPercent(metrics.rework.reworkRate)}</strong>
                <small>{t('metrics.reworkNote').replace('{retries}', String(metrics.rework.retries)).replace('{rejections}', String(metrics.rework.rejections))}</small>
              </div>
              <div className="metric-card">
                <span>{t('metrics.cost')}</span>
                <strong>{formatCost(metrics.usage.costUsd)}</strong>
                <small>{metrics.usage.reportingRuns > 0 ? t('metrics.costNote').replace('{runs}', String(metrics.usage.reportingRuns)) : t('metrics.notReported')}</small>
              </div>
              <div className="metric-card">
                <span>{t('metrics.avgDuration')}</span>
                <strong>{metrics.timing.averageDurationMs === null ? '—' : formatDuration(metrics.timing.averageDurationMs)}</strong>
                <small>{t('metrics.totalDuration')}: {formatDuration(metrics.timing.totalDurationMs)}</small>
              </div>
            </div>

            {metrics.tasks.total === 0 && metrics.runs.total === 0 ? (
              <p className="empty-state">{t('metrics.empty')}</p>
            ) : (
              <div className="metric-tables">
                <div className="metric-table-block">
                  <h3>{t('metrics.byRuntime')}</h3>
                  <div className="metric-table" role="table" aria-label={t('metrics.byRuntime')}>
                    <div className="metric-head" role="row">
                      <span>{t('metrics.runtimeCol')}</span>
                      <span>{t('metrics.runs')}</span>
                      <span>{t('metrics.succeededCol')}</span>
                      <span>{t('metrics.failedCol')}</span>
                      <span>{t('metrics.durationCol')}</span>
                      <span>{t('metrics.costCol')}</span>
                    </div>
                    {metrics.byRuntime.map(bucket => (
                      <div className="metric-row" role="row" key={bucket.runtimeId}>
                        <span>{bucket.runtimeId}</span>
                        <span>{bucket.runs}</span>
                        <span>{bucket.succeeded}</span>
                        <span>{bucket.failed + bucket.cancelled}</span>
                        <span>{formatDuration(bucket.durationMs)}</span>
                        <span>{formatCost(bucket.costUsd)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="metric-table-block">
                  <h3>{t('metrics.byRole')}</h3>
                  <div className="metric-table" role="table" aria-label={t('metrics.byRole')}>
                    <div className="metric-head metric-head-role" role="row">
                      <span>{t('metrics.roleCol')}</span>
                      <span>{t('metrics.runs')}</span>
                      <span>{t('metrics.succeededCol')}</span>
                      <span>{t('metrics.failedCol')}</span>
                      <span>{t('metrics.durationCol')}</span>
                    </div>
                    {metrics.byRole.map(bucket => (
                      <div className="metric-row metric-row-role" role="row" key={bucket.roleId}>
                        <span>{bucket.roleId}</span>
                        <span>{bucket.runs}</span>
                        <span>{bucket.succeeded}</span>
                        <span>{bucket.failed + bucket.cancelled}</span>
                        <span>{formatDuration(bucket.durationMs)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
    </section>
  );
}
