/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionMachine } from "@eiai/fsm";
import { App } from "../src/App";
import type { Recorder } from "../src/telemetry";

/**
 * Per-item perceived argument strength (spec v2 §1, §9).
 *
 * The study manipulates argument quality within participants but never asked
 * whether participants perceived the difference. Without this, a null
 * interaction cannot distinguish "warmth flattened discrimination" from "the
 * strong and weak arguments did not read differently" -- which are opposite
 * conclusions.
 *
 * It is asked AFTER the revised estimate on purpose: rating an argument before
 * acting on it would change the thing it is meant to explain.
 */

const ITEM_IDS = ["item_01", "item_02"];

// Deliberately off the sliders' resting midpoints: writing the value an input
// already holds dispatches no change event, and the machine would never receive
// the estimate. item_01 spans [3000, 15000], so 9000 would have been silent.

interface Captured {
  type: string;
  payload: Record<string, unknown>;
}

function capturing() {
  const events: Captured[] = [];
  const recorder: Recorder = { record: (type, payload) => events.push({ type, payload }) };
  return {
    recorder,
    of: (type: string) => events.filter((event) => event.type === type),
    types: () => events.map((event) => event.type),
  };
}

async function throughEligibility(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("age-35+"));
  await user.click(screen.getByTestId("cefr-B2"));
  await user.click(screen.getByTestId("study-language-english"));
  await user.click(screen.getByTestId("training-no"));
  await user.click(screen.getByTestId("submit-eligibility"));
  await user.click(screen.getByTestId("give-consent"));
  await user.click(screen.getByTestId("allocate"));
}

/** One full item, stopping wherever the rating screen appears. */
async function answerItem(user: ReturnType<typeof userEvent.setup>, rating: number | null) {
  fireEvent.change(screen.getByTestId("initial-estimate"), { target: { value: "7000" } });
  fireEvent.change(screen.getByTestId("initial-confidence"), { target: { value: "55" } });
  await user.click(screen.getByTestId("submit-initial"));
  await user.click(screen.getByTestId("request-final"));
  fireEvent.change(screen.getByTestId("final-estimate"), { target: { value: "8200" } });
  fireEvent.pointerUp(screen.getByTestId("final-confidence"));
  await user.click(screen.getByTestId("submit-final"));
  if (rating !== null) {
    await user.click(screen.getByTestId(`argument-strength-${rating}`));
  }
}

afterEach(cleanup);

describe("perceived argument strength", () => {
  it("is asked after the revised estimate, not before", async () => {
    const user = userEvent.setup();
    const log = capturing();
    render(<App machine={createSessionMachine(ITEM_IDS)} recorder={log.recorder} />);
    await throughEligibility(user);

    // Not on screen while the participant is still revising.
    fireEvent.change(screen.getByTestId("initial-estimate"), { target: { value: "7000" } });
    fireEvent.change(screen.getByTestId("initial-confidence"), { target: { value: "55" } });
    await user.click(screen.getByTestId("submit-initial"));
    expect(screen.queryByTestId("screen-item-rate")).toBeNull();
    await user.click(screen.getByTestId("request-final"));
    expect(screen.queryByTestId("screen-item-rate")).toBeNull();

    fireEvent.change(screen.getByTestId("final-estimate"), { target: { value: "8200" } });
    fireEvent.pointerUp(screen.getByTestId("final-confidence"));
    await user.click(screen.getByTestId("submit-final"));
    expect(screen.getByTestId("screen-item-rate")).toBeVisible();
  });

  it("offers a seven-point scale", async () => {
    const user = userEvent.setup();
    render(<App machine={createSessionMachine(ITEM_IDS)} recorder={capturing().recorder} />);
    await throughEligibility(user);
    await answerItem(user, null);

    for (const point of [1, 2, 3, 4, 5, 6, 7]) {
      expect(screen.getByTestId(`argument-strength-${point}`)).toBeVisible();
    }
    expect(screen.queryByTestId("argument-strength-0")).toBeNull();
    expect(screen.queryByTestId("argument-strength-8")).toBeNull();
  });

  it("records one rating per item, carrying the item id", async () => {
    const user = userEvent.setup();
    const log = capturing();
    render(<App machine={createSessionMachine(ITEM_IDS)} recorder={log.recorder} />);
    await throughEligibility(user);

    await answerItem(user, 6);
    await answerItem(user, 2);

    const rated = log.of("ARGUMENT_RATED");
    expect(rated).toHaveLength(ITEM_IDS.length);
    expect(rated.map((event) => event.payload["item_id"])).toEqual(ITEM_IDS);
    expect(rated.map((event) => event.payload["perceived_strength"])).toEqual([6, 2]);
  });

  it("will not advance until the argument is rated", async () => {
    // An optional measure is one that goes missing exactly for the
    // participants who were least engaged, which is the worst pattern of
    // missingness for this question.
    const user = userEvent.setup();
    const log = capturing();
    render(<App machine={createSessionMachine(ITEM_IDS)} recorder={log.recorder} />);
    await throughEligibility(user);
    await answerItem(user, null);

    expect(screen.getByTestId("screen-item-rate")).toBeVisible();
    expect(log.of("ARGUMENT_RATED")).toHaveLength(0);

    await user.click(screen.getByTestId("argument-strength-4"));
    expect(screen.queryByTestId("screen-item-rate")).toBeNull();
  });

  it("records the rating after the finalised estimate, in event order", async () => {
    // Order in the log is what lets an analyst show the rating could not have
    // influenced the estimate it explains.
    const user = userEvent.setup();
    const log = capturing();
    render(<App machine={createSessionMachine(ITEM_IDS)} recorder={log.recorder} />);
    await throughEligibility(user);
    await answerItem(user, 5);

    const types = log.types();
    expect(types.indexOf("ARGUMENT_RATED")).toBeGreaterThan(
      types.indexOf("ESTIMATE_FINALIZED"),
    );
  });
});

describe("the rating step cannot be bypassed", () => {
  it("offers no transition out of the rating state except rating or withdrawing", () => {
    // A structural assertion rather than a temporary mutation: it lives in the
    // repository and fails if anyone later adds a skip. Reaching the next item
    // without a rating would make the measure missing exactly for the least
    // engaged participants, which is the worst pattern of missingness this
    // question could have.
    const machine = createSessionMachine(ITEM_IDS);
    const rate = machine.states["task"]!.states!["rate"]!;
    const handled = Object.keys(rate.on ?? {}).sort();
    expect(handled).toEqual(["RATE_ARGUMENT"]);
  });

  it("keeps the rating state between revise and the next item", () => {
    // Pins the position in the flow, not just its existence: moving it before
    // the estimate would let rating influence the judgement it explains.
    const machine = createSessionMachine(ITEM_IDS);
    const revise = machine.states["task"]!.states!["revise"]!;
    const submitFinal = revise.on?.["SUBMIT_FINAL"];
    expect(JSON.stringify(submitFinal)).toContain("rate");
  });
});
