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

/**
 * Whether this browser already carries a completed session (spec v2 section
 * 8.6, criterion 5).
 *
 * Must be read *before* `startSession`, which clears the marker. That ordering
 * is the whole mechanism: the evidence of a repeat exists only in the moment
 * between arriving and starting over.
 */
export function hadCompletedSession(): boolean {
  const store = storage();
  if (!store) return false;
  return store.getItem(SESSION_KEY) !== null && store.getItem(COMPLETED_KEY) === "true";
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

/**
 * The same resume mechanism under a separate key prefix.
 *
 * The v3 study must never restore a deep-sea snapshot: a browser that ran the
 * v2 pilot still holds one, and feeding it to the v3 statechart would put the
 * participant in a state that does not exist. Separate keys make the two
 * studies' resume positions invisible to each other.
 *
 * Also holds the participant id, which -- unlike the session -- survives
 * `start()`: it is what lets a second session in the same browser be seen as
 * a repeat (v3 exclusion: repeat participation).
 */
export interface ResumeStore {
  load(): ResumeState | null;
  hadCompletedSession(): boolean;
  start(sessionId: string): void;
  save(snapshot: unknown): void;
  markCompleted(): void;
  clear(): void;
  participantId(create: () => string): string;
}

export function resumeStore(prefix: string): ResumeStore {
  const sessionKey = `${prefix}.session_id`;
  const snapshotKey = `${prefix}.session_snapshot`;
  const completedKey = `${prefix}.session_completed`;
  const participantKey = `${prefix}.participant_id`;

  return {
    load() {
      const store = storage();
      if (!store) return null;
      const sessionId = store.getItem(sessionKey);
      if (!sessionId || store.getItem(completedKey) === "true") return null;
      const raw = store.getItem(snapshotKey);
      if (!raw) return { sessionId, snapshot: null };
      try {
        return { sessionId, snapshot: JSON.parse(raw) };
      } catch {
        return { sessionId, snapshot: null };
      }
    },
    hadCompletedSession() {
      const store = storage();
      if (!store) return false;
      return store.getItem(sessionKey) !== null && store.getItem(completedKey) === "true";
    },
    start(sessionId) {
      const store = storage();
      if (!store) return;
      store.setItem(sessionKey, sessionId);
      store.removeItem(snapshotKey);
      store.removeItem(completedKey);
    },
    save(snapshot) {
      try {
        storage()?.setItem(snapshotKey, JSON.stringify(snapshot));
      } catch {
        // Quota exceeded: only the resume position is lost.
      }
    },
    markCompleted() {
      storage()?.setItem(completedKey, "true");
    },
    clear() {
      const store = storage();
      if (!store) return;
      for (const key of [sessionKey, snapshotKey, completedKey]) store.removeItem(key);
    },
    participantId(create) {
      const store = storage();
      const existing = store?.getItem(participantKey);
      if (existing) return existing;
      const fresh = create();
      try {
        store?.setItem(participantKey, fresh);
      } catch {
        // Without storage every visit is a new participant; nothing better exists.
      }
      return fresh;
    },
  };
}
