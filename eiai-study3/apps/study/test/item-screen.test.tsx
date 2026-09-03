/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionMachine } from "@eiai/fsm";
import { App } from "../src/App";
import { allocate } from "../src/allocation";
import { stratumForCefr } from "../src/strata";

/**
 * Interaction tests for the item screen.
 *
 * These exist because the model-based suite cannot catch them: generated paths
 * send SET_ESTIMATE with a value that differs from whatever the control
 * happens to display, so a control that only reports *changes* looks fine to
 * the model and dead-ends a real participant.
 */

const ITEM_IDS = ["item_01", "item_02"];

async function reachFirstItem(sessionId?: string) {
  const user = userEvent.setup();
  render(
    <App
      machine={createSessionMachine(ITEM_IDS)}
      {...(sessionId ? { sessionId } : {})}
    />,
  );
  await user.click(screen.getByTestId("age-35+"));
  await user.click(screen.getByTestId("cefr-B2"));
  await user.click(screen.getByTestId("study-language-english"));
  await user.click(screen.getByTestId("training-no"));
  await user.click(screen.getByTestId("submit-eligibility"));
  await user.click(screen.getByTestId("give-consent"));
  await user.click(screen.getByTestId("allocate"));
  expect(screen.getByTestId("screen").dataset["state"]).toBe("task.estimate");
  return user;
}

afterEach(cleanup);

describe("estimate and confidence controls", () => {
  it("shows no answer until the participant acts", async () => {
    await reachFirstItem();
    expect(screen.getByTestId("initial-estimate-value").textContent).toBe("—");
    expect(screen.getByTestId("initial-confidence-value").textContent).toBe("—");
    expect(screen.getByTestId("submit-initial")).toBeDisabled();
  });

  it("accepts an answer that equals the slider's resting position", async () => {
    // The regression. A participant who agrees with where the thumb already
    // sits produces no `change` event; without commit-on-release they could
    // never submit, and nothing on screen would say why.
    await reachFirstItem();
    const estimate = screen.getByTestId("initial-estimate") as HTMLInputElement;
    const confidence = screen.getByTestId("initial-confidence") as HTMLInputElement;
    const resting = estimate.value;

    fireEvent.pointerUp(estimate);
    fireEvent.pointerUp(confidence);

    expect(screen.getByTestId("initial-estimate-value").textContent).toBe(resting);
    expect(screen.getByTestId("submit-initial")).not.toBeDisabled();
  });

  it("commits on keyboard release, so the control is not pointer-only", async () => {
    await reachFirstItem();
    fireEvent.keyUp(screen.getByTestId("initial-estimate"), { key: "ArrowRight" });
    fireEvent.keyUp(screen.getByTestId("initial-confidence"), { key: "ArrowRight" });
    expect(screen.getByTestId("submit-initial")).not.toBeDisabled();
  });

  it("hides the prompt hint once a value is set", async () => {
    await reachFirstItem();
    expect(screen.queryByTestId("initial-estimate-hint")).not.toBeNull();
    fireEvent.pointerUp(screen.getByTestId("initial-estimate"));
    expect(screen.queryByTestId("initial-estimate-hint")).toBeNull();
  });

  it("bounds the estimate slider by the item's plausible range", async () => {
    await reachFirstItem();
    const estimate = screen.getByTestId("initial-estimate") as HTMLInputElement;
    // item_01: Challenger Deep depth, [3000, 15000]
    expect(estimate.min).toBe("3000");
    expect(estimate.max).toBe("15000");
  });

  it("bounds confidence to the register function's domain", async () => {
    await reachFirstItem();
    const confidence = screen.getByTestId("initial-confidence") as HTMLInputElement;
    expect(confidence.min).toBe("0");
    expect(confidence.max).toBe("100");
  });
});

describe("advice rendering", () => {
  /**
   * A session id the committed sequence assigns to the warm arm.
   *
   * Searched rather than fixed: the sequence is regenerated whenever the strata
   * config changes, and a hard-coded id would quietly start landing in the
   * neutral arm, at which point these tests would assert nothing about register
   * selection while still passing.
   */
  function warmSessionId(): string {
    const stratum = stratumForCefr("B2");
    if (!stratum) throw new Error("B2 has no configured stratum");
    for (let i = 1; i < 10_000; i += 1) {
      const candidate = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      if (allocate(candidate, stratum).condition === "warm") return candidate;
    }
    throw new Error("no session id in the search space allocates to the warm arm");
  }

  async function reachAdvice(confidence: number, sessionId?: string) {
    const user = await reachFirstItem(sessionId);
    fireEvent.change(screen.getByTestId("initial-estimate"), {
      target: { value: "12000" },
    });
    fireEvent.change(screen.getByTestId("initial-confidence"), {
      target: { value: String(confidence) },
    });
    await user.click(screen.getByTestId("submit-initial"));
    return user;
  }

  it.each([
    [10, "low"],
    [55, "moderate"],
    [90, "high"],
  ])("serves the register the initial confidence selects (%s -> %s)", async (c, slug) => {
    // Register branching only exists in the warm arm, so this needs a session
    // the committed sequence assigns there. The id is SEARCHED rather than
    // hard-coded: a hard-coded one would silently stop exercising the warm arm
    // the next time the sequence is regenerated.
    await reachAdvice(c as number, warmSessionId());
    const responseId = screen.getByTestId("advice").dataset["responseId"];
    expect(responseId).toBe(`en_warm_${slug}_item_01`);
  });

  it("renders the justification as its own element", async () => {
    // Scroll depth on the justification is the H4 mediator, so it has to be
    // separately measurable from the body rather than one blob of prose.
    await reachAdvice(55);
    expect(screen.getByTestId("advice-justification")).toBeDefined();
    expect(screen.getByTestId("advice-body")).toBeDefined();
    expect(screen.getByTestId("advice-justification").textContent).not.toBe(
      screen.getByTestId("advice-body").textContent,
    );
  });

  it("labels a placeholder stimulus on screen", async () => {
    // While the frozen set is offline placeholders, nobody should be able to
    // pilot against it without noticing.
    await reachAdvice(55);
    expect(screen.queryByTestId("placeholder-warning")).not.toBeNull();
  });

  it("resets both answers when moving to the next item", async () => {
    const user = await reachAdvice(55);
    await user.click(screen.getByTestId("request-final"));
    fireEvent.pointerUp(screen.getByTestId("final-estimate"));
    fireEvent.pointerUp(screen.getByTestId("final-confidence"));
    await user.click(screen.getByTestId("submit-final"));

    expect(screen.getByTestId("screen").dataset["state"]).toBe("task.estimate");
    expect(screen.getByTestId("initial-estimate-value").textContent).toBe("—");
    expect(screen.getByTestId("progress").textContent).toContain("2 of 2");
  });
});
