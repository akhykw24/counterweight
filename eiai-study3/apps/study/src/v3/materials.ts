import explanationsJson from "../../../../stimuli/v3/explanations.json";
import toneJson from "../../../../stimuli/v3/tone.json";
import missionJson from "../../../../stimuli/v3/mission.json";
import quizJson from "../../../../stimuli/v3/quiz.json";
import instrumentsJson from "../../../../stimuli/v3/instruments.json";
import ncs6Json from "../../../../stimuli/v3/ncs6_items.json";
import manifestJson from "../../../../stimuli/v3/manifest.json";
import type { v3 } from "@eiai/fsm";

/**
 * The approved v3 texts, as the app reads them.
 *
 * Everything here is imported from stimuli/v3/, which pipeline/stimuli_v3.py
 * derives from the verbatim appendices. No participant-facing sentence is
 * written in this directory; a screen that needs text looks it up here.
 */

export interface Explanation {
  claim_id: string;
  module: number;
  claim: string;
  version: "strong" | "weak";
  text: string;
  techniques: string[];
  evidence_type: string | null;
  core: string | null;
  flaw: string | null;
}

export interface Task {
  task_id: string;
  claim_id: string;
  module: number;
  title: string;
  situation: string;
  options: { role: "lesson" | "intuitive" | "distractor"; text: string }[];
}

export interface QuizItem {
  item_id: string;
  claim_id: string | null;
  is_filler: boolean;
  filler_truth: boolean | null;
  statement: string;
}

export interface Scale {
  min: number;
  max: number;
  low: string;
  high: string;
}

export interface NcsItem {
  item_id: string;
  text: string;
  scale?: Scale;
}

export const explanations = (explanationsJson as { explanations: Explanation[] }).explanations;
export const tone = toneJson as {
  lines: { claim_id: string; ei_line: string; neutral_line: string }[];
  transitions: Record<"start" | "after_m1" | "after_m2" | "end", { ei: string; neutral: string }>;
};
export const mission = missionJson as {
  lesson_headings: Record<string, string>;
  mission_heading_template: string;
  confidence: { prompt: string; labels: string[]; codes: number[] };
  tasks: Task[];
  attention_check: { module: number; title: string; instruction: string; options: { text: string; correct: boolean }[] };
};
export const quiz = quizJson as { heading: string; scale: Scale; items: QuizItem[] };
export const instruments = instrumentsJson;
export const ncs6Items = ncs6Json as NcsItem[];
export const STIMULI_MANIFEST_HASH = (manifestJson as { manifest_sha256: string }).manifest_sha256;

export function explanation(claimId: string, version: "strong" | "weak"): Explanation {
  const found = explanations.find((e) => e.claim_id === claimId && e.version === version);
  if (!found) throw new Error(`no ${version} explanation for ${claimId}`);
  return found;
}

/** "EI" -> "ei", "Neutral" -> "neutral": the keys the transitions are stored under. */
type ToneKey = keyof (typeof tone)["transitions"]["start"];

export function toneKey(toneName: "EI" | "Neutral"): ToneKey {
  return toneName.toLowerCase() as ToneKey;
}

/**
 * Fills the debrief's `{warm | neutral}` from the template itself: the first
 * word for the EI tone, the second for the neutral one, in the order the
 * approved sentence introduces them. Nothing here restates either word.
 */
export function fillToneChoice(text: string, toneName: "EI" | "Neutral"): string {
  return text.replace(/\{([^|}]+?) \| ([^}]+?)\}/, (_, first: string, second: string) =>
    toneName === "EI" ? first : second,
  );
}

export function toneLine(claimId: string, toneName: "EI" | "Neutral"): string {
  const line = tone.lines.find((l) => l.claim_id === claimId);
  if (!line) throw new Error(`no tone line for ${claimId}`);
  return toneName === "EI" ? line.ei_line : line.neutral_line;
}

export function task(taskId: string): Task {
  const found = mission.tasks.find((t) => t.task_id === taskId);
  if (!found) throw new Error(`no task ${taskId}`);
  return found;
}

export function quizItem(itemId: string): QuizItem {
  const found = quiz.items.find((q) => q.item_id === itemId);
  if (!found) throw new Error(`no quiz item ${itemId}`);
  return found;
}

export function missionHeading(module: number): string {
  return mission.mission_heading_template.replace("{N}", String(module));
}

/** The tutor evaluation on two screens: Nova's traits, then trust and experience. */
export const TUTOR_PAGES: string[][] = [
  instruments.tutor.items.filter((i) => i.uses_stem).map((i) => i.item_id),
  instruments.tutor.items.filter((i) => !i.uses_stem).map((i) => i.item_id),
];

/**
 * P1-P3 before the training; P4-P6 (trust in AI) after the funnel. Split by
 * id, not by position, so the texts stay exactly as approved.
 */
export const TRUST_ITEM_IDS = ["P4", "P5", "P6"];
export const PRE_ITEM_IDS = instruments.pre_measures.map((p) => p.item_id).filter((id) => !TRUST_ITEM_IDS.includes(id));
export const preMeasures = instruments.pre_measures.filter((p) => PRE_ITEM_IDS.includes(p.item_id));
export const trustMeasures = instruments.pre_measures.filter((p) => TRUST_ITEM_IDS.includes(p.item_id));
export const DEMOGRAPHICS_ITEM_IDS = instruments.demographics.map((d) => d.item_id);
/** Choice questions must be answered (each offers a way to decline); D2 is free text. */
export const DEMOGRAPHICS_REQUIRED = instruments.demographics
  .filter((d) => d.kind === "choice")
  .map((d) => d.item_id);
export const PILOT_ITEM_IDS = instruments.pilot_feedback.map((p) => p.item_id);
export const FUNNEL_ITEMS = instruments.funnel.map((f) => ({
  id: f.item_id,
  options: f.kind === "choice" && "options" in f ? (f.options as string[]) : null,
}));

export function design(): v3.Design {
  const modules = { 1: [] as string[], 2: [] as string[], 3: [] as string[] };
  for (const e of explanations) {
    if (e.version === "strong") modules[e.module as 1 | 2 | 3].push(e.claim_id);
  }
  return {
    modules,
    tasks: mission.tasks.map((t) => ({ task_id: t.task_id, claim_id: t.claim_id, module: t.module })),
    quizItemIds: quiz.items.map((q) => q.item_id),
    quizClaims: Object.fromEntries(quiz.items.map((q) => [q.item_id, q.claim_id])),
  };
}
