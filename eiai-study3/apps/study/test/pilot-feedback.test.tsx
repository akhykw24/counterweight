/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionMachine } from "@eiai/fsm";
import { App } from "../src/App";
import type { Recorder } from "../src/telemetry";

/**
 * Three questions asked only in a pilot, only after the debriefing.
 *
 * They are about the study's usability, not about the deep sea, so they sit
 * after the session is already complete: a participant who closes the tab at
 * this point has given a full, valid session, and nothing about their data
 * changes. That is also why they are optional -- a pilot participant doing a
 * favour should not meet a form that refuses to let them leave.
 *
 * They must not appear in the real study. Asking a participant what they think
 * the study was investigating, after having just told them, adds nothing; and
 * an extra screen nobody pre-registered is an extra screen in the protocol.
 */

const ITEM_IDS = ["item_01"];

afterEach(cleanup);

function capturing() {
  const events: { type: string; payload: Record<string, unknown> }[] = [];
  const recorder: Recorder = { record: (type, payload) => events.push({ type, payload }) };
  return { recorder, of: (type: string) => events.filter((e) => e.type === type) };
}

async function reachDone(pilot: boolean, recorder?: Recorder) {
  const user = userEvent.setup();
  render(
    <App
      machine={createSessionMachine(ITEM_IDS)}
      pilot={pilot}
      {...(recorder ? { recorder } : {})}
    />,
  );
  await user.click(screen.getByTestId("age-35+"));
  await user.click(screen.getByTestId("cefr-B2"));
  await user.click(screen.getByTestId("study-language-english"));
  await user.click(screen.getByTestId("training-no"));
  await user.click(screen.getByTestId("submit-eligibility"));
  await user.click(screen.getByTestId("confirm-adult"));
  await user.click(screen.getByTestId("give-consent"));
  await user.click(screen.getByTestId("allocate"));

  fireEvent.change(screen.getByTestId("initial-estimate"), { target: { value: "12000" } });
  fireEvent.change(screen.getByTestId("initial-confidence"), { target: { value: "15" } });
  await user.click(screen.getByTestId("submit-initial"));
  await user.click(screen.getByTestId("request-final"));
  fireEvent.pointerUp(screen.getByTestId("final-estimate"));
  fireEvent.pointerUp(screen.getByTestId("final-confidence"));
  await user.click(screen.getByTestId("submit-final"));
  await user.click(screen.getByTestId("argument-strength-4"));

  for (const id of [
    "warmth_01", "warmth_02", "warmth_03", "warmth_04", "warmth_05",
    "competence_01", "competence_02", "competence_03", "competence_04",
    "trust_01", "trust_02", "trust_03", "trust_04", "cov_prior_knowledge",
  ]) {
    await user.click(screen.getByTestId(`${id}-5`));
  }
  await user.click(screen.getByTestId("cov_gender-prefer_not_to_say"));
  await user.click(screen.getByTestId("cov_ai_usage-3"));
  await user.click(screen.getByTestId("submit-questionnaire"));

  await user.click(screen.getByTestId("funnel-purpose-submit"));
  await user.click(screen.getByTestId("funnel-anomaly-submit"));
  await user.click(screen.getByTestId("funnel-belief-unsure"));
  await user.click(screen.getByTestId("submit-debrief"));
  return user;
}

describe("the pilot feedback questions", () => {
  it("are absent in the real study", async () => {
    await reachDone(false);
    expect(screen.getByTestId("screen").dataset["state"]).toBe("done");
    expect(screen.queryByTestId("pilot-feedback")).toBeNull();
  });

  it("appear after the debriefing in a pilot run", async () => {
    await reachDone(true);
    expect(screen.getByTestId("screen").dataset["state"]).toBe("done");
    expect(screen.getByTestId("pilot-feedback")).toBeDefined();
  });

  it("asks the three questions word for word", async () => {
    await reachDone(true);
    const text = screen.getByTestId("pilot-feedback").textContent ?? "";
    expect(text).toContain("Was anything unclear or confusing? If so, what?");
    expect(text).toContain("Roughly how long did the study take you?");
    expect(text).toContain("What do you think this study was investigating?");
  });

  it("records what was written, one event per answered question", async () => {
    const log = capturing();
    const user = await reachDone(true, log.recorder);

    fireEvent.change(screen.getByTestId("pilot-feedback-clarity"), {
      target: { value: "The slider was fiddly on my phone." },
    });
    fireEvent.change(screen.getByTestId("pilot-feedback-duration"), {
      target: { value: "about 12 minutes" },
    });
    await user.click(screen.getByTestId("pilot-feedback-submit"));

    const sent = log.of("PILOT_FEEDBACK");
    expect(sent).toHaveLength(2);
    expect(sent.map((e) => e.payload["question"]).sort()).toEqual(["clarity", "duration"]);
    expect(sent.find((e) => e.payload["question"] === "clarity")!.payload["text"]).toBe(
      "The slider was fiddly on my phone.",
    );
  });

  it("records nothing for a question left blank", async () => {
    // Optional means optional. An empty string stored as an answer would look
    // like a participant who had nothing to say, which is a different fact
    // from a participant who skipped the question.
    const log = capturing();
    const user = await reachDone(true, log.recorder);
    fireEvent.change(screen.getByTestId("pilot-feedback-duration"), {
      target: { value: "  " },
    });
    await user.click(screen.getByTestId("pilot-feedback-submit"));
    expect(log.of("PILOT_FEEDBACK")).toHaveLength(0);
  });

  it("can be skipped entirely, and says so", async () => {
    const log = capturing();
    const user = await reachDone(true, log.recorder);
    expect((screen.getByTestId("pilot-feedback").textContent ?? "").toLowerCase()).toContain(
      "optional",
    );
    await user.click(screen.getByTestId("pilot-feedback-submit"));
    expect(log.of("PILOT_FEEDBACK")).toHaveLength(0);
    expect(screen.queryByTestId("pilot-feedback")).toBeNull();
  });

  it("comes after the session is already complete", async () => {
    // The ordering that makes these safe to skip: SESSION_COMPLETED has
    // already been recorded, so closing the tab here costs the study nothing.
    const log = capturing();
    await reachDone(true, log.recorder);
    expect(log.of("SESSION_COMPLETED")).toHaveLength(1);
  });
});
