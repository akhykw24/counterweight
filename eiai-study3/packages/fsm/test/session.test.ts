import { createActor } from "xstate";
import { stratumForCefr, stratumIds } from "../../../apps/study/src/strata";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ITEM_IDS,
  ageBandFor,
  ageGroupFor,
  isAdmissibleAge,
  createSessionMachine,
  currentItemId,
  sessionMachine,
  type SessionEvent,
} from "@eiai/fsm";

/**
 * Pure statechart tests: no DOM, no path generation.
 *
 * The model-based UI suite runs against a two-item machine so its generated
 * path set stays exhaustive. These cover what that trade-off leaves out --
 * chiefly the real twelve-item loop -- plus the guards and assignments that
 * are cheaper to assert directly than to reach through a rendered screen.
 */

function start(itemIds?: readonly string[]) {
  const actor = createActor(itemIds ? createSessionMachine(itemIds) : sessionMachine);
  actor.start();
  return actor;
}

function send(actor: ReturnType<typeof start>, ...events: SessionEvent[]) {
  for (const event of events) actor.send(event);
  return actor;
}

function throughConsent(actor: ReturnType<typeof start>) {
  send(
    actor,
    { type: "SET_AGE_ANSWER", ageAnswer: "35+" },
    { type: "SET_CEFR", cefr: "B2" },
    { type: "SET_STUDY_WORK_LANGUAGE", studyWorkLanguage: "english" },
    { type: "SET_PRIOR_TRAINING", priorTraining: false },
    { type: "SUBMIT_ELIGIBILITY" },
    { type: "GIVE_CONSENT" },
  );
  send(actor, {
    type: "ALLOCATE",
    condition: "warm",
    stratum: "en:adult",
    allocationSeq: 0,
  });
  return actor;
}

function answerItem(actor: ReturnType<typeof start>, confidence = 55) {
  send(
    actor,
    { type: "SET_ESTIMATE", value: 10 },
    { type: "SET_CONFIDENCE", value: confidence },
    { type: "SUBMIT_INITIAL" },
    { type: "REQUEST_FINAL" },
    { type: "SET_ESTIMATE", value: 20 },
    { type: "SET_CONFIDENCE", value: 60 },
    { type: "SUBMIT_FINAL" },
    { type: "RATE_ARGUMENT", perceivedStrength: 4 },
  );
  return actor;
}

describe("age banding and stratification", () => {
  it.each(["18-24", "25-34", "35+"] as const)("admits %s", (answer) => {
    expect(isAdmissibleAge(answer)).toBe(true);
    expect(ageBandFor(answer)).toBe(answer);
    expect(ageGroupFor(answer)).toBe("adult");
  });

  it("turns away under-18 and stores no band for them", () => {
    // The band must be null, not a sentinel: v2 says a screened-out visitor
    // contributes no age at all, so there has to be nothing to leak.
    expect(isAdmissibleAge("under-18")).toBe(false);
    expect(ageBandFor("under-18")).toBeNull();
  });

  it("maps every admitted CEFR level to exactly one configured stratum", () => {
    // The scheme is configuration now, so this asserts the mapping is total and
    // unambiguous over the admitted levels rather than naming the strata.
    for (const level of ["B1", "B2", "C1", "C2"] as const) {
      expect(stratumIds).toContain(stratumForCefr(level));
    }
    // Levels below the threshold have no stratum: they are screened out before
    // randomisation and must never consume a slot.
    for (const level of ["A1", "A2"] as const) {
      expect(stratumForCefr(level)).toBeNull();
    }
  });
});

