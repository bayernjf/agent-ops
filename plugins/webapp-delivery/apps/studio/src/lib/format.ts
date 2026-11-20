/** Shared display formatting for metrics surfaces. */

export function formatDuration(durationMs: number): string {
  return durationMs < 1000 ? `${durationMs} ms` : `${(durationMs / 1000).toFixed(1)} s`;
}

export function formatPercent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

export function formatCost(value: number | null): string {
  return value === null ? '—' : `$${value.toFixed(4)}`;
}
