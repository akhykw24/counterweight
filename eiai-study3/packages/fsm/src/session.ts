import { assign, setup } from "xstate";
import type {
  AgeBand,
  AgeGroup,
  AgeScreenAnswer,
  ScreenedOutReason,
  Condition,
  FollowupId,
  FunnelStage,
  Language,
  RegisterState,
  Stratum,
} from "@eiai/schema";
import { registerFor } from "./register.js";

/**
 * Session flow as a statechart (STUDY3_SPEC_v3.md section 5).
 *
 * eligibility -> screening gate -> consent -> allocation -> 12 items ->
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
  /** What the screen was told. `under-18` never becomes an `ageBand`. */
  ageAnswer: AgeScreenAnswer | null;
  ageBand: AgeBand | null;
  ageGroup: AgeGroup | null;
  priorTraining: boolean | null;
  /** Why the visitor was turned away, or null if they were not. */
  screenedOutReason: ScreenedOutReason | null;

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

  /** Per-item, reset on advance. Selecting `challenge` is a vigilance measure. */
  followupsSelected: readonly FollowupId[];
  /** Per-item count of "check this claim". The button opens nothing. */
  verifyClicks: number;

  /** questionnaire item id -> answer. Likert integers and categorical strings. */
  answers: Readonly<Record<string, number | string>>;
  funnelAnswers: Readonly<Record<string, string>>;

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
  | { type: "SET_AGE_ANSWER"; ageAnswer: AgeScreenAnswer }
  | { type: "SET_PRIOR_TRAINING"; priorTraining: boolean }
  | { type: "SUBMIT_ELIGIBILITY" }
  | { type: "GIVE_CONSENT" }
  | { type: "ALLOCATE"; condition: Condition; stratum: Stratum; allocationSeq: number }
  | { type: "SELECT_FOLLOWUP"; followupId: FollowupId }
  | { type: "CLICK_VERIFY" }
  | { type: "ANSWER_QUESTION"; id: string; value: number | string }
  | { type: "ANSWER_FUNNEL"; stage: FunnelStage; text: string }
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

/**
 * Ages the study does not admit.
 *
 * One value today, and deliberately still a list: the screen has to be able to
 * offer an option that fails, and a boolean "is adult" flag on the event would
 * put the judgement in the UI instead of here.
 */
const EXCLUDED_AGE_ANSWERS: readonly AgeScreenAnswer[] = ["under-18"];

/** True when the answer names an age the study admits. */
export function isAdmissibleAge(answer: AgeScreenAnswer): boolean {
  return !EXCLUDED_AGE_ANSWERS.includes(answer);
}

/**
 * The stored band, or null when the visitor is turned away.
 *
 * Returning null rather than a sentinel is the point: v2 says a screened-out
 * visitor contributes no age at all, so there must be no band to leak.
 */
export function ageBandFor(answer: AgeScreenAnswer): AgeBand | null {
  return isAdmissibleAge(answer) ? (answer as AgeBand) : null;
}

/**
 * Every questionnaire item that must be answered before the funnel opens.
 * Kept here rather than imported from the instrument so the machine has no
 * dependency on questionnaire copy.
 */
export const REQUIRED_QUESTION_IDS: readonly string[] = [
  "warmth_01", "warmth_02", "warmth_03", "warmth_04", "warmth_05",
  "competence_01", "competence_02", "competence_03", "competence_04",
  "trust_01", "trust_02", "trust_03", "trust_04",
  "cov_age_band", "cov_gender", "cov_primary_language",
  "cov_ai_usage", "cov_prior_knowledge",
];

