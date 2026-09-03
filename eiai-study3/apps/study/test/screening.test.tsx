/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionMachine } from "@eiai/fsm";
import { App } from "../src/App";
import type { Recorder } from "../src/telemetry";

/**
 * Eligibility screening (spec v2 §1).
 *
 * v2 admits adults only. Age is asked BEFORE consent, and someone under 18 is
 * turned away without any personal data being stored -- the session contributes
 * a single SCREENED_OUT event carrying the reason, and nothing else. In
 * particular no allocation happens: a screened-out visitor must not consume a
 * randomisation slot.
 */

const ITEM_IDS = ["item_01", "item_02"];

interface Captured {
  type: string;
  payload: Record<string, unknown>;
}

function capturing() {
  const events: Captured[] = [];
  const recorder: Recorder = {
    record: (type, payload) => events.push({ type, payload }),
  };
  return {
    recorder,
    events,
    types: () => events.map((event) => event.type),
    of: (type: string) => events.filter((event) => event.type === type),
  };
}

afterEach(cleanup);

describe("age screening", () => {
  it("turns away a participant under 18 and records why", async () => {
    const user = userEvent.setup();
    const log = capturing();
    render(<App machine={createSessionMachine(ITEM_IDS)} recorder={log.recorder} />);

    await user.click(screen.getByTestId("age-under-18"));
    await user.click(screen.getByTestId("training-no"));
    await user.click(screen.getByTestId("submit-eligibility"));

    expect(screen.getByTestId("screen-screened-out")).toBeVisible();
    // Consent must never be reached: asking a minor to consent is the thing the
    // age gate exists to prevent.
    expect(screen.queryByTestId("screen-consent")).toBeNull();

    const screened = log.of("SCREENED_OUT");
    expect(screened).toHaveLength(1);
    expect(screened[0]!.payload["reason"]).toBe("age");
  });

  it("does not consume a randomisation slot when someone is screened out", async () => {
    // A screened-out visitor who took a slot would bend the block balance for
    // everyone after them, and nothing in the log would show it.
    const user = userEvent.setup();
    const log = capturing();
    render(<App machine={createSessionMachine(ITEM_IDS)} recorder={log.recorder} />);

    await user.click(screen.getByTestId("age-under-18"));
    await user.click(screen.getByTestId("training-no"));
    await user.click(screen.getByTestId("submit-eligibility"));

    expect(log.of("ALLOCATED")).toHaveLength(0);
    expect(screen.queryByTestId("allocate")).toBeNull();
  });

  it("stores no age band for someone who is turned away", async () => {
    // v2: "no band, no answers, no session". The reason is the only thing kept.
    const user = userEvent.setup();
    const log = capturing();
    render(<App machine={createSessionMachine(ITEM_IDS)} recorder={log.recorder} />);

    await user.click(screen.getByTestId("age-under-18"));
    await user.click(screen.getByTestId("training-no"));
    await user.click(screen.getByTestId("submit-eligibility"));

    const payloads = JSON.stringify(log.events);
    expect(payloads).not.toContain("under-18");
    expect(log.of("QUESTIONNAIRE_ANSWERED")).toHaveLength(0);
  });

  it("admits an adult and reaches consent", async () => {
    const user = userEvent.setup();
    const log = capturing();
    render(<App machine={createSessionMachine(ITEM_IDS)} recorder={log.recorder} />);

    await user.click(screen.getByTestId("age-25-34"));
    await user.click(screen.getByTestId("cefr-B2"));
    await user.click(screen.getByTestId("study-language-english"));
    await user.click(screen.getByTestId("training-no"));
    await user.click(screen.getByTestId("submit-eligibility"));

    expect(screen.getByTestId("screen-consent")).toBeVisible();
    expect(log.of("SCREENED_OUT")).toHaveLength(0);
  });

  it("offers no way to declare oneself a minor beyond the single under-18 option", async () => {
    // The old bands 14-15 and 16-17 belonged to a design that recruited minors.
    // Leaving them on the screen would collect an age from someone the study
    // does not admit.
    render(<App machine={createSessionMachine(ITEM_IDS)} recorder={capturing().recorder} />);
    // The v1 bands 14-15 and 16-17 belonged to a design that recruited minors.
    // A single "under 18" option turns someone away; two minor bands would
    // collect an age from a person the study does not admit.
    expect(screen.queryByTestId("age-14-15")).toBeNull();
    expect(screen.queryByTestId("age-16-17")).toBeNull();
    expect(screen.getByTestId("age-under-18")).toBeVisible();
  });

  it("never renders an assent screen", async () => {
    // The minor branch is gone from the active machine, not merely unreachable.
    const user = userEvent.setup();
    render(<App machine={createSessionMachine(ITEM_IDS)} recorder={capturing().recorder} />);
    await user.click(screen.getByTestId("age-under-18"));
    await user.click(screen.getByTestId("training-no"));
    await user.click(screen.getByTestId("submit-eligibility"));
    expect(screen.queryByTestId("screen-assent")).toBeNull();
    expect(screen.queryByTestId("parental-code")).toBeNull();
  });
});

