import { assign, setup } from "xstate";
import type {
  AgeBand,
  AgeGroup,
  Condition,
  Language,
  RegisterState,
  Stratum,
} from "@eiai/schema";
import { registerFor } from "./register.js";

/**
 * Session flow as a statechart (STUDY3_SPEC_v3.md section 5).
 *
 * eligibility -> consent/assent fork -> allocation -> 12 items ->
 * questionnaire -> funnel -> debrief -> done, with withdrawal reachable from
 * every screen.
 *
 * This *is* worth a statechart: the flow has a branch whose two arms have
 * different legal requirements, a repeated three-phase inner loop, and an exit
 * transition available from every state. The register function next door is
 * deliberately not one. Knowing where the line falls is the point.
 */

export interface SessionContext {
  language: Language | null;
  ageBand: AgeBand | null;
  ageGroup: AgeGroup | null;
  priorTraining: boolean | null;
  parentalConsentCode: string | null;

  condition: Condition | null;
  stratum: Stratum | null;
  allocationSeq: number | null;

  itemIds: readonly string[];
  itemIndex: number;

  initialEstimate: number | null;
  initialConfidence: number | null;
  registerState: RegisterState | null;
  finalEstimate: number | null;
  finalConfidence: number | null;

  withdrawnFrom: string | null;
}

export interface SessionInput {
  /** Presentation order, already randomised per participant by the caller. */
  itemIds?: readonly string[];
}

export const DEFAULT_ITEM_IDS: readonly string[] = Array.from(
  { length: 12 },
  (_, i) => `item_${String(i + 1).padStart(2, "0")}`,
);

export type SessionEvent =
  | { type: "SET_LANGUAGE"; language: Language }
  | { type: "SET_AGE_BAND"; ageBand: AgeBand }
  | { type: "SET_PRIOR_TRAINING"; priorTraining: boolean }
  | { type: "SUBMIT_ELIGIBILITY" }
  | { type: "SET_PARENTAL_CODE"; code: string }
  | { type: "GIVE_CONSENT" }
  | { type: "GIVE_ASSENT" }
  | { type: "ALLOCATE"; condition: Condition; stratum: Stratum; allocationSeq: number }
  | { type: "SET_ESTIMATE"; value: number }
  | { type: "SET_CONFIDENCE"; value: number }
  | { type: "SUBMIT_INITIAL" }
  | { type: "REQUEST_FINAL" }
  | { type: "SUBMIT_FINAL" }
  | { type: "SUBMIT_QUESTIONNAIRE" }
  | { type: "SUBMIT_FUNNEL" }
  | { type: "FINISH" }
  // `atState` is supplied by the caller because an action cannot read the
  // machine's own state value, and SESSION_WITHDRAWN has to record where the
  // participant left.
  | { type: "WITHDRAW"; atState: string };

const MINOR_BANDS: readonly AgeBand[] = ["14-15", "16-17"];

export function ageGroupFor(band: AgeBand): AgeGroup {
  return MINOR_BANDS.includes(band) ? "minor" : "adult";
}

export function stratumFor(language: Language, ageGroup: AgeGroup): Stratum {
  return `${language}:${ageGroup}` as Stratum;
}

/**
 * Machine factory.
 *
 * The item list is baked into the default context rather than required as
 * input, because graph traversal (`createTestModel`) instantiates the machine
 * with no input at all. It also lets the model-based test build a two-item
 * variant: with twelve items the reachable graph is large enough that
 * exhaustive path coverage stops being exhaustive in practice, and a test that
 * covers a sample of paths while claiming to cover all of them is worse than
 * one that is honest about its scope. The loop-termination guard is verified
 * separately against the real twelve.
 */
