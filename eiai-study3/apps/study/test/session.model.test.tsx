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
 * `getSimplePaths()` is deliberately NOT used. With SET_ESTIMATE and
 * SET_CONFIDENCE available as self-transitions in two phases, plus withdrawal
 * reachable from everywhere, simple-path enumeration does not terminate in
 * useful time. A suite that sampled paths while claiming to exhaust them would
 * be worse than one that says what it covers.
 */

const ITEM_IDS = ["item_01", "item_02"];

const SCREEN_STATES = [
  "eligibility",
  "consent",
  "assent",
  "allocating",
  { task: "estimate" },
  { task: "advice" },
  { task: "revise" },
  "questionnaire",
  "funnel",
  "debrief",
  "done",
  "ineligible",
] as const;

/** Non-terminal screens, from which withdrawal must be possible. */
const WITHDRAWABLE = SCREEN_STATES.filter(
  (s) => s !== "done" && s !== "ineligible",
);

type Arm = { label: string; ageBand: string; forkScreen: string; absent: string };

const ARMS: Arm[] = [
  { label: "adult", ageBand: "25+", forkScreen: "consent", absent: "assent" },
  { label: "minor", ageBand: "16-17", forkScreen: "assent", absent: "consent" },
];

function eventsFor(ageBand: string) {
  return [
    { type: "SET_LANGUAGE", language: "en" },
    { type: "SET_AGE_BAND", ageBand },
    { type: "SET_PRIOR_TRAINING", priorTraining: false },
    { type: "SET_PRIOR_TRAINING", priorTraining: true },
    { type: "SUBMIT_ELIGIBILITY" },
    { type: "SET_PARENTAL_CODE", code: "PC-1" },
    { type: "GIVE_CONSENT" },
    { type: "GIVE_ASSENT" },
    { type: "ALLOCATE", condition: "warm", stratum: "en:adult", allocationSeq: 0 },
    { type: "SET_ESTIMATE", value: 100 },
    { type: "SET_CONFIDENCE", value: 55 },
    { type: "SUBMIT_INITIAL" },
    { type: "REQUEST_FINAL" },
    { type: "SUBMIT_FINAL" },
    { type: "SUBMIT_QUESTIONNAIRE" },
    { type: "SUBMIT_FUNNEL" },
    { type: "FINISH" },
    { type: "WITHDRAW", atState: "generated" },
  ];
}

function modelFor(ageBand: string) {
  return createTestModel(createSessionMachine(ITEM_IDS) as never, {
    events: eventsFor(ageBand),
  } as never);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
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
    case "SET_LANGUAGE":
      return click(`lang-${event.language}`);
    case "SET_AGE_BAND":
      return click(`age-${event.ageBand}`);
    case "SET_PRIOR_TRAINING":
      return click(event.priorTraining ? "training-yes" : "training-no");
    case "SUBMIT_ELIGIBILITY":
      return click("submit-eligibility");
    case "SET_PARENTAL_CODE":
      return user.type(screen.getByTestId("parental-code"), event.code);
    case "GIVE_CONSENT":
      return click("give-consent");
    case "GIVE_ASSENT":
      return click("give-assent");
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
    case "SUBMIT_QUESTIONNAIRE":
      return click("submit-questionnaire");
    case "SUBMIT_FUNNEL":
      return click("submit-funnel");
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
  render(<App machine={createSessionMachine(ITEM_IDS)} />);

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
    const path = pathTo(arm.ageBand, target);
    expect(path, `no generated path to ${JSON.stringify(target)}`).not.toBeNull();
    await drive(path);
    expect(screen.getByTestId("screen").dataset["state"]).toBe(
      stateName(path.state.value),
    );
  });

  it(`never reaches ${arm.absent}, because the consent fork excludes it`, () => {
    // The fork is a legal requirement, not a preference: a minor must not be
    // able to land on the adult consent screen, or an adult on assent.
    expect(pathTo(arm.ageBand, arm.absent)).toBeNull();
  });

  it.each(WITHDRAWABLE.map((s) => [JSON.stringify(s), s] as const).filter(
    ([, s]) => s !== arm.absent,
  ))("allows withdrawal from %s", async (_label, target) => {
    const path = pathTo(arm.ageBand, target);
    expect(path).not.toBeNull();
    await drive(path);

    const user = userEvent.setup();
    await user.click(screen.getByTestId("withdraw"));
    await user.click(screen.getByTestId("withdraw-confirm"));

    expect(screen.getByTestId("screen").dataset["state"]).toBe("withdrawn");
    expect(screen.getByTestId("screen-withdrawn")).toBeDefined();
  });

  it("completes end to end to done", async () => {
    const path = pathTo(arm.ageBand, "done");
    expect(path).not.toBeNull();
    await drive(path);
    expect(screen.getByTestId("screen-done")).toBeDefined();
  });
});

describe("screening", () => {
  it("routes a participant with formal training to ineligible", async () => {
    const path = pathTo("25+", "ineligible");
    expect(path).not.toBeNull();
    await drive(path);
    expect(screen.getByTestId("screen-ineligible")).toBeDefined();
  });
});

describe("withdrawal is offered everywhere it should be, and nowhere else", () => {
  it("hides the withdraw control on terminal screens", async () => {
    for (const target of ["done", "ineligible"] as const) {
      cleanup();
      const path = pathTo("25+", target);
      await drive(path);
      expect(
        screen.queryByTestId("withdraw"),
        `withdraw offered on ${target}`,
      ).toBeNull();
    }
  });
});
