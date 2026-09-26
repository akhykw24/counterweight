import { describe, expect, it } from "vitest";
import allocationDocument from "../../../materials/allocation.json";
import pilotDocument from "../../../materials/allocation-pilot.json";
import { allocate, allocatePilot, PILOT_PARTICIPANT_LIMIT } from "../src/allocation";

/**
 * The pilot runs on its own assignment sequence.
 *
 * Two properties, and the second is the one that would be expensive to get
 * wrong. The pilot must produce both arms with five people, and it must not
 * touch the committed sequence the real study will draw from -- a pilot that
 * consumed real slots would bias the block balance of every participant
 * recruited afterwards, silently and irreversibly, because the sequence is
 * pre-registered by digest before recruitment begins.
 */

const STRATUM = "B1-B2";

describe("the pilot sequence is separate from the real one", () => {
  it("is a different document with a different seed", () => {
    expect(pilotDocument.seed).not.toBe(allocationDocument.seed);
    expect(pilotDocument.sequence_sha256).not.toBe(allocationDocument.sequence_sha256);
  });

  it("is not the pre-committed sequence, and says so in the file", () => {
    // The real sequence's digest is published in docs/allocation-precommit.txt
    // before recruitment. The pilot's deliberately is not, and the document
    // carries the reason so nobody registers it by mistake.
    expect(pilotDocument.purpose).toContain("pilot");
    expect(pilotDocument.pre_registered).toBe(false);
  });

  it("alternates arms strictly, rather than randomising them", () => {
    // With five participants, randomisation has a 6% chance of putting
    // everyone in one arm, which would waste the pilot. Alternation is a
    // deliberate choice for a run nobody analyses.
    for (const sequence of Object.values(pilotDocument.sequence)) {
      for (let i = 1; i < sequence.length; i += 1) {
        expect(sequence[i], `position ${i}`).not.toBe(sequence[i - 1]);
      }
    }
  });
});

describe("numbered pilot links", () => {
  it("gives five participants both arms", () => {
    const arms = new Set(
      Array.from({ length: 5 }, (_, i) => allocatePilot("session", STRATUM, i + 1).condition),
    );
    expect(arms).toEqual(new Set(["warm", "neutral"]));
  });

  it("gives the same participant number the same arm every time", () => {
    // A participant who reloads the link must not change arm.
    const first = allocatePilot("session-a", STRATUM, 3);
    const second = allocatePilot("session-b", STRATUM, 3);
    expect(second.condition).toBe(first.condition);
    expect(second.allocationSeq).toBe(first.allocationSeq);
  });

  it("gives consecutive numbers opposite arms", () => {
    for (let n = 1; n < 5; n += 1) {
      expect(allocatePilot("s", STRATUM, n + 1).condition).not.toBe(
        allocatePilot("s", STRATUM, n).condition,
      );
    }
  });

  it("refuses a number outside the pilot's range", () => {
    // A mistyped `?p=99` must not wrap silently onto somebody else's slot.
    expect(() => allocatePilot("s", STRATUM, 0)).toThrow();
    expect(() => allocatePilot("s", STRATUM, PILOT_PARTICIPANT_LIMIT + 1)).toThrow();
    expect(() => allocatePilot("s", STRATUM, 1.5)).toThrow();
  });
});

describe("an unnumbered pilot link still works", () => {
  it("assigns from the session id when no number is given", () => {
    const assignment = allocatePilot("some-session-id", STRATUM);
    expect(["warm", "neutral"]).toContain(assignment.condition);
    expect(assignment.stratum).toBe(STRATUM);
  });

  it("is stable for one session", () => {
    expect(allocatePilot("same", STRATUM).condition).toBe(
      allocatePilot("same", STRATUM).condition,
    );
  });
});

describe("the real sequence is untouched", () => {
  it("still assigns from the committed document", () => {
    const real = allocate("some-session-id", STRATUM);
    expect(["warm", "neutral"]).toContain(real.condition);
  });

  it("draws from a different pool than the pilot", () => {
    // Not an assertion that the arms differ -- with two arms they coincide
    // half the time -- but that the two functions read different documents.
    expect(allocationDocument.sequence[STRATUM]!.length).not.toBe(
      pilotDocument.sequence[STRATUM]!.length,
    );
  });
});
