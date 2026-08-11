import { createActor } from "xstate";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ITEM_IDS,
  ageGroupFor,
  createSessionMachine,
  currentItemId,
  sessionMachine,
  stratumFor,
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

function throughConsent(actor: ReturnType<typeof start>, adult = true) {
  send(
    actor,
    { type: "SET_LANGUAGE", language: "en" },
    { type: "SET_AGE_BAND", ageBand: adult ? "25+" : "16-17" },
    { type: "SET_PRIOR_TRAINING", priorTraining: false },
    { type: "SUBMIT_ELIGIBILITY" },
  );
  if (adult) {
    send(actor, { type: "GIVE_CONSENT" });
  } else {
    send(actor, { type: "SET_PARENTAL_CODE", code: "PC-1" }, { type: "GIVE_ASSENT" });
  }
  send(actor, {
    type: "ALLOCATE",
    condition: "warm",
    stratum: adult ? "en:adult" : "en:minor",
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
  );
  return actor;
}

describe("age banding and stratification", () => {
  it.each([
    ["14-15", "minor"],
    ["16-17", "minor"],
    ["18-24", "adult"],
    ["25+", "adult"],
  ] as const)("maps %s to %s", (band, group) => {
    expect(ageGroupFor(band)).toBe(group);
  });

  it("builds the six strata the randomisation uses", () => {
    const strata = new Set(
      (["kk", "ru", "en"] as const).flatMap((lang) =>
        (["minor", "adult"] as const).map((group) => stratumFor(lang, group)),
      ),
    );
    expect(strata.size).toBe(6);
    expect(strata).toContain("kk:minor");
    expect(strata).toContain("en:adult");
  });
});

describe("eligibility screening", () => {
  it.each([
    ["formal training", { type: "SET_PRIOR_TRAINING", priorTraining: true }],
  ] as const)("excludes a participant with %s", (_label, event) => {
    const actor = start();
    send(
      actor,
      { type: "SET_LANGUAGE", language: "en" },
      { type: "SET_AGE_BAND", ageBand: "25+" },
      event as SessionEvent,
      { type: "SUBMIT_ELIGIBILITY" },
    );
    expect(actor.getSnapshot().value).toBe("ineligible");
  });

  it("refuses to advance on an incomplete screening form", () => {
    const actor = start();
    send(actor, { type: "SET_LANGUAGE", language: "en" }, { type: "SUBMIT_ELIGIBILITY" });
    expect(actor.getSnapshot().value).toBe("ineligible");
  });

  it("treats an unanswered training question as not eligible, not as 'no'", () => {
    // priorTraining starts null. Defaulting it to false would silently admit
    // people who never answered the exclusion criterion.
    const actor = start();
    send(
      actor,
      { type: "SET_LANGUAGE", language: "en" },
      { type: "SET_AGE_BAND", ageBand: "25+" },
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
      { type: "SET_LANGUAGE", language: "en" },
      { type: "SET_AGE_BAND", ageBand: "25+" },
      { type: "SET_PRIOR_TRAINING", priorTraining: false },
      { type: "SUBMIT_ELIGIBILITY" },
    );
    expect(actor.getSnapshot().value).toBe("consent");
  });

  it("routes a minor to assent", () => {
    const actor = start();
    send(
      actor,
      { type: "SET_LANGUAGE", language: "en" },
      { type: "SET_AGE_BAND", ageBand: "14-15" },
      { type: "SET_PRIOR_TRAINING", priorTraining: false },
      { type: "SUBMIT_ELIGIBILITY" },
    );
    expect(actor.getSnapshot().value).toBe("assent");
  });

  it("blocks assent without a parental consent code", () => {
    const actor = start();
    send(
      actor,
      { type: "SET_LANGUAGE", language: "en" },
      { type: "SET_AGE_BAND", ageBand: "14-15" },
      { type: "SET_PRIOR_TRAINING", priorTraining: false },
      { type: "SUBMIT_ELIGIBILITY" },
      { type: "GIVE_ASSENT" },
    );
    expect(actor.getSnapshot().value).toBe("assent");
  });

  it("blocks assent on a whitespace-only code", () => {
    const actor = start();
    send(
      actor,
      { type: "SET_LANGUAGE", language: "en" },
      { type: "SET_AGE_BAND", ageBand: "14-15" },
      { type: "SET_PRIOR_TRAINING", priorTraining: false },
      { type: "SUBMIT_ELIGIBILITY" },
      { type: "SET_PARENTAL_CODE", code: "   " },
      { type: "GIVE_ASSENT" },
    );
    expect(actor.getSnapshot().value).toBe("assent");
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
        { type: "SET_LANGUAGE", language: "en" },
        { type: "SET_AGE_BAND", ageBand: "25+" },
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
            { type: "SET_LANGUAGE", language: "en" },
            { type: "SET_AGE_BAND", ageBand: "25+" },
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
