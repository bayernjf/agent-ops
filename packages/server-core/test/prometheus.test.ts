import { describe, expect, it } from 'vitest';
import type { KernelMetrics } from '@agent-ops/storage-core';
import { renderAgentOpsMetrics } from '../src/prometheus.js';

function makeMetrics(overrides: Partial<KernelMetrics> = {}): KernelMetrics {
  return {
    generatedAt: '2026-11-27T00:00:00.000Z',
    window: { since: null, until: null },
    teamId: null,
    tasks: { total: 3, done: 1, failed: 1, cancelled: 0, open: 1 },
    runs: {
      total: 4,
      executed: 3,
      succeeded: 2,
      failed: 1,
      cancelled: 0,
      inFlight: 1,
      successRate: 2 / 3,
    },
    rework: { retries: 2, rejections: 1, reworkRate: 1 },
    usage: { reportingRuns: 2, inputTokens: 100, outputTokens: 200, costUsd: 0.5 },
    timing: { totalDurationMs: 300, averageDurationMs: 100 },
    byRuntime: [
      { runtimeId: 'codex', runs: 2, succeeded: 1, failed: 1, cancelled: 0, durationMs: 200, costUsd: 0.3 },
    ],
    byRole: [
      { roleId: 'role-a', runs: 1, succeeded: 1, failed: 0, cancelled: 0, durationMs: 100 },
    ],
    ...overrides,
  };
}

describe('renderAgentOpsMetrics', () => {
  it('renders task/run/usage aggregates with bounded labels', () => {
    const text = renderAgentOpsMetrics(makeMetrics());

    expect(text).toContain('agent_ops_up 1');
    expect(text).toContain('agent_ops_tasks{status="done"} 1');
    expect(text).toContain('agent_ops_tasks_total 3');
    expect(text).toContain('agent_ops_runs{status="succeeded"} 2');
    expect(text).toContain('agent_ops_runs_total 4');
    expect(text).toContain('agent_ops_runs_success_rate 0.6666666666666666');
    expect(text).toContain('agent_ops_rework{kind="retries"} 2');
    expect(text).toContain('agent_ops_usage_tokens{kind="input"} 100');
    expect(text).toContain('agent_ops_usage_cost_usd 0.5');
    expect(text).toContain('agent_ops_timing_average_duration_ms 100');
    expect(text).toContain('agent_ops_runs_by_runtime{runtime_id="codex",status="failed"} 1');
    expect(text).toContain('agent_ops_runs_by_role{role_id="role-a",status="succeeded"} 1');
  });

  it('omits null usage/rate samples instead of emitting zero', () => {
    const text = renderAgentOpsMetrics(
      makeMetrics({
        runs: {
          total: 0,
          executed: 0,
          succeeded: 0,
          failed: 0,
          cancelled: 0,
          inFlight: 0,
          successRate: null,
        },
        usage: { reportingRuns: 0, inputTokens: null, outputTokens: null, costUsd: null },
        timing: { totalDurationMs: 0, averageDurationMs: null },
      }),
    );

    expect(text).toContain('agent_ops_up 1');
    expect(text).not.toContain('agent_ops_runs_success_rate');
    expect(text).not.toContain('agent_ops_usage_tokens');
    expect(text).not.toContain('agent_ops_usage_cost_usd');
    expect(text).not.toContain('agent_ops_timing_average_duration_ms');
  });
});
