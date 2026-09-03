import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AllocationError, SlotsExhaustedError, allocate, hashToIndex } from "../src/allocation";
import { stratumIds } from "../src/strata";
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
    const first = allocate(id, stratumIds[0]! as never);
    for (let i = 0; i < 20; i += 1) {
      expect(allocate(id, stratumIds[0]! as never)).toEqual(first);
    }
  });

  it("spreads uniformly across the sequence, so neither arm is favoured", () => {
    // Derived from the config: naming a stratum here is what made this file
    // rot silently while it was excluded from the run.
    const entries = sequence[stratumIds[0]!]!;
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

  it("covers every configured stratum", () => {
    // Derived from the config rather than naming the strata, so changing the
    // scheme does not require editing this test.
    for (const stratum of stratumIds) {
      expect(sequence[stratum], stratum).toBeDefined();
    }
    expect(Object.keys(sequence).sort()).toEqual([...stratumIds].sort());
  });
});

describe("slot exhaustion", () => {
  const stratum = stratumIds[0]!;
  const total = sequence[stratum]!.length;

  it("walks to the next free slot instead of double-booking", () => {
    // Two participants must never occupy the same position in a block: the
    // arms would drift and nothing in the log would show it.
    const first = allocate(randomUUID(), stratum as never);
    const second = allocate(
      randomUUID(),
      stratum as never,
      new Set([first.allocationSeq]),
    );
    expect(second.allocationSeq).not.toBe(first.allocationSeq);
  });

  it("reports exhaustion rather than wrapping when every slot is taken", () => {
    const everything = new Set(Array.from({ length: total }, (_, i) => i));
    expect(() => allocate(randomUUID(), stratum as never, everything)).toThrow(
      SlotsExhaustedError,
    );
  });

  it("still allocates when only the last slot is free", () => {
    const allButLast = new Set(Array.from({ length: total - 1 }, (_, i) => i));
    const result = allocate(randomUUID(), stratum as never, allButLast);
    expect(result.allocationSeq).toBe(total - 1);
    expect(result.condition).toBe(sequence[stratum]![total - 1]);
  });

  it("exhausting one stratum leaves the other open", () => {
    // Stratified recruitment finishing unevenly is the normal case, not a
    // failure: closing the whole study when one cell fills would waste the
    // participants still available in the other.
    const other = stratumIds[1];
    if (!other) return;
    const everything = new Set(Array.from({ length: total }, (_, i) => i));
    expect(() => allocate(randomUUID(), stratum as never, everything)).toThrow();
    expect(() => allocate(randomUUID(), other as never)).not.toThrow();
  });
});
