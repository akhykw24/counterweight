/**
 * Resume tokens (STUDY3_SPEC_v3.md section 6).
 *
 * A session UUID in localStorage plus the persisted statechart snapshot lets a
 * participant continue at the exact item where their browser died. The WAL
 * holds the events; this holds the place.
 *
 * localStorage rather than IndexedDB because it is synchronous, which means
 * the app can decide "new session or resume?" before first paint instead of
 * flashing the eligibility screen at someone who was on item nine.
 */

const SESSION_KEY = "eiai.session_id";
const SNAPSHOT_KEY = "eiai.session_snapshot";
const COMPLETED_KEY = "eiai.session_completed";

export interface ResumeState {
  sessionId: string;
  snapshot: unknown | null;
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Storage can throw outright in a hardened or private-mode browser.
    return null;
  }
}

export function loadResume(): ResumeState | null {
  const store = storage();
  if (!store) return null;

  const sessionId = store.getItem(SESSION_KEY);
  if (!sessionId) return null;
  // A finished session must not be resumed into; the participant would land
  // back in the task loop after the debrief.
  if (store.getItem(COMPLETED_KEY) === "true") return null;

  const raw = store.getItem(SNAPSHOT_KEY);
  if (!raw) return { sessionId, snapshot: null };

  try {
    return { sessionId, snapshot: JSON.parse(raw) };
  } catch {
    // A corrupt snapshot must not strand the participant on a blank screen.
    // Losing the position is recoverable; losing the session is not.
    return { sessionId, snapshot: null };
  }
}

export function startSession(sessionId: string): void {
  const store = storage();
  if (!store) return;
  store.setItem(SESSION_KEY, sessionId);
  store.removeItem(SNAPSHOT_KEY);
  store.removeItem(COMPLETED_KEY);
}

export function saveSnapshot(snapshot: unknown): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // Quota exceeded. The session continues; only the resume position is lost.
  }
}

export function markCompleted(): void {
  const store = storage();
  store?.setItem(COMPLETED_KEY, "true");
}

export function clearResume(): void {
  const store = storage();
  if (!store) return;
  for (const key of [SESSION_KEY, SNAPSHOT_KEY, COMPLETED_KEY]) store.removeItem(key);
}
