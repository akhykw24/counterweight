import { describe, expect, it } from "vitest";
import { v3 } from "../src/index.js";

const CLAIMS = Array.from({ length: 12 }, (_, i) => `claim_${String(i + 1).padStart(2, "0")}`);
const MODULES = { 1: CLAIMS.slice(0, 4), 2: CLAIMS.slice(4, 8), 3: CLAIMS.slice(8, 12) } as const;

describe("pilot rotation", () => {
  it("hands out EI-A, Neutral-B, EI-B, Neutral-A, then EI-A again", () => {
    expect([1, 2, 3, 4, 5].map(v3.pilotCell)).toEqual(["EI-A", "Neutral-B", "EI-B", "Neutral-A", "EI-A"]);
  });

  it("five pilot participants cover all four cells", () => {
    expect(new Set([1, 2, 3, 4, 5].map(v3.pilotCell)).size).toBe(4);
  });

  it("is the brief's sequence, the rotation three times", () => {
    expect(v3.PILOT_SEQUENCE).toHaveLength(12);
    v3.PILOT_SEQUENCE.forEach((cell, i) => expect(v3.pilotCell(i + 1)).toBe(cell));
  });

  it("keeps rotating past twelve instead of stranding a participant", () => {
    expect(v3.pilotCell(13)).toBe("EI-A");
    expect(v3.pilotCell(14)).toBe("Neutral-B");
  });

  it("refuses a position that is not a positive integer", () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => v3.pilotCell(bad)).toThrow();
  });
});

describe("lists", () => {
  it("list A: odd claims strong, even weak; list B the reverse", () => {
    CLAIMS.forEach((claim, i) => {
      const odd = (i + 1) % 2 === 1;
      expect(v3.versionFor("A", claim)).toBe(odd ? "strong" : "weak");
      expect(v3.versionFor("B", claim)).toBe(odd ? "weak" : "strong");
    });
  });

  it("gives every module two strong and two weak explanations, in both lists", () => {
    for (const list of ["A", "B"] as const) {
      for (const claims of Object.values(MODULES)) {
        const versions = claims.map((c) => v3.versionFor(list, c));
        expect(versions.filter((v) => v === "strong")).toHaveLength(2);
        expect(versions.filter((v) => v === "weak")).toHaveLength(2);
      }
    }
  });

  it("derives tone and list from the cell name", () => {
    expect([v3.toneOf("EI-A"), v3.listOf("EI-A")]).toEqual(["EI", "A"]);
    expect([v3.toneOf("Neutral-B"), v3.listOf("Neutral-B")]).toEqual(["Neutral", "B"]);
  });
});

describe("allocate", () => {
  const session = "5b1f0f7e-2f3c-4c8e-9a1d-0c2b7a6e4d11";

  it("uses the numbered link's position in a pilot run", () => {
    const result = v3.allocate({ runMode: "pilot", pilotParticipant: 3, requestedCell: null, sessionId: session });
    expect(result).toEqual({ cell: "EI-B", tone: "EI", list: "B", method: "pilot_rotation", pilotPosition: 3 });
  });

  it("honours cell= in a test run", () => {
    const result = v3.allocate({ runMode: "test", pilotParticipant: 1, requestedCell: "Neutral-A", sessionId: session });
    expect(result.cell).toBe("Neutral-A");
    expect(result.method).toBe("forced_test");
  });

  it("ignores a requested cell outside a test run", () => {
    const result = v3.allocate({ runMode: "pilot", pilotParticipant: 1, requestedCell: "Neutral-A", sessionId: session });
    expect(result.cell).toBe("EI-A");
    expect(result.method).toBe("pilot_rotation");
  });

  it("refuses to allocate a live session: the main allocation does not exist yet", () => {
    expect(() => v3.allocate({ runMode: "live", pilotParticipant: 1, requestedCell: null, sessionId: session })).toThrow(
      /main allocation/,
    );
  });

  it("falls back to a position fixed by the session, stable across calls", () => {
    const a = v3.allocate({ runMode: "pilot", pilotParticipant: null, requestedCell: null, sessionId: session });
    const b = v3.allocate({ runMode: "pilot", pilotParticipant: null, requestedCell: null, sessionId: session });
    expect(a).toEqual(b);
    expect(a.pilotPosition).toBeNull();
  });
});