describe("eligibility screening", () => {
  it("screens out formal training, recording the reason", () => {
    const actor = start();
    send(
      actor,
      { type: "SET_AGE_ANSWER", ageAnswer: "35+" },
      { type: "SET_PRIOR_TRAINING", priorTraining: true },
      { type: "SUBMIT_ELIGIBILITY" },
    );
    expect(actor.getSnapshot().value).toBe("screenedOut");
    expect(actor.getSnapshot().context.screenedOutReason).toBe("prior_training");
  });

  it("screens out under-18 for age, ahead of every other criterion", () => {
    // Order matters: someone who is both under 18 and trained is turned away
    // for age, so the recorded reason is deterministic rather than incidental.
    const actor = start();
    send(
      actor,
      { type: "SET_AGE_ANSWER", ageAnswer: "under-18" },
      { type: "SET_PRIOR_TRAINING", priorTraining: true },
      { type: "SUBMIT_ELIGIBILITY" },
    );
    expect(actor.getSnapshot().value).toBe("screenedOut");
    expect(actor.getSnapshot().context.screenedOutReason).toBe("age");
  });

  it("keeps no age band for a screened-out visitor", () => {
    const actor = start();
    send(
      actor,
      { type: "SET_AGE_ANSWER", ageAnswer: "under-18" },
      { type: "SET_PRIOR_TRAINING", priorTraining: false },
      { type: "SUBMIT_ELIGIBILITY" },
    );
    expect(actor.getSnapshot().context.ageBand).toBeNull();
    expect(actor.getSnapshot().context.ageGroup).toBeNull();
  });

  it("refuses to advance on an incomplete screening form", () => {
    // Neither screened out nor admitted: they simply have not answered. The
    // distinction matters because a screening exit is counted in the
    // participant flow and an unfinished form is not.
    const actor = start();
    send(actor, { type: "SUBMIT_ELIGIBILITY" });
    expect(actor.getSnapshot().value).toBe("ineligible");
    expect(actor.getSnapshot().context.screenedOutReason).toBeNull();
  });

  it("treats an unanswered training question as not eligible, not as 'no'", () => {
    // priorTraining starts null. Defaulting it to false would silently admit
    // people who never answered the exclusion criterion.
    const actor = start();
    send(
      actor,
      { type: "SET_AGE_ANSWER", ageAnswer: "35+" },
      { type: "SUBMIT_ELIGIBILITY" },
    );
    expect(actor.getSnapshot().value).toBe("ineligible");
  });
});

describe("consent fork", () => {
  it("routes an adult to consent", () => {
    const actor = start();
    send(
      actor,
      { type: "SET_AGE_ANSWER", ageAnswer: "35+" },
      { type: "SET_CEFR", cefr: "B2" },
      { type: "SET_STUDY_WORK_LANGUAGE", studyWorkLanguage: "english" },
      { type: "SET_PRIOR_TRAINING", priorTraining: false },
      { type: "SUBMIT_ELIGIBILITY" },
    );
    expect(actor.getSnapshot().value).toBe("consent");
  });

  it("has no assent state at all", () => {
    // Removed from the active machine rather than left unreachable: an
    // unreachable branch is one refactor away from being reachable again.
    const actor = start();
    expect(Object.keys(actor.getSnapshot().machine.states)).not.toContain("assent");
  });

});

describe("the twelve-item loop", () => {
  it("runs exactly twelve items before the questionnaire", () => {
    const actor = throughConsent(start());
    expect(actor.getSnapshot().context.itemIds).toHaveLength(12);

    for (let i = 0; i < 11; i += 1) {
      answerItem(actor);
      expect(actor.getSnapshot().value, `after item ${i + 1}`).toEqual({
        task: "estimate",
      });
      expect(actor.getSnapshot().context.itemIndex).toBe(i + 1);
    }

    answerItem(actor);
    expect(actor.getSnapshot().value).toBe("questionnaire");
  });

  it("presents items in the supplied order", () => {
    const order = ["item_05", "item_02", "item_09"];
    const actor = throughConsent(start(order));
    expect(currentItemId(actor.getSnapshot().context)).toBe("item_05");
    answerItem(actor);
    expect(currentItemId(actor.getSnapshot().context)).toBe("item_02");
    answerItem(actor);
    expect(currentItemId(actor.getSnapshot().context)).toBe("item_09");
  });

  it("blocks submission until both estimate and confidence are given", () => {
    const actor = throughConsent(start());
    send(actor, { type: "SUBMIT_INITIAL" });
    expect(actor.getSnapshot().value).toEqual({ task: "estimate" });

    send(actor, { type: "SET_ESTIMATE", value: 10 }, { type: "SUBMIT_INITIAL" });
    expect(actor.getSnapshot().value).toEqual({ task: "estimate" });

    send(actor, { type: "SET_CONFIDENCE", value: 50 }, { type: "SUBMIT_INITIAL" });
    expect(actor.getSnapshot().value).toEqual({ task: "advice" });
  });

  it("clears per-item answers when advancing, so nothing carries over", () => {
    const actor = throughConsent(start());
    answerItem(actor);
    const context = actor.getSnapshot().context;
    expect(context.initialEstimate).toBeNull();
    expect(context.initialConfidence).toBeNull();
    expect(context.finalEstimate).toBeNull();
    expect(context.registerState).toBeNull();
  });
});

