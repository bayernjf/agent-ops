import type { CostBudget } from '../types';

/** Parse one budget input; empty, non-numeric or non-positive values mean "no limit". */
function numberOrUndefined(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** Build the API budget object from the three form inputs; undefined when nothing is set. */
export function budgetFromForm(cost: string, inputTokens: string, outputTokens: string): CostBudget | undefined {
  const budget: CostBudget = {};
  const maxCostUsd = numberOrUndefined(cost);
  const maxInputTokens = numberOrUndefined(inputTokens);
  const maxOutputTokens = numberOrUndefined(outputTokens);
  if (maxCostUsd !== undefined) budget.maxCostUsd = maxCostUsd;
  if (maxInputTokens !== undefined) budget.maxInputTokens = Math.round(maxInputTokens);
  if (maxOutputTokens !== undefined) budget.maxOutputTokens = Math.round(maxOutputTokens);
  return Object.keys(budget).length > 0 ? budget : undefined;
}

/** Seed the three form inputs from a stored budget. */
export function budgetToForm(budget?: CostBudget): { cost: string; inputTokens: string; outputTokens: string } {
  return {
    cost: budget?.maxCostUsd !== undefined ? String(budget.maxCostUsd) : '',
    inputTokens: budget?.maxInputTokens !== undefined ? String(budget.maxInputTokens) : '',
    outputTokens: budget?.maxOutputTokens !== undefined ? String(budget.maxOutputTokens) : '',
  };
}
