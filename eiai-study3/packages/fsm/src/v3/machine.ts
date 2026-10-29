import { assign, enqueueActions, setup } from "xstate";
import type { CellName, ListName, RoleName, ToneName, VersionName } from "@eiai/schema";
import { allocate, isCell, needsServerSlot, versionFor, type ServerSlot } from "./allocation.js";
import { ATTENTION, makePlan, missionScreens, seedFor, type Design, type Plan } from "./plan.js";

/**
 * The v3 participant flow (brief, step 2; docs/spec/v3/SPEC.md "Procedure").
 *
 *   consent -> screening -> pre-measures -> allocation -> Nova's introduction
 *   -> 3 x (lesson -> mission -> transition) -> quiz -> tutor evaluation
 *   -> funnel -> explanation-quality check -> NCS-6 (if any items)
 *   -> demographics -> pilot feedback (pilot links only) -> debrief
 *
 * Strictly forward. No state has a transition to an earlier one, so there is
 * nothing a back button could reach; the app additionally pins the browser's
 * history so the back button does not leave the page.
 *
 * Every event the study records is recorded *here*, by the transition that
 * gives it meaning, and never by a screen. A guard that rejects an event
 * rejects its record too, so a double click cannot write two answers: the
 * second click arrives in a state where the first one's event is not accepted.
 */

export type RunModeV3 = "live" | "pilot" | "test";

export interface V3Input {
  sessionId: string;
  participantId: string;
  runMode: RunModeV3;
  /** `pilot=true` on the link: shows the consent notice and E9. */
  pilotFlow: boolean;
  pilotParticipant: number | null;
  requestedCell: CellName | null;
  design: Design;
  /** NCS-6 item ids; empty means the screen is skipped. */
  ncsItemIds: readonly string[];
  /** Ids of the questionnaire items, in the fixed order. */
  /** P1-P3: asked before the training. */
  preItemIds: readonly string[];
  /**
   * P4-P6, trust in AI: asked after the awareness funnel, not before the
   * training. Asked first, they told participants the study was about trust
   * in AI before they had seen anything (pilot, October 2026).
   */
  trustItemIds: readonly string[];
  tutorPages: readonly (readonly string[])[];
  funnelItems: readonly FunnelItem[];
  demographicsRequired: readonly string[];
  demographicsItemIds: readonly string[];
  pilotItemIds: readonly string[];
  now?: number;
}

export interface V3Context extends Omit<V3Input, "now"> {
  startedAt: number;
  englishBand: "B1-B2" | "C1-C2-native" | null;
  cell: CellName | null;
  tone: ToneName | null;
  list: ListName | null;
  plan: Plan | null;
  module: 1 | 2 | 3;
  lessonIndex: number;
  missionIndex: number;
  quizPage: number;
  tutorPage: number;
  funnelIndex: number;
  score: number;
}

export type V3MachineEvent =
  | { type: "CONSENT" }
  | { type: "SCREEN"; age: number; englishLevel: string; studyLanguage: string }
  | {
      type: "SUBMIT_PRE";
      answers: Record<string, number | string>;
      /** The server's slot, for runs that take one (see needsServerSlot). */
      slot?: ServerSlot | null;
    }
  | { type: "CONTINUE" }
  | { type: "LESSON_CONTINUE"; dwellMs: number }
  | { type: "ANSWER_TASK"; taskId: string; role: RoleName; confidence: number; rtMs: number }
  | { type: "ANSWER_ATTENTION"; choice: string; correct: boolean; rtMs: number }
  | { type: "SUBMIT_QUIZ_PAGE"; ratings: Record<string, number> }
  | { type: "SUBMIT_TUTOR_PAGE"; answers: Record<string, number> }
  | { type: "ANSWER_FUNNEL"; itemId: string; text: string }
  | { type: "SUBMIT_QUALITY"; ratings: Record<string, number> }
  | { type: "SUBMIT_TRUST"; answers: Record<string, number> }
  | { type: "SUBMIT_NCS"; answers: Record<string, number> }
  | { type: "SUBMIT_DEMOGRAPHICS"; answers: Record<string, string> }
  | { type: "SUBMIT_PILOT"; answers: Record<string, string> }
  | { type: "WITHDRAW" };

