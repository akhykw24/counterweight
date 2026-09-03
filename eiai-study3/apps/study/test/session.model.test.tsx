/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTestModel } from "@xstate/graph";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionMachine } from "@eiai/fsm";
import { App, stateName } from "../src/App";

/**
 * Model-based UI tests (STUDY3_SPEC_v3.md section 5).
 *
 * Paths are generated from the statechart by @xstate/graph and then executed
 * against the real DOM, rather than being hand-written. The spec names
 * @xstate/test; that package is stale at 0.5.1 (XState v4 era) and model-based
 * testing moved into @xstate/graph for v5. Same technique, current package.
 *
 * Coverage is stated precisely rather than as "every path":
 *   - every reachable screen, in both consent arms
 *   - withdrawal from every non-terminal screen, in both arms
 *   - both arms end to end to `done`
 *
 * The graph is keyed by `serializeState` on flow-relevant context only.
 * `verifyClicks` is an unbounded counter -- a participant may press "check this
 * claim" any number of times -- so keying on raw context makes the traversal
 * non-terminating. Everything a guard reads stays in the key; counters and
 * answer *values* are collapsed to their shape.
 *
 * `getSimplePaths()` is deliberately NOT used. With SET_ESTIMATE and
 * SET_CONFIDENCE available as self-transitions in two phases, plus withdrawal
 * reachable from everywhere, simple-path enumeration does not terminate in
 * useful time. A suite that sampled paths while claiming to exhaust them would
 * be worse than one that says what it covers.
 */

const ITEM_IDS = ["item_01", "item_02"];
// One required question, for the same reason there are two items: every
// answered question is a distinct context, so the full eighteen explodes the
// graph. The real required set is asserted in the direct machine tests.
const REQUIRED_QUESTIONS = ["warmth_01"];

const SCREEN_STATES = [
  "eligibility",
  "consent",
  "allocating",
  { task: "estimate" },
  { task: "advice" },
  { task: "revise" },
  "questionnaire",
  { funnel: "purpose" },
  { funnel: "anomaly" },
  { funnel: "belief" },
  "debrief",
  "done",
  "ineligible",
  "screenedOut",
] as const;

/** Non-terminal screens, from which withdrawal must be possible. */
const WITHDRAWABLE = SCREEN_STATES.filter(
  (s) => s !== "done" && s !== "ineligible" && s !== "screenedOut",
);

type Arm = { label: string; ageAnswer: string; forkScreen: string; absent: string };

/**
 * v2 admits adults only, so there is one path through consent. The screening
 * exit is a reachable state in its own right -- prior training reaches it -- so
 * `absent` names the branch that no longer exists at all.
 */
const ARMS: Arm[] = [
  { label: "adult", ageAnswer: "35+", forkScreen: "consent", absent: "assent" },
];

function eventsFor(ageAnswer: string) {
  return [
    { type: "SET_AGE_ANSWER", ageAnswer },
    { type: "SET_PRIOR_TRAINING", priorTraining: false },
    { type: "SET_PRIOR_TRAINING", priorTraining: true },
    { type: "SUBMIT_ELIGIBILITY" },
    { type: "GIVE_CONSENT" },
    { type: "ALLOCATE", condition: "warm", stratum: "en:adult", allocationSeq: 0 },
    { type: "SET_ESTIMATE", value: 100 },
    { type: "SET_CONFIDENCE", value: 55 },
    { type: "SUBMIT_INITIAL" },
    { type: "REQUEST_FINAL" },
    { type: "SUBMIT_FINAL" },
    { type: "SELECT_FOLLOWUP", followupId: "challenge" },
    { type: "CLICK_VERIFY" },
    { type: "ANSWER_QUESTION", id: "warmth_01", value: 5 },
    { type: "SUBMIT_QUESTIONNAIRE" },
    { type: "ANSWER_FUNNEL", stage: "purpose", text: "generated" },
    { type: "ANSWER_FUNNEL", stage: "anomaly", text: "generated" },
    { type: "ANSWER_FUNNEL", stage: "belief", text: "unsure" },
    { type: "FINISH" },
    { type: "WITHDRAW", atState: "generated" },
  ];
}