export function ageGroupFor(_band: AgeBand): AgeGroup {
  // Every admitted participant is an adult in v2. The function survives because
  // the stratum key is still built from an age group; item 4 of the v2 code
  // migration replaces the stratum scheme entirely.
  return "adult";
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
 *
 * `requiredQuestionIds` is parameterised for the same reason. Each answered
 * question is a distinct context, so generating paths against the full
 * eighteen-item questionnaire explodes the graph outright. The model-based
 * suite passes a single question; the real required set is asserted directly.
 */
export function createSessionMachine(
  itemIds: readonly string[] = DEFAULT_ITEM_IDS,
  requiredQuestionIds: readonly string[] = REQUIRED_QUESTION_IDS,
) {
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
      context.ageAnswer !== null &&
      isAdmissibleAge(context.ageAnswer) &&
      context.priorTraining === false,
    // Screening runs in a fixed order so the recorded reason is deterministic:
    // someone who is both under 18 and untrained is turned away for age.
    failsAge: ({ context }) =>
      context.ageAnswer !== null && !isAdmissibleAge(context.ageAnswer),
    failsPriorTraining: ({ context }) => context.priorTraining === true,
    // `typeof === "number"`, not `!== null`: a malformed event with no payload
    // would set the field to `undefined`, which passes a null check and then
    // throws inside selectRegister. A bad event must not be able to crash a
    // participant's session.
    initialComplete: ({ context }) =>
      typeof context.initialEstimate === "number" &&
      typeof context.initialConfidence === "number",
    finalComplete: ({ context }) =>
      typeof context.finalEstimate === "number" &&
      typeof context.finalConfidence === "number",
    finalCompleteWithMoreItems: ({ context }) =>
      typeof context.finalEstimate === "number" &&
      typeof context.finalConfidence === "number" &&
      context.itemIndex + 1 < context.itemIds.length,
    questionnaireComplete: ({ context }) =>
      requiredQuestionIds.every((id) => context.answers[id] !== undefined),
    // Each follow-up may be asked once per item. The reply is pre-written and
    // identical on a second press, so allowing repeats would only inflate the
    // challenge-rate measure -- and it would make `followupsSelected` an
    // unbounded context, which no graph traversal can enumerate.
    followupNotYetAsked: ({ context, event }) =>
      event.type === "SELECT_FOLLOWUP" &&
      typeof event.followupId === "string" &&
      !context.followupsSelected.includes(event.followupId),
  },
  actions: {
    setLanguage: assign(({ event }) => ({
      language: event.type === "SET_LANGUAGE" ? event.language : null,
    })),
    setAgeAnswer: assign(({ event }) => {
      if (event.type !== "SET_AGE_ANSWER") return {};
      const band = ageBandFor(event.ageAnswer);
      // The band stays null for an inadmissible answer, so there is no age to
      // leak for someone the study turns away.
      return {
        ageAnswer: event.ageAnswer,
        ageBand: band,
        ageGroup: band === null ? null : ageGroupFor(band),
      };
    }),
    setPriorTraining: assign(({ event }) => ({
      priorTraining: event.type === "SET_PRIOR_TRAINING" ? event.priorTraining : null,
    })),
    screenOutForAge: assign(() => ({ screenedOutReason: "age" as const })),
    screenOutForPriorTraining: assign(() => ({
      screenedOutReason: "prior_training" as const,
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
      initialEstimate:
        event.type === "SET_ESTIMATE" && typeof event.value === "number" ? event.value : null,
    })),
    setInitialConfidence: assign(({ event }) => ({
      initialConfidence:
        event.type === "SET_CONFIDENCE" && typeof event.value === "number" ? event.value : null,
    })),
    setFinalEstimate: assign(({ event }) => ({
      finalEstimate:
        event.type === "SET_ESTIMATE" && typeof event.value === "number" ? event.value : null,
    })),
    setFinalConfidence: assign(({ event }) => ({
      finalConfidence:
        event.type === "SET_CONFIDENCE" && typeof event.value === "number" ? event.value : null,
    })),
    /**
     * The register is selected from the INITIAL confidence, before the
     * participant has seen anything. Selecting it later would let the advice
     * influence the register that chose the advice.
     */
    selectRegister: assign(({ context }) => ({
      registerState:
        context.condition === null || typeof context.initialConfidence !== "number"
          ? null
          : registerFor(context.condition, context.initialConfidence),
    })),
    /** Follow-ups are recorded in selection order; the sequence is a measure. */
    recordFollowup: assign(({ context, event }) =>
      event.type === "SELECT_FOLLOWUP" && typeof event.followupId === "string"
        ? { followupsSelected: [...context.followupsSelected, event.followupId] }
        : {},
    ),
    countVerify: assign(({ context }) => ({ verifyClicks: context.verifyClicks + 1 })),
    recordAnswer: assign(({ context, event }) =>
      event.type === "ANSWER_QUESTION" && typeof event.id === "string"
        ? { answers: { ...context.answers, [event.id]: event.value } }
        : {},
    ),
    recordFunnel: assign(({ context, event }) =>
      event.type === "ANSWER_FUNNEL" && typeof event.stage === "string"
        ? { funnelAnswers: { ...context.funnelAnswers, [event.stage]: event.text ?? "" } }
        : {},
    ),
    /**
     * Age band and primary language are already known from eligibility.
     * Asking again twenty minutes later invites a contradicting answer and
     * adds burden for nothing, so they are carried across instead.
     */
    seedCovariatesFromEligibility: assign(({ context }) => ({
      answers: {
        ...context.answers,
        ...(context.ageBand ? { cov_age_band: context.ageBand } : {}),
        ...(context.language ? { cov_primary_language: context.language } : {}),
      },
    })),
    nextItem: assign(({ context }) => ({
      itemIndex: context.itemIndex + 1,
      initialEstimate: null,
      initialConfidence: null,
      registerState: null,
      finalEstimate: null,
      finalConfidence: null,
      followupsSelected: [],
      verifyClicks: 0,
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
    ageAnswer: null,
    ageBand: null,
    ageGroup: null,
    priorTraining: null,
    screenedOutReason: null,
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
    followupsSelected: [],
    verifyClicks: 0,
    answers: {},
    funnelAnswers: {},
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
        SET_AGE_ANSWER: { actions: "setAgeAnswer" },
        SET_PRIOR_TRAINING: { actions: "setPriorTraining" },
        SUBMIT_ELIGIBILITY: [
          // Screened-out arms come FIRST and each records its own reason, so a
          // visitor never reaches consent and never reaches allocation.
          { guard: "failsAge", target: "screenedOut", actions: "screenOutForAge" },
          {
            guard: "failsPriorTraining",
            target: "screenedOut",
            actions: "screenOutForPriorTraining",
          },
          { guard: "isEligible", target: "consent" },
          { target: "ineligible" },
        ],
      },
    },

    consent: {
      meta: { screen: "consent" },
      on: { GIVE_CONSENT: { target: "allocating" } },
    },

    // Terminal. A screened-out visitor has contributed one event carrying the
    // reason and nothing else -- no age band, no answers, no allocation.
    screenedOut: { type: "final", meta: { screen: "screened-out" } },

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
          on: {
            // Internal transitions: the participant stays on the response and
            // may take several of these before revising.
            SELECT_FOLLOWUP: {
              guard: "followupNotYetAsked",
              actions: "recordFollowup",
            },
            CLICK_VERIFY: { actions: "countVerify" },
            REQUEST_FINAL: { target: "revise" },
          },
        },
        revise: {
          meta: { screen: "item.revise" },
          on: {
            // "check this claim" is available on every item, which includes
            // while the participant is revising.
            CLICK_VERIFY: { actions: "countVerify" },
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
      entry: "seedCovariatesFromEligibility",
      on: {
        ANSWER_QUESTION: { actions: "recordAnswer" },
        SUBMIT_QUESTIONNAIRE: { guard: "questionnaireComplete", target: "funnel" },
      },
    },

    // Three stages, forward only. The spec requires the probe be administered
    // in this order without backtracking, so there is deliberately no
    // transition back: seeing the later questions must not let a participant
    // revise an earlier, more spontaneous answer.
    funnel: {
      initial: "purpose",
      states: {
        purpose: {
          meta: { screen: "funnel.purpose" },
          on: {
            ANSWER_FUNNEL: {
              guard: ({ event }) => event.stage === "purpose",
              actions: "recordFunnel",
              target: "anomaly",
            },
          },
        },
        anomaly: {
          meta: { screen: "funnel.anomaly" },
          on: {
            ANSWER_FUNNEL: {
              guard: ({ event }) => event.stage === "anomaly",
              actions: "recordFunnel",
              target: "belief",
            },
          },
        },
        belief: {
          meta: { screen: "funnel.belief" },
          on: {
            ANSWER_FUNNEL: {
              guard: ({ event }) => event.stage === "belief",
              actions: "recordFunnel",
              target: "#session.debrief",
            },
          },
        },
      },
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
