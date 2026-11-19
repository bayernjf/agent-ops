const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * `fetch` for the Studio daemon API with a hard timeout.
 *
 * Every request previously relied on the browser's default (no timeout), so a
 * daemon that accepted the TCP connection and then stalled left the spinner up
 * forever with no error to report (review 2026-11-02 P3-2). The caller's own
 * signal is kept and composed with ours so cancellation still works.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
}

/**
 * Streaming requests (SSE over fetch) must not inherit the 15-second API timeout.
 * The dev proxy still attaches the daemon bearer token server-side; the caller owns
 * cancellation through its own AbortSignal.
 */
export function apiStreamFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, init);
}
