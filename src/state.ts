/**
 * Persistent watch state — the cursor file that makes restarts safe.
 *
 * Without it, a restart re-baselines and silently swallows everything that
 * happened while the process was down — the worst failure mode a
 * notification tool can have. With it, a restart CATCHES UP: the watcher
 * resumes from the last consensus timestamp it notified about, per account.
 *
 * The file is plain JSON (`{ version, entries: { "<id>": "<value>" } }` — cursor timestamps for the
 * account watcher, balance snapshots for the token watcher),
 * written atomically (temp file + rename) after every poll that advanced a
 * cursor, so a crash mid-write can never corrupt the previous good state.
 *
 * Failure bias is deliberate: if the file can't be READ, loading throws with
 * a clear message (the operator decides — fix it or delete it to
 * re-baseline) rather than silently starting fresh and losing the catch-up
 * guarantee. If it can't be WRITTEN, the poll that tried throws (the watch
 * loop logs it and keeps running); the cursor stays behind, which on the
 * next restart means duplicate notifications rather than missed ones —
 * at-least-once is the right bias for notifications.
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * MIGRATION POLICY (for whoever bumps this): new code MUST read every older
 * version and migrate it in place — an operator's state file bricking on
 * upgrade destroys the exact catch-up guarantee this module exists for.
 * Hard-reject only files NEWER than we know (a downgrade), with a message
 * saying so. When VERSION becomes 2, `loadState` grows a
 * `if (parsed.version === 1) migrate…` branch, not a rejection.
 */
const VERSION = 1;

interface StateFile {
  readonly version: number;
  readonly entries: Record<string, string>;
}

/**
 * Load entries from `path`. A missing file is a normal first run (empty
 * map); an unreadable or malformed file throws — see the module doc for why
 * that is never silently ignored.
 */
export function loadState(path: string): Map<string, string> {
  let text: string;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- reading the operator's own --state path is this module's purpose
    text = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw new Error(`could not read state file ${path}: ${(err as Error).message}`, {
      cause: err,
    });
  }
  let parsed: StateFile;
  try {
    parsed = JSON.parse(text) as StateFile;
  } catch (err) {
    throw new Error(
      `state file ${path} is not valid JSON — fix it, or delete it to re-baseline ` +
        `(deleting loses catch-up for missed events)`,
      { cause: err },
    );
  }
  if (parsed.version > VERSION) {
    throw new Error(
      `state file ${path} is version ${parsed.version}, newer than this build understands ` +
        `(${VERSION}) — was the tool downgraded?`,
    );
  }
  if (parsed.version !== VERSION || typeof parsed.entries !== "object" || !parsed.entries) {
    throw new Error(`state file ${path} has an unsupported shape (expected version ${VERSION})`);
  }
  return new Map(Object.entries(parsed.entries));
}

/** Write entries to `path` atomically (temp file in the same dir + rename). */
export function saveState(path: string, entries: ReadonlyMap<string, string>): void {
  const file: StateFile = { version: VERSION, entries: Object.fromEntries(entries) };
  const tmp = join(dirname(path), `.${process.pid}.${Date.now()}.state.tmp`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- writing the operator's own --state path is this module's purpose
  writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- atomic rename of the operator's own --state path
  renameSync(tmp, path);
}

/**
 * The persistence choreography both watchers share, in one place: load the
 * map from `path` when configured (restart catch-up), mutate it during the
 * poll, and call `save()` AFTER the poll's notifications are assembled — a
 * crash between delivery and save re-delivers (at-least-once) rather than
 * losing events. Without a path everything is a cheap in-memory no-op.
 */
export interface PersistentMap {
  readonly entries: Map<string, string>;
  save(): void;
}

export function persistentMap(path?: string): PersistentMap {
  const entries = path ? loadState(path) : new Map<string, string>();
  return {
    entries,
    save(): void {
      if (path) saveState(path, entries);
    },
  };
}
