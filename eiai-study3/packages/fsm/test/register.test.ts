import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ConfidenceOutOfDomainError,
  REGISTER_ORDER,
  REGISTER_THRESHOLDS,
  register,
  registerFor,
  registerSlug,
  responseIdFor,
  stimulusFileFor,
} from "@eiai/fsm";
import { RegisterState, ResponseId } from "@eiai/schema";

/**
 * Property-based tests on the pure core (STUDY3_SPEC_v3.md section 5).
 *
 * The register function is small enough that example tests would look adequate
 * and would still miss the thing that matters: totality over the whole domain,
 * including the boundary values a hand-written suite always picks wrong.
 */

const confidence = () => fc.double({ min: 0, max: 100, noNaN: true });
const rank = (state: string) => REGISTER_ORDER.indexOf(state as never);

describe("register: properties", () => {
  it("is total over [0,100] — never throws, always returns a valid state", () => {
    fc.assert(
      fc.property(confidence(), (c) => {
        const state = register(c);
        expect(RegisterState.safeParse(state).success).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it("is monotone non-decreasing in confidence", () => {
    // A higher confidence must never select a *less* confident register.
    fc.assert(
      fc.property(confidence(), confidence(), (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(rank(register(lo))).toBeLessThanOrEqual(rank(register(hi)));
      }),
      { numRuns: 2000 },
    );
  });

  it("partitions the domain — every confidence maps to exactly one register", () => {
    fc.assert(
      fc.property(confidence(), (c) => {
        const state = register(c);
        const matches = [
          c < REGISTER_THRESHOLDS.lowBelow,
          c >= REGISTER_THRESHOLDS.lowBelow && c <= REGISTER_THRESHOLDS.highAbove,
          c > REGISTER_THRESHOLDS.highAbove,
        ].filter(Boolean);
        expect(matches).toHaveLength(1);
        expect(REGISTER_ORDER).toContain(state);
      }),
      { numRuns: 2000 },
    );
  });

  it("is deterministic — the same confidence always selects the same register", () => {
    fc.assert(
      fc.property(confidence(), (c) => {
        expect(register(c)).toBe(register(c));
      }),
    );
  });

  it("rejects everything outside the domain rather than clamping", () => {
    fc.assert(
      fc.property(
        // Bounds must be *excluded*, not nudged by Number.EPSILON: epsilon is
        // relative to 1.0, so `100 + Number.EPSILON` is still exactly 100.
        // The `< 0` filter is not redundant either: maxExcluded drops +0 but
        // -0 compares equal to it and slips through, and -0 is a legitimate
        // confidence that must map to LOW. fast-check found both of these.
        fc.oneof(
          fc.double({ min: -1e6, max: 0, maxExcluded: true, noNaN: true }).filter((x) => x < 0),
          fc.double({ min: 100, max: 1e6, minExcluded: true, noNaN: true }),
          fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
        ),
        (bad) => {
          expect(() => register(bad)).toThrow(ConfidenceOutOfDomainError);
        },
      ),
      { numRuns: 1000 },
    );
  });
});

describe("register: boundaries", () => {
  // Spec wording is "LOW < 40, MODERATE 40-70, HIGH > 70", so both endpoints of
  // the moderate band are inclusive. These are the cases an off-by-one breaks.
  it.each([
    [-0, "LOW"],
    [0, "LOW"],
    [39, "LOW"],
    [39.999999, "LOW"],
    [40, "MODERATE"],
    [55, "MODERATE"],
    [70, "MODERATE"],
    [70.000001, "HIGH"],
    [71, "HIGH"],
    [100, "HIGH"],
  ])("register(%s) === %s", (input, expected) => {
    expect(register(input as number)).toBe(expected);
  });
});

describe("registerFor: the neutral condition does not branch", () => {
  it("always returns null for neutral, at every confidence", () => {
    fc.assert(
      fc.property(confidence(), (c) => {
        expect(registerFor("neutral", c)).toBeNull();
      }),
      { numRuns: 1000 },
    );
  });

  it("returns the branching register for warm", () => {
    fc.assert(
      fc.property(confidence(), (c) => {
        expect(registerFor("warm", c)).toBe(register(c));
      }),
      { numRuns: 1000 },
    );
  });

  it("validates confidence in the neutral arm too, not just the warm one", () => {
    // Otherwise a bad confidence would only be caught for half the sample.
    expect(() => registerFor("neutral", 101)).toThrow(ConfidenceOutOfDomainError);
  });
});

describe("response id construction", () => {
  it("always produces an id the schema accepts", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("kk", "ru", "en"),
        confidence(),
        fc.integer({ min: 1, max: 12 }),
        fc.constantFrom("warm", "neutral"),
        (lang, c, itemNo, condition) => {
          const itemId = `item_${String(itemNo).padStart(2, "0")}`;
          const state = registerFor(condition as "warm" | "neutral", c);
          const id = responseIdFor(lang as "kk", condition as "warm", state, itemId);
          expect(ResponseId.safeParse(id).success).toBe(true);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("round-trips: the id encodes exactly the inputs that built it", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("kk", "ru", "en"),
        confidence(),
        fc.integer({ min: 1, max: 12 }),
        (lang, c, itemNo) => {
          const itemId = `item_${String(itemNo).padStart(2, "0")}`;
          const state = registerFor("warm", c);
          const id = responseIdFor(lang as "kk", "warm", state, itemId);
          expect(id).toBe(`${lang}_warm_${registerSlug(state)}_${itemId}`);
        },
      ),
    );
  });

  it("refuses a neutral id carrying a register, and a warm id missing one", () => {
    expect(() => responseIdFor("en", "neutral", "LOW", "item_01")).toThrow();
    expect(() => responseIdFor("en", "warm", null, "item_01")).toThrow();
  });

  it("names the 12 stimulus files the generator writes", () => {
    const files = new Set<string>();
    for (const lang of ["kk", "ru", "en"] as const) {
      for (const state of ["LOW", "MODERATE", "HIGH"] as const) {
        files.add(stimulusFileFor(lang, "warm", state));
      }
      files.add(stimulusFileFor(lang, "neutral", null));
    }
    expect(files.size).toBe(12);
    expect(files).toContain("en_warm_low.json");
    expect(files).toContain("kk_neutral_na.json");
  });
});