describe("English proficiency screening", () => {
  const admit = async (user: ReturnType<typeof userEvent.setup>, cefr: string) => {
    await user.click(screen.getByTestId("age-25-34"));
    await user.click(screen.getByTestId(`cefr-${cefr}`));
    await user.click(screen.getByTestId("study-language-other"));
    await user.click(screen.getByTestId("training-no"));
    await user.click(screen.getByTestId("submit-eligibility"));
  };

  it.each(["A1", "A2"])("turns away self-reported %s and records the reason", async (level) => {
    // Below B1 a participant may fail to read a strong argument as strong. That
    // flattens the discrimination score for a reason unrelated to warmth, which
    // is exactly the alternative explanation the study has to rule out.
    const user = userEvent.setup();
    const log = capturing();
    render(<App machine={createSessionMachine(ITEM_IDS)} recorder={log.recorder} />);
    await admit(user, level);

    expect(screen.getByTestId("screen-screened-out")).toBeVisible();
    expect(screen.queryByTestId("screen-consent")).toBeNull();
    const screened = log.of("SCREENED_OUT");
    expect(screened).toHaveLength(1);
    expect(screened[0]!.payload["reason"]).toBe("language");
    expect(log.of("ALLOCATED")).toHaveLength(0);
  });

  it.each(["B1", "B2", "C1", "C2"])("admits self-reported %s", async (level) => {
    const user = userEvent.setup();
    const log = capturing();
    render(<App machine={createSessionMachine(ITEM_IDS)} recorder={log.recorder} />);
    await admit(user, level);

    expect(screen.getByTestId("screen-consent")).toBeVisible();
    expect(log.of("SCREENED_OUT")).toHaveLength(0);
  });

  it("screens for age before language, so the reason is deterministic", async () => {
    // Someone who is both under 18 and A2 fails two criteria. Recording
    // whichever guard happened to run first would make the screening tally
    // depend on evaluation order rather than on policy.
    const user = userEvent.setup();
    const log = capturing();
    render(<App machine={createSessionMachine(ITEM_IDS)} recorder={log.recorder} />);
    await user.click(screen.getByTestId("age-under-18"));
    await user.click(screen.getByTestId("cefr-A2"));
    await user.click(screen.getByTestId("study-language-other"));
    await user.click(screen.getByTestId("training-no"));
    await user.click(screen.getByTestId("submit-eligibility"));

    expect(log.of("SCREENED_OUT")[0]!.payload["reason"]).toBe("age");
  });

  it("records the study or work language as a covariate, not as a gate", async () => {
    // v2 asks it to characterise the sample. It must not exclude anybody: a C1
    // speaker who works in another language is still a C1 speaker.
    const user = userEvent.setup();
    const log = capturing();
    render(<App machine={createSessionMachine(ITEM_IDS)} recorder={log.recorder} />);
    await user.click(screen.getByTestId("age-25-34"));
    await user.click(screen.getByTestId("cefr-B1"));
    await user.click(screen.getByTestId("study-language-other"));
    await user.click(screen.getByTestId("training-no"));
    await user.click(screen.getByTestId("submit-eligibility"));

    expect(screen.getByTestId("screen-consent")).toBeVisible();
  });
});
