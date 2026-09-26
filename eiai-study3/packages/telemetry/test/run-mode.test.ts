/**
 * Every event carries which kind of run produced it.
 *
 * A pilot and the real study write to the same table. Without a mark on the
 * rows themselves, telling them apart afterwards means remembering which dates
 * the pilot ran on -- and a pilot session that leaked into the analysed sample
 * would be indistinguishable from a participant. So the flag rides in the
 * envelope, on every event, rather than being recorded once at the start and
 * joined back later: a session whose opening event was lost would otherwise
 * lose its mark and default to "live", which is the wrong direction to fail in.
 *
 * Three values, not two booleans. `pilot` and `test` are not independent
 * dimensions -- they are both "not the real thing", differing only in whether
 * anyone intends to read the answers. One column says that plainly, and the
 * analysis filter is `run_mode = 'live'` rather than a conjunction someone can
 * get half right.
 */

import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createTelemetry } from "../src/recorder";
import { openWal } from "../src/wal";
import { runModeFromSearch } from "../src/run-mode";

async function recorded(runMode?: "live" | "pilot" | "test") {
  // Assert on what the transport is handed, not on what the write-ahead log
  // holds: the log empties as events are acknowledged, and what reaches the
  // transport is what reaches the database.
  const sent: { run_mode: string; type: string }[] = [];
  const sessionId = crypto.randomUUID();
  const telemetry = await createTelemetry({
    sessionId,
    wal: await openWal(sessionId),
    transport: async (events) => {
      sent.push(...(events as unknown as { run_mode: string; type: string }[]));
    },
    ...(runMode ? { runMode } : {}),
  });
  await telemetry.record("CONSENT_GIVEN", {});
  await telemetry.record("SESSION_COMPLETED", { total_duration_ms: 1 });
  await telemetry.flush();
  await telemetry.stop();
  return sent;
}

describe("the run mode is stamped on every event", () => {
  it("defaults to live, so a forgotten flag cannot mark real data as a test", async () => {
    const events = await recorded();
    expect(events.length).toBe(2);
    for (const event of events) {
      expect(event.run_mode).toBe("live");
    }
  });

  it("marks every event of a pilot session, not only the first", async () => {
    const events = await recorded("pilot");
    expect(events.length).toBeGreaterThan(1);
    for (const event of events) {
      expect(event.run_mode).toBe("pilot");
    }
  });

  it("marks a test session", async () => {
    for (const event of await recorded("test")) {
      expect(event.run_mode).toBe("test");
    }
  });
});

describe("reading the mode off the URL", () => {
  it("is live when nothing is asked for", () => {
    expect(runModeFromSearch("")).toBe("live");
    expect(runModeFromSearch("?foo=bar")).toBe("live");
  });

  it("recognises pilot=true and test=true", () => {
    expect(runModeFromSearch("?pilot=true")).toBe("pilot");
    expect(runModeFromSearch("?test=true")).toBe("test");
  });

  it("lets test win when both are given", () => {
    // A test run of the pilot flow is a real thing to want -- it is how the
    // pilot itself gets rehearsed. The more disposable label wins, because
    // mislabelling throwaway data as pilot data is the costlier mistake.
    expect(runModeFromSearch("?pilot=true&test=true")).toBe("test");
  });

  it("ignores any value other than true", () => {
    // ?pilot=1, ?pilot=yes, ?pilot= are all somebody mistyping a link. None of
    // them should quietly divert a real participant into the pilot arm.
    for (const search of ["?pilot=1", "?pilot=yes", "?pilot=", "?pilot", "?pilot=TRUE"]) {
      expect(runModeFromSearch(search), search).toBe("live");
    }
  });

  it("treats anything that is not live as the pilot flow", () => {
    // The distinction that drives behaviour: pilot and test both use the pilot
    // allocation and both see the feedback questions. Only the label differs.
    expect(runModeFromSearch("?pilot=true")).not.toBe("live");
    expect(runModeFromSearch("?test=true")).not.toBe("live");
  });
});
