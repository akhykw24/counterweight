import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AllocationError, allocate, hashToIndex } from "../src/allocation";
import allocationDocument from "../../../materials/allocation.json";

const sequence = (allocationDocument as { sequence: Record<string, string[]> }).sequence;

/**
 * Condition assignment.
 *
 * The property that matters is not "it returns warm or neutral" -- almost any
 * bug still does that. It is that the assignment is *drawn from the committed
 * sequence* and that the draw is unbiased. A hash that clustered onto even
 * indices would still look perfectly random in the log and would silently skew
 * the arms, so the distribution is asserted rather than assumed.
 */

describe("allocation", () => {
  it("returns the condition the committed sequence holds at the drawn index", () => {
    for (const stratum of Object.keys(sequence)) {
      for (let i = 0; i < 50; i += 1) {
        const result = allocate(randomUUID(), stratum as never);
        expect(result.stratum).toBe(stratum);
        expect(result.allocationSeq).toBeGreaterThanOrEqual(0);
        expect(result.allocationSeq).toBeLessThan(sequence[stratum]!.length);
        expect(result.condition).toBe(sequence[stratum]![result.allocationSeq]);
      }
    }
  });

  it("is deterministic: the same session id always draws the same arm", () => {
    const id = randomUUID();
    const first = allocate(id, "ru:minor" as never);
    for (let i = 0; i < 20; i += 1) {
      expect(allocate(id, "ru:minor" as never)).toEqual(first);
    }
  });

  it("spreads uniformly across the sequence, so neither arm is favoured", () => {
    const entries = sequence["en:adult"]!;
    const buckets = new Array<number>(entries.length).fill(0);
    let warm = 0;
    const draws = 40_000;

    for (let i = 0; i < draws; i += 1) {
      const index = hashToIndex(randomUUID(), entries.length);
      buckets[index] = (buckets[index] ?? 0) + 1;
      if (entries[index] === "warm") warm += 1;
    }

    // The sequence is exactly half warm, so a uniform hash must land near 50%.
    expect(warm / draws).toBeGreaterThan(0.47);
    expect(warm / draws).toBeLessThan(0.53);
    // And no index may be unreachable: a modulus bug that skipped half the
    // sequence would still pass the ratio check above if the skipped entries
    // happened to be balanced.
    expect(buckets.filter((count) => count === 0)).toHaveLength(0);
  });

  it("throws rather than inventing an arm for an unknown stratum", () => {
    // A silent default would put a fabricated condition in the permanent log,
    // indistinguishable afterwards from a real assignment.
    expect(() => allocate(randomUUID(), "xx:adult" as never)).toThrow(AllocationError);
  });

  it("covers every stratum the study recruits", () => {
    for (const language of ["kk", "ru", "en"]) {
      for (const group of ["minor", "adult"]) {
        expect(sequence[`${language}:${group}`], `${language}:${group}`).toBeDefined();
      }
    }
  });
});
