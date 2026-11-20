/** One tool call a runtime reported, or a denial it recorded. */
export type ToolCallAudit = {
  name: string;
  status: 'ok' | 'denied' | 'unknown';
  reason: string | null;
};

/** What a run's output told us about tool usage. `unknown` means the runtime reported nothing. */
export type ToolAudit = {
  calls: ToolCallAudit[];
  source: 'runtime' | 'unknown';
  reason: string | null;
};

export const TOOL_AUDIT_LIMIT = 100;

const TOOL_CALL_TYPES = new Set(['tool_use', 'tool_call', 'function_call', 'mcp_tool_call']);

/**
 * Pull tool calls out of a runtime's output when it reports them, without pretending it always
 * does. Adapters differ: Claude Code emits `tool_use` blocks and `permission_denials` in its JSON,
 * Codex's JSON stream varies by version, and some runs print prose only. Anything we cannot read
 * is reported as `unknown` rather than guessed.
 */
export function extractToolAudit(output: string): ToolAudit {
  const calls: ToolCallAudit[] = [];
  const seen = new Set<string>();

  const push = (name: string, status: ToolCallAudit['status'], reason: string | null) => {
    const key = `${name}|${status}|${reason ?? ''}`;
    if (seen.has(key) || calls.length >= TOOL_AUDIT_LIMIT) return;
    seen.add(key);
    calls.push({ name, status, reason });
  };

  const walk = (node: unknown, depth = 0): void => {
    if (node === null || depth > 6 || calls.length >= TOOL_AUDIT_LIMIT) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;

    const record = node as Record<string, unknown>;
    const type = typeof record.type === 'string' ? record.type : '';
    const name = typeof record.name === 'string'
      ? record.name
      : typeof record.tool_name === 'string'
        ? record.tool_name
        : '';

    if (TOOL_CALL_TYPES.has(type) && name) {
      push(name, 'ok', null);
    }

    if (Array.isArray(record.permission_denials)) {
      for (const denial of record.permission_denials) {
        if (!denial || typeof denial !== 'object') continue;
        const entry = denial as Record<string, unknown>;
        const deniedName = typeof entry.tool_name === 'string'
          ? entry.tool_name
          : typeof entry.name === 'string'
            ? entry.name
            : 'unknown-tool';
        const reason = typeof entry.reason === 'string' ? entry.reason : null;
        push(deniedName, 'denied', reason);
      }
    }

    // Only follow the fields that carry nested messages, so arbitrary payloads cannot loop us.
    for (const key of ['message', 'content', 'item', 'items', 'events', 'response']) {
      if (key in record) walk(record[key], depth + 1);
    }
  };

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') || trimmed.length > 200_000) continue;
    try {
      walk(JSON.parse(trimmed));
    } catch {
      // Not a JSON line; prose and logs are expected in the same stream.
    }
  }

  // A pretty-printed single JSON document would not parse line by line; try it once as a whole.
  if (calls.length === 0 && output.trim().startsWith('{')) {
    try {
      walk(JSON.parse(output));
    } catch {
      // Still prose; fall through to `unknown`.
    }
  }

  if (calls.length > 0) return { calls, source: 'runtime', reason: null };
  return { calls: [], source: 'unknown', reason: 'The runtime output did not report tool calls.' };
}