describe("register selection", () => {
  it.each([
    [10, "LOW"],
    [39, "LOW"],
    [40, "MODERATE"],
    [70, "MODERATE"],
    [71, "HIGH"],
    [100, "HIGH"],
  ])("selects %s -> %s in the warm condition", (confidence, expected) => {
    const actor = throughConsent(start());
    send(
      actor,
      { type: "SET_ESTIMATE", value: 10 },
      { type: "SET_CONFIDENCE", value: confidence as number },
      { type: "SUBMIT_INITIAL" },
    );
    expect(actor.getSnapshot().context.registerState).toBe(expected);
  });

  it("selects from the INITIAL confidence, never the revised one", () => {
    // Selecting later would let the advice influence the register that chose
    // the advice, which would make the manipulation circular.
    const actor = throughConsent(start());
    send(
      actor,
      { type: "SET_ESTIMATE", value: 10 },
      { type: "SET_CONFIDENCE", value: 10 },
      { type: "SUBMIT_INITIAL" },
      { type: "REQUEST_FINAL" },
      { type: "SET_CONFIDENCE", value: 95 },
    );
    expect(actor.getSnapshot().context.registerState).toBe("LOW");
  });

  it("leaves the register null in the neutral condition at every confidence", () => {
    for (const confidence of [0, 20, 40, 55, 70, 85, 100]) {
      const actor = start();
      send(
        actor,
        { type: "SET_AGE_ANSWER", ageAnswer: "35+" },
        { type: "SET_PRIOR_TRAINING", priorTraining: false },
        { type: "SUBMIT_ELIGIBILITY" },
        { type: "GIVE_CONSENT" },
        { type: "ALLOCATE", condition: "neutral", stratum: "en:adult", allocationSeq: 1 },
        { type: "SET_ESTIMATE", value: 10 },
        { type: "SET_CONFIDENCE", value: confidence },
        { type: "SUBMIT_INITIAL" },
      );
      expect(actor.getSnapshot().context.registerState, `at ${confidence}`).toBeNull();
    }
  });
});

describe("withdrawal", () => {
  it("is reachable from every non-terminal screen and records where", () => {
    const screens: [string, () => ReturnType<typeof start>][] = [
      ["eligibility", () => start()],
      [
        "consent",
        () => {
          const a = start();
          send(
            a,
            { type: "SET_AGE_ANSWER", ageAnswer: "35+" },
            { type: "SET_CEFR", cefr: "B2" },
            { type: "SET_STUDY_WORK_LANGUAGE", studyWorkLanguage: "english" },
            { type: "SET_PRIOR_TRAINING", priorTraining: false },
            { type: "SUBMIT_ELIGIBILITY" },
          );
          return a;
        },
      ],
      ["task.estimate", () => throughConsent(start())],
      [
        "task.advice",
        () => {
          const a = throughConsent(start());
          send(
            a,
            { type: "SET_ESTIMATE", value: 10 },
            { type: "SET_CONFIDENCE", value: 50 },
            { type: "SUBMIT_INITIAL" },
          );
          return a;
        },
      ],
    ];

    for (const [name, build] of screens) {
      const actor = build();
      actor.send({ type: "WITHDRAW", atState: name });
      expect(actor.getSnapshot().value, `from ${name}`).toBe("withdrawn");
      expect(actor.getSnapshot().context.withdrawnFrom).toBe(name);
    }
  });

  it("keeps everything answered up to the withdrawal point", () => {
    // A dropped session still contributes the items already completed; that is
    // the whole reason the event log is append-only.
    const actor = throughConsent(start());
    answerItem(actor);
    answerItem(actor);
    actor.send({ type: "WITHDRAW", atState: "task.estimate" });
    expect(actor.getSnapshot().context.itemIndex).toBe(2);
  });
});

describe("machine defaults", () => {
  it("defaults to the twelve canonical item ids when given no input", () => {
    expect(DEFAULT_ITEM_IDS).toHaveLength(12);
    expect(DEFAULT_ITEM_IDS[0]).toBe("item_01");
    expect(DEFAULT_ITEM_IDS[11]).toBe("item_12");
    expect(start().getSnapshot().context.itemIds).toEqual(DEFAULT_ITEM_IDS);
  });

  it("keeps the index on the last item after the loop ends", () => {
    // currentItemId does not know about the task loop, and must not pretend
    // to: nothing advances the index on the way out, so it still resolves.
    // Gating on the state value is the caller's job.
    const actor = throughConsent(start(["item_01"]));
    answerItem(actor);
    expect(actor.getSnapshot().value).toBe("questionnaire");
    expect(currentItemId(actor.getSnapshot().context)).toBe("item_01");
  });

  it("returns null only when the index is genuinely out of range", () => {
    expect(currentItemId({ itemIds: [], itemIndex: 0 } as never)).toBeNull();
  });
});