export interface RecordParams {
  type: string;
  payload: Record<string, unknown>;
  /** Passed explicitly where the transition itself changes the cell. */
  cell?: CellName | null;
}

/**
 * One awareness-funnel question. `options` is set for a closed question,
 * which must be answered with one of them; an open one may be left blank.
 * Supplied from the approved texts, so the number and kind of questions are
 * the researcher's, not this file's.
 */
export interface FunnelItem {
  id: string;
  options: readonly string[] | null;
}

export function currentFunnelItem(context: V3Context): FunnelItem | null {
  return context.funnelItems[context.funnelIndex] ?? null;
}
export const QUIZ_PAGE_SIZE = 4;
const ELIGIBLE_LEVELS = new Set(["B1", "B2", "C1", "C2-native"]);
const STUDY_LANGUAGES = new Set(["English", "Russian", "Kazakh", "Other"]);

export function ageBandOf(age: number): "18-24" | "25-34" | "35+" {
  if (age < 25) return "18-24";
  if (age < 35) return "25-34";
  return "35+";
}

export function englishBandOf(level: string): "B1-B2" | "C1-C2-native" {
  return level === "B1" || level === "B2" ? "B1-B2" : "C1-C2-native";
}

const isRating = (value: unknown, max: number) =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max;

/** The screen a mission index points at in the current module. */
export function currentMissionScreen(context: V3Context): string | null {
  if (!context.plan) return null;
  return missionScreens(context.plan, context.module)[context.missionIndex] ?? null;
}

export function currentLessonClaim(context: V3Context): string | null {
  return context.plan?.lessonOrder[context.module - 1]?.[context.lessonIndex] ?? null;
}

export function quizPageItems(context: V3Context): string[] {
  if (!context.plan) return [];
  const start = context.quizPage * QUIZ_PAGE_SIZE;
  return context.plan.quizOrder.slice(start, start + QUIZ_PAGE_SIZE);
}

export function versionOf(context: V3Context, claimId: string): VersionName {
  if (!context.list) throw new Error("no list before allocation");
  return versionFor(context.list, claimId);
}

/**
 * `record` referenced from actions defined inside setup(), where the action
 * names are not yet part of the type. The cast is the only thing it adds.
 */
function recordAction(params: RecordParams): never {
  return { type: "record", params } as never;
}

