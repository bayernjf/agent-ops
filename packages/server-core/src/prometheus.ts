import type { KernelMetrics } from '@agent-ops/storage-core';

/**
 * Prometheus text rendering for the kernel's aggregate metrics.
 *
 * The kernel /api/metrics JSON surface stays the authoritative business
 * snapshot; this module re-renders the same snapshot for the Tier0 collector
 * as bounded counts only. Team/runtime/role labels are internal ids, never
 * user content, prompt text or repository paths.
 */

export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function labels(pairs: ReadonlyArray<readonly [string, string]>): string {
  if (pairs.length === 0) return '';
  return `{${pairs.map(([name, value]) => `${name}="${escapeLabelValue(value)}"`).join(',')}}`;
}

class Family {
  private readonly samples: string[] = [];

  constructor(
    private readonly name: string,
    private readonly help: string,
    private readonly type: 'gauge' | 'counter',
  ) {}

  add(value: number, pairs: ReadonlyArray<readonly [string, string]> = []): void {
    if (!Number.isFinite(value)) return;
    this.samples.push(`${this.name}${labels(pairs)} ${value}`);
  }

  render(): string {
    if (this.samples.length === 0) return '';
    return `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} ${this.type}\n${this.samples.join('\n')}\n`;
  }
}

export function renderAgentOpsMetrics(
  metrics: KernelMetrics,
  options: { uptimeSeconds?: number; capturedAt?: string } = {},
): string {
  const blocks: string[] = [];
  const push = (family: Family): void => {
    const text = family.render();
    if (text) blocks.push(text);
  };

  const up = new Family('agent_ops_up', 'Always 1 while the agent-ops daemon serves a metrics snapshot.', 'gauge');
  up.add(1);
  push(up);

  const uptime = new Family('agent_ops_uptime_seconds', 'Process uptime in seconds.', 'gauge');
  uptime.add(options.uptimeSeconds ?? Math.max(0, Math.floor(process.uptime())));
  push(uptime);

  const captured = new Family(
    'agent_ops_metrics_snapshot_timestamp_seconds',
    'Unix time the snapshot was captured; a stale value means the aggregation stopped advancing.',
    'gauge',
  );
  captured.add(Date.parse(options.capturedAt ?? metrics.generatedAt) / 1000);
  push(captured);

  const tasks = new Family('agent_ops_tasks', 'Kernel tasks, by status.', 'gauge');
  tasks.add(metrics.tasks.done, [['status', 'done']]);
  tasks.add(metrics.tasks.failed, [['status', 'failed']]);
  tasks.add(metrics.tasks.cancelled, [['status', 'cancelled']]);
  tasks.add(metrics.tasks.open, [['status', 'open']]);
  push(tasks);

  const tasksTotal = new Family('agent_ops_tasks_total', 'Total kernel tasks in the window.', 'gauge');
  tasksTotal.add(metrics.tasks.total);
  push(tasksTotal);

  const runs = new Family('agent_ops_runs', 'Kernel runs, by status.', 'gauge');
  runs.add(metrics.runs.executed, [['status', 'executed']]);
  runs.add(metrics.runs.succeeded, [['status', 'succeeded']]);
  runs.add(metrics.runs.failed, [['status', 'failed']]);
  runs.add(metrics.runs.cancelled, [['status', 'cancelled']]);
  runs.add(metrics.runs.inFlight, [['status', 'in_flight']]);
  push(runs);

  const runsTotal = new Family('agent_ops_runs_total', 'Total kernel runs in the window.', 'gauge');
  runsTotal.add(metrics.runs.total);
  push(runsTotal);

  const successRate = new Family(
    'agent_ops_runs_success_rate',
    'succeeded / executed in the window; absent when nothing executed.',
    'gauge',
  );
  successRate.add(metrics.runs.successRate ?? Number.NaN);
  push(successRate);

  const rework = new Family('agent_ops_rework', 'Rework events (retries and rejections).', 'gauge');
  rework.add(metrics.rework.retries, [['kind', 'retries']]);
  rework.add(metrics.rework.rejections, [['kind', 'rejections']]);
  push(rework);

  const usageTokens = new Family(
    'agent_ops_usage_tokens',
    'Reported model usage in tokens; absent when no run reported usage.',
    'gauge',
  );
  usageTokens.add(metrics.usage.inputTokens ?? Number.NaN, [['kind', 'input']]);
  usageTokens.add(metrics.usage.outputTokens ?? Number.NaN, [['kind', 'output']]);
  push(usageTokens);

  const usageReporting = new Family(
    'agent_ops_usage_reporting_runs',
    'Runs that reported token or cost usage.',
    'gauge',
  );
  usageReporting.add(metrics.usage.reportingRuns);
  push(usageReporting);

  const usageCost = new Family(
    'agent_ops_usage_cost_usd',
    'Reported model cost in USD; absent when no run reported usage.',
    'gauge',
  );
  usageCost.add(metrics.usage.costUsd ?? Number.NaN);
  push(usageCost);

  const timing = new Family(
    'agent_ops_timing_average_duration_ms',
    'Mean duration per executed run; absent when nothing executed.',
    'gauge',
  );
  timing.add(metrics.timing.averageDurationMs ?? Number.NaN);
  push(timing);

  const timingTotal = new Family(
    'agent_ops_timing_total_duration_ms',
    'Total duration across executed runs in the window.',
    'gauge',
  );
  timingTotal.add(metrics.timing.totalDurationMs);
  push(timingTotal);

  const byRuntime = new Family('agent_ops_runs_by_runtime', 'Runs by agent runtime and status.', 'gauge');
  for (const row of metrics.byRuntime) {
    byRuntime.add(row.succeeded, [['runtime_id', row.runtimeId], ['status', 'succeeded']]);
    byRuntime.add(row.failed, [['runtime_id', row.runtimeId], ['status', 'failed']]);
    byRuntime.add(row.cancelled, [['runtime_id', row.runtimeId], ['status', 'cancelled']]);
  }
  push(byRuntime);

  const byRole = new Family('agent_ops_runs_by_role', 'Runs by role and status.', 'gauge');
  for (const row of metrics.byRole) {
    byRole.add(row.succeeded, [['role_id', row.roleId], ['status', 'succeeded']]);
    byRole.add(row.failed, [['role_id', row.roleId], ['status', 'failed']]);
    byRole.add(row.cancelled, [['role_id', row.roleId], ['status', 'cancelled']]);
  }
  push(byRole);

  return blocks.join('\n');
}
