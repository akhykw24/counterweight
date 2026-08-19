import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ItemBank, QualityAssignment, withQualityAssignment, type ItemRecord } from "@eiai/schema";

/**
 * The item bank is study apparatus, not configuration. A malformed bank should
 * fail the build, not a pilot session.
 */

const ITEMS_PATH = fileURLToPath(
  new URL("../../../materials/items.json", import.meta.url),
);

const ASSIGNMENT_PATH = fileURLToPath(
  new URL("../../../materials/quality_assignment.json", import.meta.url),
);

const raw: unknown = JSON.parse(readFileSync(ITEMS_PATH, "utf8"));
const parsed = ItemBank.safeParse(raw);
const assignmentRaw: unknown = JSON.parse(readFileSync(ASSIGNMENT_PATH, "utf8"));
const assignmentParsed = QualityAssignment.safeParse(assignmentRaw);

/** Items with quality and role merged in, as every consumer sees them. */
const assigned =
  parsed.success && assignmentParsed.success
    ? withQualityAssignment(parsed.data, assignmentParsed.data)
    : [];

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

describe("materials/items.json", () => {
  it("validates against the ItemBank schema", () => {
    if (!parsed.success) {
      throw new Error(
        `items.json failed validation:\n${JSON.stringify(parsed.error.issues, null, 2)}`,
      );
    }
    expect(parsed.success).toBe(true);
  });
});

describe("item bank contents", () => {
  const bank = parsed.success ? parsed.data : null;
  const items: ItemRecord[] = bank?.items ?? [];

  it("holds exactly 12 items with contiguous ids and matching indices", () => {
    expect(items).toHaveLength(12);
    items.forEach((item, i) => {
      expect(item.id).toBe(`item_${String(i + 1).padStart(2, "0")}`);
      expect(item.index).toBe(i + 1);
    });
  });

  it("plants exactly 4 errors, at the item ids the spec names", () => {
    const errors = items.filter((item) => item.is_error).map((item) => item.id);
    expect(errors).toEqual(["item_03", "item_05", "item_09", "item_11"]);
  });

  it("keeps advice equal to truth on correct items and different on error items", () => {
    for (const item of items) {
      if (item.is_error) {
        expect(item.advice_value, `${item.id} is an error item`).not.toBe(item.true_value);
      } else {
        expect(item.advice_value, `${item.id} is a correct item`).toBe(item.true_value);
      }
    }
  });

  it("makes every planted error a large downward deviation, per the calibration rule", () => {
    for (const item of items.filter((i) => i.is_error)) {
      expect(item.advice_value, `${item.id} must understate`).toBeLessThan(item.true_value);
      const deviation = Math.abs(item.advice_value - item.true_value) / Math.abs(item.true_value);
      expect(deviation, `${item.id} deviation`).toBeGreaterThan(0.5);
    }
  });

  it("matches the design-cell allocation in the spec", () => {
    const byCell: Record<string, string[]> = {};
    for (const item of assigned) {
      (byCell[item.design_cell] ??= []).push(item.id);
    }
    expect(byCell["error_weak"]).toEqual(["item_03", "item_09"]);
    expect(byCell["error_strong"]).toEqual(["item_05", "item_11"]);
    expect(byCell["correct_weak"]).toEqual(["item_02", "item_07"]);
    expect(byCell["correct_strong"]).toEqual(["item_04", "item_10"]);
    expect(byCell["correct_filler"]).toEqual(["item_01", "item_06", "item_08", "item_12"]);
  });

  it("derives design_cell so it cannot contradict the assignment", () => {
    for (const item of assigned) {
      if (item.role === "filler") {
        expect(item.design_cell, `${item.id}`).toBe("correct_filler");
        expect(item.is_error, `${item.id} filler must be correct`).toBe(false);
        continue;
      }
      const expectedError = item.design_cell.startsWith("error_");
      expect(item.is_error, `${item.id}`).toBe(expectedError);
      expect(item.design_cell.endsWith("_weak"), `${item.id}`).toBe(
        item.assigned_justification_quality === "weak",
      );
    }
  });

  it("validates materials/quality_assignment.json against its schema", () => {
    if (!assignmentParsed.success) {
      throw new Error(JSON.stringify(assignmentParsed.error.issues, null, 2));
    }
    expect(Object.keys(assignmentParsed.data.assignment)).toHaveLength(12);
  });
});

describe("justification pairs", () => {
  const items: ItemRecord[] = parsed.success ? parsed.data.items : [];

  it("declares word counts that match the actual text", () => {
    // Catches the realistic failure: someone edits a justification and forgets
    // to update the count the matching guarantee is computed from.
    for (const item of items) {
      for (const quality of ["strong", "weak"] as const) {
        const justification = item.justifications[quality];
        expect(
          justification.word_count,
          `${item.id}.${quality} declares ${justification.word_count} but text has ${wordCount(justification.text)}`,
        ).toBe(wordCount(justification.text));
      }
    }
  });

  it("matches strong and weak within 2 words on every item", () => {
    for (const item of items) {
      const delta = Math.abs(
        wordCount(item.justifications.strong.text) - wordCount(item.justifications.weak.text),
      );
      expect(delta, `${item.id} word-count delta`).toBeLessThanOrEqual(2);
    }
  });

  it("gives every item both variants, so quality can be counterbalanced later", () => {
    for (const item of items) {
      expect(item.justifications.strong.text.length).toBeGreaterThan(0);
      expect(item.justifications.weak.text.length).toBeGreaterThan(0);
      expect(item.justifications.strong.text).not.toBe(item.justifications.weak.text);
    }
  });

  it("keeps justifications free of digits, so no factual content rides along", () => {
    // Only reasoning quality may vary between the pair. A number in either
    // variant would be additional content, not a difference in support.
    for (const item of items) {
      for (const quality of ["strong", "weak"] as const) {
        expect(
          item.justifications[quality].text,
          `${item.id}.${quality} contains a digit`,
        ).not.toMatch(/\d/);
      }
    }
  });
});

describe("sourcing", () => {
  const items: ItemRecord[] = parsed.success ? parsed.data.items : [];

  it("cites at least one source per item", () => {
    for (const item of items) {
      expect(item.sources.length, `${item.id}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("records every unresolved flag in review_required", () => {
    const bank = parsed.success ? parsed.data : null;
    if (!bank) return;
    const flagged = new Set(bank.items.filter((i) => i.flags.length > 0).map((i) => i.id));
    // Entries with a null item_id concern the bank as a whole rather than any
    // one item, so they are outside this correspondence by construction.
    const listed = new Set(
      bank.review_required.map((r) => r.item_id).filter((id): id is string => id !== null),
    );
    expect([...flagged].sort()).toEqual([...listed].sort());
  });

  it("keeps bank-level findings, which belong to no single item", () => {
    const bank = parsed.success ? parsed.data : null;
    if (!bank) return;
    const bankLevel = bank.review_required.filter((r) => r.item_id === null);
    // The 8 strong / 4 weak split is recorded here rather than against an
    // arbitrary item. It costs power on H3 without threatening validity, so it
    // is a decision to take before pre-registration, not a defect to fix.
    expect(bankLevel.length).toBeGreaterThanOrEqual(1);
    for (const finding of bankLevel) {
      expect(finding.summary.length).toBeGreaterThan(40);
    }
  });

  it("marks the values that move over time as volatile", () => {
    const volatile = items.filter((item) => item.volatile).map((item) => item.id);
    expect(volatile).toContain("item_02");
  });
});
