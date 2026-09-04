/**
 * Repeat participation (spec v2 section 8.6, criterion 5).
 *
 * The criterion says a repeat is "detectable only within a browser", and the
 * browser's evidence is the completion marker left in localStorage by the first
 * session. The problem this file exists for: `startSession` clears that marker
 * when it writes the new session id, so the evidence was destroyed at exactly
 * the moment a repeat began. Criterion 5 could therefore never fire, and an
 * exclusion rule that cannot fire is worse than an absent one -- it appears in
 * the pre-registration and silently excludes nobody.
 *
 * The fix is to read the marker before it is cleared and carry the answer into
 * `SESSION_STARTED`. Nothing about the first session is retained: the flag is a
 * boolean, not a link between two sessions, because linking them would need an
 * identifier the no-PII rule forbids.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { clearResume, hadCompletedSession, markCompleted, startSession } from "../src/resume";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
});

describe("repeat participation", () => {
  it("is false for a browser that has never been here", () => {
    expect(hadCompletedSession()).toBe(false);
  });

  it("is false partway through a first session", () => {
    startSession("session-one");
    expect(hadCompletedSession()).toBe(false);
  });

  it("is true once a session has finished", () => {
    startSession("session-one");
    markCompleted();
    expect(hadCompletedSession()).toBe(true);
  });

  it("survives being read before the next session overwrites the marker", () => {
    // The ordering that makes the criterion work at all: read, then start.
    startSession("session-one");
    markCompleted();

    const repeat = hadCompletedSession();
    startSession("session-two");

    expect(repeat).toBe(true);
    expect(hadCompletedSession()).toBe(false);
  });

  it("is false again after the participant clears their browser", () => {
    startSession("session-one");
    markCompleted();
    clearResume();
    expect(hadCompletedSession()).toBe(false);
  });

  it("does not throw when storage is unavailable", () => {
    // Private mode and hardened browsers make localStorage throw on access.
    // A participant must not hit a blank screen because of a criterion that
    // only affects analysis.
    Object.defineProperty(globalThis, "localStorage", {
      get() {
        throw new Error("blocked");
      },
      configurable: true,
    });
    expect(hadCompletedSession()).toBe(false);
  });
});