export const v3Machine = setup({
  types: {
    context: {} as V3Context,
    events: {} as V3MachineEvent,
    input: {} as V3Input,
  },
  actions: {
    // Provided by the app, which owns the telemetry. The default does nothing
    // so the machine can be exercised on its own.
    record: (_, _params: RecordParams) => {},
    recordLesson: enqueueActions(({ context, event, enqueue }) => {
      const e = event as Extract<V3MachineEvent, { type: "LESSON_CONTINUE" }>;
      const claimId = currentLessonClaim(context);
      if (!claimId) return;
      enqueue(
        recordAction({
          type: "lesson_item",
          payload: {
            module: context.module,
            claim_id: claimId,
            version: versionOf(context, claimId),
            order_position: context.lessonIndex + 1,
            dwell_ms: Math.max(0, Math.round(e.dwellMs)),
          },
        }),
      );
    }),
    recordTask: enqueueActions(({ context, event, enqueue }) => {
      const e = event as Extract<V3MachineEvent, { type: "ANSWER_TASK" }>;
      const task = context.design.tasks.find((t) => t.task_id === e.taskId);
      if (!task || !context.plan) return;
      const position = context.plan.taskOrder[context.module - 1]!.indexOf(e.taskId) + 1;
      enqueue(
        recordAction({
          type: "mission_answer",
          payload: {
            module: context.module,
            task_id: e.taskId,
            claim_id: task.claim_id,
            version: versionOf(context, task.claim_id),
            choice_role: e.role,
            option_order: context.plan.optionOrder[e.taskId],
            order_position: position,
            confidence: e.confidence,
            rt_ms: Math.max(0, Math.round(e.rtMs)),
          },
        }),
      );
      if (e.role === "lesson") enqueue.assign({ score: context.score + 1 });
    }),
    recordAttention: enqueueActions(({ context, event, enqueue }) => {
      const e = event as Extract<V3MachineEvent, { type: "ANSWER_ATTENTION" }>;
      enqueue(
        recordAction({
          type: "attention_check",
          payload: {
            passed: e.correct,
            choice: e.choice,
            position: context.plan?.attentionPosition ?? 1,
            rt_ms: Math.max(0, Math.round(e.rtMs)),
          },
        }),
      );
    }),
    advanceMission: assign({ missionIndex: ({ context }) => context.missionIndex + 1 }),
  },
  guards: {
    screenedOutAge: ({ event }) => event.type === "SCREEN" && !(event.age >= 18),
    screenedOutLanguage: ({ event }) =>
      event.type === "SCREEN" && event.age >= 18 && !ELIGIBLE_LEVELS.has(event.englishLevel),
    screeningComplete: ({ event }) =>
      event.type === "SCREEN" &&
      Number.isInteger(event.age) &&
      event.age >= 0 &&
      event.age <= 120 &&
      (ELIGIBLE_LEVELS.has(event.englishLevel) || event.englishLevel === "A1-A2") &&
      STUDY_LANGUAGES.has(event.studyLanguage),
    preComplete: ({ context, event }) =>
      event.type === "SUBMIT_PRE" &&
      context.preItemIds.every((id) => event.answers[id] !== undefined && event.answers[id] !== "") &&
      // A run that takes its cell from the server cannot move on without it.
      (!needsServerSlot(context) ||
        (event.slot != null && isCell(event.slot.cell) && Number.isInteger(event.slot.index) && event.slot.index >= 0)),
    lastLessonMessage: ({ context }) => context.lessonIndex >= 3,
    taskMatches: ({ context, event }) =>
      event.type === "ANSWER_TASK" &&
      currentMissionScreen(context) === event.taskId &&
      ["lesson", "intuitive", "distractor"].includes(event.role) &&
      isRating(event.confidence, 4),
    attentionMatches: ({ context, event }) =>
      event.type === "ANSWER_ATTENTION" &&
      currentMissionScreen(context) === ATTENTION &&
      typeof event.choice === "string" &&
      event.choice.length > 0,
    lastMissionScreen: ({ context }) =>
      context.plan !== null &&
      context.missionIndex >= missionScreens(context.plan, context.module).length - 1,
    moreModules: ({ context }) => context.module < 3,
    quizPageComplete: ({ context, event }) =>
      event.type === "SUBMIT_QUIZ_PAGE" &&
      quizPageItems(context).every((id) => isRating(event.ratings[id], 7)),
    lastQuizPage: ({ context }) => context.quizPage >= 3,
    tutorPageComplete: ({ context, event }) =>
      event.type === "SUBMIT_TUTOR_PAGE" &&
      (context.tutorPages[context.tutorPage] ?? []).every((id) => isRating(event.answers[id], 7)),
    lastTutorPage: ({ context }) => context.tutorPage >= context.tutorPages.length - 1,
    funnelMatches: ({ context, event }) =>
      event.type === "ANSWER_FUNNEL" &&
      event.itemId === currentFunnelItem(context)?.id &&
      typeof event.text === "string" &&
      // F4 is Yes/No and must be answered; F1-F3 are optional free text.
      // A closed question needs one of its options; open ones are optional.
      (currentFunnelItem(context)?.options == null || currentFunnelItem(context)!.options!.includes(event.text)),
    qualityComplete: ({ context, event }) =>
      event.type === "SUBMIT_QUALITY" &&
      (context.plan?.qualityItems ?? []).every((id) => isRating(event.ratings[id], 7)),
    trustComplete: ({ context, event }) =>
      event.type === "SUBMIT_TRUST" && context.trustItemIds.every((id) => isRating(event.answers[id], 7)),
    hasNcs: ({ context }) => context.ncsItemIds.length > 0,
    ncsComplete: ({ context, event }) =>
      event.type === "SUBMIT_NCS" && context.ncsItemIds.every((id) => isRating(event.answers[id], 7)),
    demographicsComplete: ({ context, event }) =>
      event.type === "SUBMIT_DEMOGRAPHICS" &&
      context.demographicsRequired.every((id) => (event.answers[id] ?? "").trim().length > 0),
    pilotFlow: ({ context }) => context.pilotFlow,
  },
}).createMachine({
  id: "v3",
  context: ({ input }) => ({
    ...input,
    startedAt: input.now ?? Date.now(),
    englishBand: null,
    cell: null,
    tone: null,
    list: null,
    plan: null,
    module: 1,
    lessonIndex: 0,
    missionIndex: 0,
    quizPage: 0,
    tutorPage: 0,
    funnelIndex: 0,
    score: 0,
  }),
  initial: "consent",
  states: {
    consent: {
      on: {
        CONSENT: {
          target: "screening",
          actions: {
            type: "record",
            params: ({ context }) => ({
              type: "consent_given",
              payload: { pilot_notice_shown: context.pilotFlow },
            }),
          },
        },
      },
    },

    screening: {
      on: {
        SCREEN: [
          {
            guard: "screenedOutAge",
            target: "screenedOut",
            // Nothing about age is stored for someone turned away.
            actions: { type: "record", params: { type: "screened_out", payload: { reason: "age" } } },
          },
          {
            guard: "screenedOutLanguage",
            target: "screenedOut",
            actions: { type: "record", params: { type: "screened_out", payload: { reason: "language" } } },
          },
          {
            guard: "screeningComplete",
            target: "pre",
            actions: [
              assign({
                englishBand: ({ event }) =>
                  englishBandOf((event as Extract<V3MachineEvent, { type: "SCREEN" }>).englishLevel),
              }),
              {
                type: "record",
                params: ({ event }) => {
                  const e = event as Extract<V3MachineEvent, { type: "SCREEN" }>;
                  return {
                    type: "screening_answered",
                    payload: {
                      age_band: ageBandOf(e.age),
                      english_level: e.englishLevel,
                      study_language: e.studyLanguage,
                    },
                  };
                },
              },
            ],
          },
        ],
      },
    },

    screenedOut: { type: "final" },

    pre: {
      on: {
        SUBMIT_PRE: {
          guard: "preComplete",
          target: "intro",
          actions: [
            enqueueActions(({ context, event, enqueue }) => {
              const e = event as Extract<V3MachineEvent, { type: "SUBMIT_PRE" }>;
              for (const id of context.preItemIds) {
                enqueue({
                  type: "record",
                  params: { type: "questionnaire_item", payload: { instrument: "pre", item_id: id, value: e.answers[id] } },
                });
              }
            }),
            // Allocation happens here, after screening and the pre-measures,
            // and only here: nobody who is screened out is ever allocated.
            enqueueActions(({ context, event, enqueue }) => {
              const e = event as Extract<V3MachineEvent, { type: "SUBMIT_PRE" }>;
              const result = allocate({
                runMode: context.runMode,
                pilotParticipant: context.pilotParticipant,
                requestedCell: context.requestedCell,
                sessionId: context.sessionId,
                pilotFlow: context.pilotFlow,
                slot: e.slot ?? null,
              });
              const seed = seedFor(context.sessionId);
              const plan = makePlan(context.design, result.list, seed);
              enqueue.assign({ cell: result.cell, tone: result.tone, list: result.list, plan });
              enqueue({
                type: "record",
                params: {
                  type: "allocation",
                  cell: result.cell,
                  payload: {
                    cell: result.cell,
                    tone: result.tone,
                    list: result.list,
                    method: result.method,
                    pilot_position: result.pilotPosition,
                    english_band: context.englishBand,
                    sequence_index: result.sequenceIndex,
                  },
                },
              });
              enqueue({
                type: "record",
                params: {
                  type: "plan_generated",
                  cell: result.cell,
                  payload: {
                    seed,
                    lesson_order: plan.lessonOrder,
                    task_order: plan.taskOrder,
                    attention_position: plan.attentionPosition,
                    option_order: plan.optionOrder,
                    quiz_order: plan.quizOrder,
                    quality_items: plan.qualityItems,
                  },
                },
              });
            }),
          ],
        },
      },
    },

    intro: { on: { CONTINUE: "lesson" } },

    lesson: {
      on: {
        LESSON_CONTINUE: [
          {
            guard: "lastLessonMessage",
            target: "mission",
            actions: ["recordLesson", assign({ missionIndex: 0 })],
          },
          {
            actions: ["recordLesson", assign({ lessonIndex: ({ context }) => context.lessonIndex + 1 })],
          },
        ],
      },
    },

    mission: {
      on: {
        ANSWER_TASK: [
          {
            guard: "taskMatches",
            actions: ["recordTask", "advanceMission"],
          },
        ],
        ANSWER_ATTENTION: [
          {
            guard: "attentionMatches",
            actions: ["recordAttention", "advanceMission"],
          },
        ],
      },
      always: {
        guard: ({ context }) =>
          context.plan !== null && context.missionIndex >= missionScreens(context.plan, context.module).length,
        target: "transition",
      },
    },

    transition: {
      on: {
        CONTINUE: [
          {
            guard: "moreModules",
            target: "lesson",
            actions: assign({
              module: ({ context }) => (context.module + 1) as 1 | 2 | 3,
              lessonIndex: 0,
              missionIndex: 0,
            }),
          },
          { target: "quiz" },
        ],
      },
    },

    quiz: {
      on: {
        SUBMIT_QUIZ_PAGE: [
          {
            guard: "quizPageComplete",
            actions: [
              enqueueActions(({ context, event, enqueue }) => {
                const e = event as Extract<V3MachineEvent, { type: "SUBMIT_QUIZ_PAGE" }>;
                quizPageItems(context).forEach((id, i) => {
                  const claimId = context.design.quizClaims[id] ?? null;
                  enqueue({
                    type: "record",
                    params: {
                      type: "quiz_rating",
                      payload: {
                        item_id: id,
                        claim_id: claimId,
                        version: claimId ? versionOf(context, claimId) : null,
                        is_filler: claimId === null,
                        rating: e.ratings[id],
                        position: context.quizPage * QUIZ_PAGE_SIZE + i + 1,
                      },
                    },
                  });
                });
              }),
              assign({ quizPage: ({ context }) => context.quizPage + 1 }),
            ],
          },
        ],
      },
      // The awareness funnel comes straight after the quiz, before any
      // question that names warmth, trust or evidence: asked afterwards, F1-F3
      // would measure what those questions told the participant.
      always: { guard: ({ context }) => context.quizPage >= 4, target: "funnel" },
    },

    tutor: {
      on: {
        SUBMIT_TUTOR_PAGE: {
          guard: "tutorPageComplete",
          actions: [
            enqueueActions(({ context, event, enqueue }) => {
              const e = event as Extract<V3MachineEvent, { type: "SUBMIT_TUTOR_PAGE" }>;
              for (const id of context.tutorPages[context.tutorPage] ?? []) {
                enqueue({
                  type: "record",
                  params: { type: "questionnaire_item", payload: { instrument: "tutor", item_id: id, value: e.answers[id] } },
                });
              }
            }),
            assign({ tutorPage: ({ context }) => context.tutorPage + 1 }),
          ],
        },
      },
      always: { guard: ({ context }) => context.tutorPage >= context.tutorPages.length, target: "quality" },
    },

    funnel: {
      on: {
        ANSWER_FUNNEL: [
          {
            guard: "funnelMatches",
            actions: [
              {
                type: "record",
                params: ({ event }) => {
                  const e = event as Extract<V3MachineEvent, { type: "ANSWER_FUNNEL" }>;
                  return { type: "funnel_answer", payload: { item_id: e.itemId, text: e.text.slice(0, 5000) } };
                },
              },
              assign({ funnelIndex: ({ context }) => context.funnelIndex + 1 }),
            ],
          },
        ],
      },
      always: { guard: ({ context }) => context.funnelIndex >= context.funnelItems.length, target: "tutor" },
    },

    quality: {
      on: {
        SUBMIT_QUALITY: {
          guard: "qualityComplete",
          target: "trust",
          actions: enqueueActions(({ context, event, enqueue }) => {
            const e = event as Extract<V3MachineEvent, { type: "SUBMIT_QUALITY" }>;
            (context.plan?.qualityItems ?? []).forEach((claimId, i) => {
              enqueue({
                type: "record",
                params: {
                  type: "arg_quality_rating",
                  payload: {
                    claim_id: claimId,
                    version: versionOf(context, claimId),
                    rating: e.ratings[claimId],
                    position: i + 1,
                  },
                },
              });
            });
          }),
        },
      },
    },

    trust: {
      always: { guard: ({ context }) => context.trustItemIds.length === 0, target: "ncs" },
      on: {
        SUBMIT_TRUST: {
          guard: "trustComplete",
          target: "ncs",
          actions: enqueueActions(({ context, event, enqueue }) => {
            const e = event as Extract<V3MachineEvent, { type: "SUBMIT_TRUST" }>;
            for (const id of context.trustItemIds) {
              enqueue({
                type: "record",
                params: { type: "questionnaire_item", payload: { instrument: "trust", item_id: id, value: e.answers[id] } },
              });
            }
          }),
        },
      },
    },

    ncs: {
      always: { guard: ({ context }) => context.ncsItemIds.length === 0, target: "demographics" },
      on: {
        SUBMIT_NCS: {
          guard: "ncsComplete",
          target: "demographics",
          actions: enqueueActions(({ context, event, enqueue }) => {
            const e = event as Extract<V3MachineEvent, { type: "SUBMIT_NCS" }>;
            for (const id of context.ncsItemIds) {
              enqueue({
                type: "record",
                params: { type: "questionnaire_item", payload: { instrument: "ncs6", item_id: id, value: e.answers[id] } },
              });
            }
          }),
        },
      },
    },

    demographics: {
      on: {
        SUBMIT_DEMOGRAPHICS: [
          {
            guard: "demographicsComplete",
            target: "routeAfterDemographics",
            actions: enqueueActions(({ context, event, enqueue }) => {
              const e = event as Extract<V3MachineEvent, { type: "SUBMIT_DEMOGRAPHICS" }>;
              for (const id of context.demographicsItemIds) {
                const value = (e.answers[id] ?? "").trim();
                if (!value) continue;
                enqueue({
                  type: "record",
                  params: {
                    type: "questionnaire_item",
                    payload: { instrument: "demographics", item_id: id, value: value.slice(0, 500) },
                  },
                });
              }
            }),
          },
        ],
      },
    },

    routeAfterDemographics: {
      always: [{ guard: "pilotFlow", target: "pilotFeedback" }, { target: "debrief" }],
    },

    pilotFeedback: {
      on: {
        SUBMIT_PILOT: {
          target: "debrief",
          actions: enqueueActions(({ context, event, enqueue }) => {
            const e = event as Extract<V3MachineEvent, { type: "SUBMIT_PILOT" }>;
            for (const id of context.pilotItemIds) {
              const text = (e.answers[id] ?? "").trim();
              // A blank answer records nothing: "skipped" and "had nothing
              // to say" are different facts.
              if (!text) continue;
              enqueue({ type: "record", params: { type: "pilot_feedback", payload: { item_id: id, text: text.slice(0, 5000) } } });
            }
          }),
        },
      },
    },

    debrief: {
      entry: [
        {
          type: "record",
          params: ({ context }) => ({
            type: "session_completed",
            payload: { total_duration_ms: Math.max(0, Date.now() - context.startedAt), score: context.score },
          }),
        },
        {
          type: "record",
          params: ({ context }) => ({ type: "debrief_viewed", payload: { score: context.score } }),
        },
      ],
      on: {
        WITHDRAW: {
          target: "withdrawn",
          actions: { type: "record", params: { type: "withdrawal_requested", payload: { at_screen: "debrief" } } },
        },
      },
    },

    withdrawn: { type: "final" },
  },
});

export type V3Machine = typeof v3Machine;
