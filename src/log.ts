/**
 * Structured logging — one function, two renderings.
 *
 * Human mode (default): the crafted prose the console has always shown.
 * JSON mode (`--json`): one JSON object per line on stderr —
 * `{"ts":"…","event":"delivery-retry","channel":"slack",…}` — so an
 * operator can grep, ship, and alert on the daemon's behavior without
 * parsing prose. Notifications themselves still go wherever their delivery
 * sends them; this is the *daemon's* telemetry, and it stays on stderr.
 */
let jsonMode = false;

export function setJsonLogs(on: boolean): void {
  jsonMode = on;
}

/**
 * Emit one event. `human` is the prose for default mode; JSON mode ignores
 * it and emits `{ts, event, ...fields}` instead.
 */
export function log(event: string, fields: Record<string, unknown>, human: string): void {
  if (jsonMode) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
  } else {
    console.error(human);
  }
}

/** JSON-only events (e.g. the per-poll heartbeat) — silent in human mode. */
export function logJson(event: string, fields: Record<string, unknown>): void {
  if (jsonMode) log(event, fields, "");
}
