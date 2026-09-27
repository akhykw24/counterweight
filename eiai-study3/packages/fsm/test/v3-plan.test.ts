import { describe, expect, it } from "vitest";
import { v3 } from "../src/index.js";

const CLAIMS = Array.from({ length: 12 }, (_, i) => `claim_${String(i + 1).padStart(2, "0")}`);
const design: v3.Design = {
  modules: { 1: CLAIMS.slice(0, 4), 2: CLAIMS.slice(4, 8), 3: CLAIMS.slice(8, 12) },
  tasks: CLAIMS.map((claim_id, i) => ({ task_id: `T${i + 1}`, claim_id, module: Math.floor(i / 4) + 1 })),
  quizItemIds: [...Array.from({ length: 12 }, (_, i) => `Q${i + 1}`), "F1", "F2", "F3", "F4"],
  quizClaims: {},
};

const sorted = (xs: readonly string[]) => [...xs].sort();

describe("plan", () => {
  it("is fully determined by the seed", () => {
    expect(v3.makePlan(design, "A", 42)).toEqual(v3.makePlan(design, "A", 42));
  });

  it("differs between seeds", () => {
    const a = v3.makePlan(design, "A", 1);
    const b = v3.makePlan(design, "A", 2);
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b));
  });

  it("orders each module's own claims and tasks, and nothing else", () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const plan = v3.makePlan(design, "B", seed);
      [1, 2, 3].forEach((m) => {
        expect(sorted(plan.lessonOrder[m - 1]!)).toEqual(sorted(design.modules[m as 1 | 2 | 3]));
        expect(sorted(plan.taskOrder[m - 1]!)).toEqual(
          sorted(design.tasks.filter((t) => t.module === m).map((t) => t.task_id)),
        );
      });
      expect(sorted(plan.quizOrder)).toEqual(sorted(design.quizItemIds));
      for (const roles of Object.values(plan.optionOrder)) {
        expect(sorted(roles)).toEqual(["distractor", "intuitive", "lesson"]);
      }
      expect(plan.attentionPosition).toBeGreaterThanOrEqual(1);
      expect(plan.attentionPosition).toBeLessThanOrEqual(5);
    }
  });

  it("puts the attention check into module 2 only, at its drawn position", () => {
    const plan = v3.makePlan(design, "A", 7);
    expect(v3.missionScreens(plan, 1)).not.toContain(v3.ATTENTION);
    expect(v3.missionScreens(plan, 3)).not.toContain(v3.ATTENTION);
    const module2 = v3.missionScreens(plan, 2);
    expect(module2).toHaveLength(5);
    expect(module2.indexOf(v3.ATTENTION) + 1).toBe(plan.attentionPosition);
  });

  it("draws the mission order independently of the lesson order", () => {
    // If one were derived from the other, the claim sequence would match for
    // every seed. Over 200 seeds it must not.
    let same = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      const plan = v3.makePlan(design, "A", seed);
      const taskClaims = plan.taskOrder[0]!.map((t) => design.tasks.find((x) => x.task_id === t)!.claim_id);
      if (JSON.stringify(taskClaims) === JSON.stringify(plan.lessonOrder[0])) same += 1;
    }
    expect(same).toBeLessThan(40); // chance alone is 1 in 24, about 8
  });

  it("uses every attention position over many seeds", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < 200; seed += 1) seen.add(v3.makePlan(design, "A", seed).attentionPosition);
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("explanation-quality items", () => {
  it("are two strong and two weak, strong from different modules, weak from different modules, all modules covered", () => {
    for (const list of ["A", "B"] as const) {
      for (let seed = 0; seed < 300; seed += 1) {
        const items = v3.makePlan(design, list, seed).qualityItems;
        expect(new Set(items).size).toBe(4);
        const moduleOf = (c: string) => Math.floor((Number(c.slice(-2)) - 1) / 4) + 1;
        const strong = items.filter((c) => v3.versionFor(list, c) === "strong");
        const weak = items.filter((c) => v3.versionFor(list, c) === "weak");
        expect(strong).toHaveLength(2);
        expect(weak).toHaveLength(2);
        expect(new Set(strong.map(moduleOf)).size).toBe(2);
        expect(new Set(weak.map(moduleOf)).size).toBe(2);
        expect(new Set(items.map(moduleOf)).size).toBe(3);
      }
    }
  });
});
