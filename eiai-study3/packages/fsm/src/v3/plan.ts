import type { ListName, RoleName } from "@eiai/schema";
import { fnv1a, versionFor } from "./allocation.js";

/**
 * Every random order a v3 participant meets, drawn once from one seed.
 *
 * Seeded from the session id, so a resumed session regenerates exactly the
 * same plan -- and the whole plan is logged (`plan_generated`), so nobody has
 * to trust that it would.
 */

export interface DesignTask {
  task_id: string;
  claim_id: string;
  module: number;
}

export interface Design {
  /** Claim ids per module, in bank order. */
  modules: Readonly<Record<1 | 2 | 3, readonly string[]>>;
  tasks: readonly DesignTask[];
  quizItemIds: readonly string[];
  /** Quiz item id -> the claim it restates, or null for a filler. */
  quizClaims: Readonly<Record<string, string | null>>;
}

export interface Plan {
  seed: number;
  /** Per module, the four claim ids in lesson order. */
  lessonOrder: readonly (readonly string[])[];
  /** Per module, the four task ids in mission order; independent of the lesson. */
  taskOrder: readonly (readonly string[])[];
  /** 1-5: where the attention check sits among module 2's mission screens. */
  attentionPosition: number;
  /** task id -> option roles in display order. */
  optionOrder: Readonly<Record<string, readonly RoleName[]>>;
  quizOrder: readonly string[];
  /** Four claims for the explanation-quality check, in display order. */
  qualityItems: readonly string[];
}

/** mulberry32: a tiny, well-mixed 32-bit generator. Returns [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const ROLES: readonly RoleName[] = ["lesson", "intuitive", "distractor"];

/**
 * Two strong and two weak explanations the participant saw, spread across
 * modules as far as four items over three modules allow: the two strong from
 * different modules, the two weak from different modules, all three modules
 * represented.
 */
export function chooseQualityItems(
  design: Design,
  list: ListName,
  random: () => number,
): string[] {
  const pairs: [number, number][] = [[1, 2], [1, 3], [2, 3]];
  const candidates: [[number, number], [number, number]][] = [];
  for (const strong of pairs) {
    for (const weak of pairs) {
      if (new Set([...strong, ...weak]).size === 3) candidates.push([strong, weak]);
    }
  }
  const [strongModules, weakModules] = candidates[Math.floor(random() * candidates.length)]!;
  const pick = (module: number, version: "strong" | "weak") => {
    const options = design.modules[module as 1 | 2 | 3].filter((c) => versionFor(list, c) === version);
    return options[Math.floor(random() * options.length)]!;
  };
  const chosen = [
    ...strongModules.map((m) => pick(m, "strong")),
    ...weakModules.map((m) => pick(m, "weak")),
  ];
  return shuffle(chosen, random);
}

export function seedFor(sessionId: string): number {
  return fnv1a(`v3-plan:${sessionId}`);
}

export function makePlan(design: Design, list: ListName, seed: number): Plan {
  const random = mulberry32(seed);
  const lessonOrder = ([1, 2, 3] as const).map((m) => shuffle(design.modules[m], random));
  const taskOrder = ([1, 2, 3] as const).map((m) =>
    shuffle(
      design.tasks.filter((t) => t.module === m).map((t) => t.task_id),
      random,
    ),
  );
  const attentionPosition = 1 + Math.floor(random() * 5);
  const optionOrder: Record<string, RoleName[]> = {};
  for (const task of design.tasks) optionOrder[task.task_id] = shuffle(ROLES, random);
  const quizOrder = shuffle(design.quizItemIds, random);
  const qualityItems = chooseQualityItems(design, list, random);
  return { seed, lessonOrder, taskOrder, attentionPosition, optionOrder, quizOrder, qualityItems };
}

/** The mission screens of one module, with the attention check placed in module 2. */
export function missionScreens(plan: Plan, module: number): string[] {
  const tasks = [...plan.taskOrder[module - 1]!];
  if (module === 2) tasks.splice(plan.attentionPosition - 1, 0, ATTENTION);
  return tasks;
}

export const ATTENTION = "ATTENTION";