/**
 * Graph key. Anything a guard reads must stay here or the traversal mistakes a
 * real transition for a self-loop; anything unbounded must not, or it never
 * terminates.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
function serializeState(snapshot: any): string {
  const c = snapshot.context;
  return JSON.stringify({
    value: snapshot.value,
    language: c.language,
    ageGroup: c.ageGroup,
    priorTraining: c.priorTraining,
    hasCode: Boolean(c.parentalConsentCode),
    condition: c.condition,
    itemIndex: c.itemIndex,
    initial: [c.initialEstimate !== null, c.initialConfidence !== null],
    final: [c.finalEstimate !== null, c.finalConfidence !== null],
    followups: c.followupsSelected.length,
    answers: Object.keys(c.answers).length,
    funnel: Object.keys(c.funnelAnswers).sort(),
    withdrawn: c.withdrawnFrom !== null,
  });
}

function modelFor(ageBand: string) {
  return createTestModel(createSessionMachine(ITEM_IDS, REQUIRED_QUESTIONS) as never, {
    events: eventsFor(ageBand),
    serializeState,
  } as never);
}

function pathTo(ageBand: string, target: unknown): any | null {
  const paths = modelFor(ageBand).getShortestPaths({
    toState: (s: any) => s.matches(target as never),
  } as never);
  return paths[0] ?? null;
}

/** Executes one generated event as a real interaction against the DOM. */
async function execute(user: ReturnType<typeof userEvent.setup>, event: any) {
  const click = (testId: string) => user.click(screen.getByTestId(testId));
  const slide = (testId: string, value: number) =>
    fireEvent.change(screen.getByTestId(testId), { target: { value: String(value) } });

  switch (event.type) {
    case "SET_AGE_ANSWER":
      return click(`age-${event.ageAnswer}`);
    case "SET_PRIOR_TRAINING":
      return click(event.priorTraining ? "training-yes" : "training-no");
    case "SUBMIT_ELIGIBILITY":
      return click("submit-eligibility");
    case "GIVE_CONSENT":
      return click("give-consent");
    case "ALLOCATE":
      return click("allocate");
    case "SET_ESTIMATE":
      return slide(
        screen.queryByTestId("final-estimate") ? "final-estimate" : "initial-estimate",
        event.value,
      );
    case "SET_CONFIDENCE":
      return slide(
        screen.queryByTestId("final-confidence")
          ? "final-confidence"
          : "initial-confidence",
        event.value,
      );
    case "SUBMIT_INITIAL":
      return click("submit-initial");
    case "REQUEST_FINAL":
      return click("request-final");
    case "SUBMIT_FINAL":
      return click("submit-final");
    case "SELECT_FOLLOWUP":
      return click(`followup-${event.followupId}`);
    case "CLICK_VERIFY":
      return click("verify");
    case "ANSWER_QUESTION":
      return click(`${event.id}-${event.value}`);
    case "SUBMIT_QUESTIONNAIRE":
      return click("submit-questionnaire");
    case "ANSWER_FUNNEL":
      if (event.stage === "belief") return click(`funnel-belief-${event.text}`);
      return click(`funnel-${event.stage}-submit`);
    case "FINISH":
      return click("submit-debrief");
    case "WITHDRAW":
      // The UI puts a confirmation between intent and effect; the model event
      // corresponds to the completed interaction, not the first click.
      await click("withdraw");
      return click("withdraw-confirm");
    default:
      throw new Error(`no UI binding for event ${event.type}`);
  }
}

/** Drives a generated path against the DOM, asserting the screen after each step. */
async function drive(path: any): Promise<void> {
  const user = userEvent.setup();
  render(<App machine={createSessionMachine(ITEM_IDS, REQUIRED_QUESTIONS)} />);

  for (const step of path.steps) {
    if (String(step.event.type).startsWith("xstate.")) continue;
    await execute(user, step.event);
    const expected = stateName(step.state.value);
    expect(
      screen.getByTestId("screen").dataset["state"],
      `after ${step.event.type}`,
    ).toBe(expected);
  }
}

afterEach(cleanup);

describe.each(ARMS)("$label arm", (arm) => {
  it.each(
    SCREEN_STATES.map((s) => [JSON.stringify(s), s] as const).filter(
      ([, s]) => s !== arm.absent,
    ),
  )("reaches %s and renders it", async (_label, target) => {
    const path = pathTo(arm.ageAnswer, target);
    expect(path, `no generated path to ${JSON.stringify(target)}`).not.toBeNull();
    await drive(path);
    expect(screen.getByTestId("screen").dataset["state"]).toBe(
      stateName(path.state.value),
    );
  });

  it(`never reaches ${arm.absent}, because the branch is gone from the machine`, () => {
    // Not merely unreachable: the assent state was removed with the minor flow.
    // An unreachable branch is one refactor away from being reachable again.
    expect(pathTo(arm.ageAnswer, arm.absent)).toBeNull();
  });

  it.each(WITHDRAWABLE.map((s) => [JSON.stringify(s), s] as const).filter(
    ([, s]) => s !== arm.absent,
  ))("allows withdrawal from %s", async (_label, target) => {
    const path = pathTo(arm.ageAnswer, target);
    expect(path).not.toBeNull();
    await drive(path);

    const user = userEvent.setup();
    await user.click(screen.getByTestId("withdraw"));
    await user.click(screen.getByTestId("withdraw-confirm"));

    expect(screen.getByTestId("screen").dataset["state"]).toBe("withdrawn");
    expect(screen.getByTestId("screen-withdrawn")).toBeDefined();
  });

  it("completes end to end to done", async () => {
    const path = pathTo(arm.ageAnswer, "done");
    expect(path).not.toBeNull();
    await drive(path);
    expect(screen.getByTestId("screen-done")).toBeDefined();
  });
});

describe("screening", () => {
  it("routes a participant with formal training to the screening exit", async () => {
    // v2 turns prior training into a screening reason rather than a generic
    // "ineligible", so the reason is countable in the participant-flow diagram.
    const path = pathTo("35+", "screenedOut");
    expect(path).not.toBeNull();
    await drive(path);
    expect(screen.getByTestId("screen-screened-out")).toBeDefined();
  });
});

describe("withdrawal is offered everywhere it should be, and nowhere else", () => {
  it("hides the withdraw control on terminal screens", async () => {
    for (const target of ["done", "ineligible", "screenedOut"] as const) {
      cleanup();
      const path = pathTo("35+", target);
      await drive(path);
      expect(
        screen.queryByTestId("withdraw"),
        `withdraw offered on ${target}`,
      ).toBeNull();
    }
  });
});
