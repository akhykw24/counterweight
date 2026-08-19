import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ItemBank, QualityAssignment, withQualityAssignment } from "@eiai/schema";

/**
 * Constraints the justification-quality allocation must satisfy.
 *
 * These exist because the allocation is now a config file
 * (`materials/quality_assignment.json`) that anyone can edit. An edit that
 * produced an indefensible design would otherwise be caught only by someone
 * noticing, and the specific failure this guards against already happened once:
 * the analysis counted the four fillers as strong-justification items, which
 * silently made the strong side 75% accurate against the weak side's 50% and
 * reintroduced a base-rate confound the design exists to avoid.
 *
 * The maximum tolerated gap between the two cells' base rates. Zero is the only
 * defensible value while the design has two items per cell: with n = 4 per
 * quality level the accuracy rate can only be 0, 25, 50, 75 or 100 percent, so
 * any non-zero tolerance would permit a full 25-point gap.
 */
const BASE_RATE_TOLERANCE = 0;

const bank = ItemBank.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL("../../../materials/items.json", import.meta.url)), "utf8")),
);
const assignment = QualityAssignment.parse(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../../../materials/quality_assignment.json", import.meta.url)),
      "utf8",
    ),
  ),
);
const items = withQualityAssignment(bank, assignment);
const analysed = items.filter((item) => item.role === "analysed");
const fillers = items.filter((item) => item.role === "filler");

const byQuality = (quality: "strong" | "weak") =>
  analysed.filter((item) => item.assigned_justification_quality === quality);

describe("justification-quality allocation", () => {
  it("balances the analysed items across quality", () => {
    // An unbalanced within-subject factor inflates the variance of the
    // difference score that H3 is built on, and the smaller cell dominates it.
    expect(byQuality("strong")).toHaveLength(byQuality("weak").length);
    expect(analysed.length).toBeGreaterThanOrEqual(8);
  });

  it("gives both quality levels the same advice accuracy", () => {
    // The confound this rules out: a participant who discounts a weak
    // justification on normative grounds is indistinguishable from one
    // processing peripherally, unless the advice is wrong equally often in
    // both cells.
    const accuracy = (quality: "strong" | "weak") => {
      const cell = byQuality(quality);
      return cell.filter((item) => !item.is_error).length / cell.length;
    };
    expect(Math.abs(accuracy("strong") - accuracy("weak"))).toBeLessThanOrEqual(
      BASE_RATE_TOLERANCE,
    );
  });

  it("splits the planted errors evenly across quality", () => {
    const errors = (quality: "strong" | "weak") =>
      byQuality(quality).filter((item) => item.is_error).length;
    expect(errors("strong")).toBe(errors("weak"));
  });

  it("keeps every filler correct and strong", () => {
    // A filler that carried a planted error would change the error base rate it
    // exists to hold at 33%; one carrying a weak justification would be an
    // analysed item under another name.
    for (const filler of fillers) {
      expect(filler.is_error, `${filler.id}`).toBe(false);
      expect(filler.assigned_justification_quality, `${filler.id}`).toBe("strong");
    }
  });

  it("draws each quality cell from more than one sub-domain", () => {
    // A cell drawn entirely from one sub-domain would confound justification
    // quality with subject-matter familiarity.
    for (const quality of ["strong", "weak"] as const) {
      const topics = new Set(byQuality(quality).map((item) => item.topic));
      expect(topics.size, `${quality} cell topics: ${[...topics].join(", ")}`).toBeGreaterThan(1);
    }
  });

  it("holds the planted-error rate at a third of the items shown", () => {
    // 33% of twelve, not 50% of eight. This is the whole reason fillers exist,
    // and it is why they must not be folded into the quality contrast.
    const shown = items.length;
    const planted = items.filter((item) => item.is_error).length;
    expect(planted / shown).toBeCloseTo(1 / 3, 2);
  });
});