export function createSessionMachine(itemIds: readonly string[] = DEFAULT_ITEM_IDS) {
  return setup({
  types: {
    context: {} as SessionContext,
    events: {} as SessionEvent,
    // `| undefined` so the machine can be started with no input at all:
    // createTestModel instantiates it that way during graph traversal.
    input: {} as SessionInput | undefined,
  },
  guards: {
    // Screening excludes formal training in marine biology or oceanography.
    isEligible: ({ context }) =>
      context.language !== null &&
      context.ageBand !== null &&
      context.priorTraining === false,
    isMinor: ({ context }) => context.ageGroup === "minor",
    hasParentalCode: ({ context }) =>
      context.parentalConsentCode !== null && context.parentalConsentCode.trim().length > 0,
    initialComplete: ({ context }) =>
      context.initialEstimate !== null && context.initialConfidence !== null,
    finalComplete: ({ context }) =>
      context.finalEstimate !== null && context.finalConfidence !== null,
    finalCompleteWithMoreItems: ({ context }) =>
      context.finalEstimate !== null &&
      context.finalConfidence !== null &&
      context.itemIndex + 1 < context.itemIds.length,
  },
  actions: {
    setLanguage: assign(({ event }) => ({
      language: event.type === "SET_LANGUAGE" ? event.language : null,
    })),
    setAgeBand: assign(({ event }) =>
      event.type === "SET_AGE_BAND"
        ? { ageBand: event.ageBand, ageGroup: ageGroupFor(event.ageBand) }
        : {},
    ),
    setPriorTraining: assign(({ event }) => ({
      priorTraining: event.type === "SET_PRIOR_TRAINING" ? event.priorTraining : null,
    })),
    setParentalCode: assign(({ event }) => ({
      parentalConsentCode: event.type === "SET_PARENTAL_CODE" ? event.code : null,
    })),
    applyAllocation: assign(({ event }) =>
      event.type === "ALLOCATE"
        ? {
            condition: event.condition,
            stratum: event.stratum,
            allocationSeq: event.allocationSeq,
          }
        : {},
    ),
    setInitialEstimate: assign(({ event }) => ({
      initialEstimate: event.type === "SET_ESTIMATE" ? event.value : null,
    })),
    setInitialConfidence: assign(({ event }) => ({
      initialConfidence: event.type === "SET_CONFIDENCE" ? event.value : null,
    })),
    setFinalEstimate: assign(({ event }) => ({
      finalEstimate: event.type === "SET_ESTIMATE" ? event.value : null,
    })),
    setFinalConfidence: assign(({ event }) => ({
      finalConfidence: event.type === "SET_CONFIDENCE" ? event.value : null,
    })),
    /**
     * The register is selected from the INITIAL confidence, before the
     * participant has seen anything. Selecting it later would let the advice
     * influence the register that chose the advice.
     */
    selectRegister: assign(({ context }) => ({
      registerState:
        context.condition === null || context.initialConfidence === null
          ? null
          : registerFor(context.condition, context.initialConfidence),
    })),
    nextItem: assign(({ context }) => ({
      itemIndex: context.itemIndex + 1,
      initialEstimate: null,
      initialConfidence: null,
      registerState: null,
      finalEstimate: null,
      finalConfidence: null,
    })),
    recordWithdrawalPoint: assign(({ event }) => ({
      withdrawnFrom: event.type === "WITHDRAW" ? event.atState : null,
    })),
  },
}).createMachine({
  id: "session",
  initial: "eligibility",
  context: ({ input }) => ({
    language: null,
    ageBand: null,
    ageGroup: null,
    priorTraining: null,
    parentalConsentCode: null,
    condition: null,
    stratum: null,
    allocationSeq: null,
    itemIds: input?.itemIds ?? itemIds,
    itemIndex: 0,
    initialEstimate: null,
    initialConfidence: null,
    registerState: null,
    finalEstimate: null,
    finalConfidence: null,
    withdrawnFrom: null,
  }),

  // Withdrawal is available from every non-final state. Hand-written UI suites
  // reliably miss most of these paths; the model-based test walks all of them.
  on: {
    WITHDRAW: {
      target: ".withdrawn",
      actions: "recordWithdrawalPoint",
    },
  },

  states: {
    eligibility: {
      meta: { screen: "eligibility" },
      on: {
        SET_LANGUAGE: { actions: "setLanguage" },
        SET_AGE_BAND: { actions: "setAgeBand" },
        SET_PRIOR_TRAINING: { actions: "setPriorTraining" },
        SUBMIT_ELIGIBILITY: [
          { guard: "isEligible", target: "consentFork" },
          { target: "ineligible" },
        ],
      },
    },

    // Transient: routes to the correct consent flow and renders nothing.
    consentFork: {
      always: [{ guard: "isMinor", target: "assent" }, { target: "consent" }],
    },

    consent: {
      meta: { screen: "consent", flow: "adult" },
      on: { GIVE_CONSENT: { target: "allocating" } },
    },

    assent: {
      meta: { screen: "assent", flow: "minor" },
      on: {
        SET_PARENTAL_CODE: { actions: "setParentalCode" },
        GIVE_ASSENT: { guard: "hasParentalCode", target: "allocating" },
      },
    },

    // Allocation is a real screen, not a transient state: the sequence is
    // served by the backend, so this is a round trip that can fail and must be
    // visible when it does.
    allocating: {
      meta: { screen: "allocating" },
      on: { ALLOCATE: { target: "task", actions: "applyAllocation" } },
    },

    task: {
      initial: "estimate",
      states: {
        estimate: {
          meta: { screen: "item.estimate" },
          on: {
            SET_ESTIMATE: { actions: "setInitialEstimate" },
            SET_CONFIDENCE: { actions: "setInitialConfidence" },
            SUBMIT_INITIAL: {
              guard: "initialComplete",
              target: "advice",
              actions: "selectRegister",
            },
          },
        },
        advice: {
          meta: { screen: "item.advice" },
          on: { REQUEST_FINAL: { target: "revise" } },
        },
        revise: {
          meta: { screen: "item.revise" },
          on: {
            SET_ESTIMATE: { actions: "setFinalEstimate" },
            SET_CONFIDENCE: { actions: "setFinalConfidence" },
            // Targets `questionnaire` directly rather than a final child with
            // onDone. The onDone form makes XState raise an internal
            // `xstate.done.state.*` event, which then appears in generated
            // paths in place of SUBMIT_FINAL -- and a model-based UI test
            // cannot click an internal event. Keeping every transition
            // user-driven keeps the generated paths executable against the DOM.
            SUBMIT_FINAL: [
              {
                guard: "finalCompleteWithMoreItems",
                target: "estimate",
                actions: "nextItem",
              },
              { guard: "finalComplete", target: "#session.questionnaire" },
            ],
          },
        },
      },
    },

    questionnaire: {
      meta: { screen: "questionnaire" },
      on: { SUBMIT_QUESTIONNAIRE: { target: "funnel" } },
    },

    funnel: {
      meta: { screen: "funnel" },
      on: { SUBMIT_FUNNEL: { target: "debrief" } },
    },

    debrief: {
      meta: { screen: "debrief" },
      on: { FINISH: { target: "done" } },
    },

    done: { type: "final", meta: { screen: "done" } },
    withdrawn: { type: "final", meta: { screen: "withdrawn" } },
    ineligible: { type: "final", meta: { screen: "ineligible" } },
  },
  });
}

export const sessionMachine = createSessionMachine();

export type SessionMachine = ReturnType<typeof createSessionMachine>;

/**
 * Item at the current index, or null if the index is out of range.
 *
 * This does NOT know whether the session is inside the task loop: after the
 * last SUBMIT_FINAL the index still points at the final item, because nothing
 * advances it on the way out. Callers must gate on the state value, which is
 * what App.tsx does by rendering item screens only in `task.*`.
 */
export function currentItemId(context: SessionContext): string | null {
  return context.itemIds[context.itemIndex] ?? null;
}
