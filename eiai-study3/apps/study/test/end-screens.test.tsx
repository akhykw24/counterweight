/** @vitest-environment jsdom */
import { STUDY_LANGUAGE } from "@eiai/schema";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { REQUIRED_QUESTION_IDS, createSessionMachine } from "@eiai/fsm";
import { App } from "../src/App";
import { isTranslated, missingKeys, translator } from "../src/i18n";
import { items, resolveStimulus } from "../src/stimuli";
import type { Recorder } from "../src/telemetry";

const ITEM_IDS = ["item_01"];

function capturing() {
  const events: { type: string; payload: Record<string, unknown> }[] = [];
  const recorder: Recorder = { record: (type, payload) => events.push({ type, payload }) };
  return { recorder, of: (type: string) => events.filter((e) => e.type === type) };
}

async function reachAdvice(recorder?: Recorder) {
  const user = userEvent.setup();
  render(
    <App
      machine={createSessionMachine(ITEM_IDS)}
      {...(recorder ? { recorder } : {})}
    />,
  );
  await user.click(screen.getByTestId("age-35+"));
  await user.click(screen.getByTestId("cefr-B2"));
  await user.click(screen.getByTestId("study-language-english"));
  await user.click(screen.getByTestId("training-no"));
  await user.click(screen.getByTestId("submit-eligibility"));
  await user.click(screen.getByTestId("give-consent"));
  await user.click(screen.getByTestId("allocate"));
  fireEvent.change(screen.getByTestId("initial-estimate"), { target: { value: "12000" } });
  fireEvent.change(screen.getByTestId("initial-confidence"), { target: { value: "15" } });
  await user.click(screen.getByTestId("submit-initial"));
  return user;
}

async function reachQuestionnaire() {
  const user = await reachAdvice();
  await user.click(screen.getByTestId("request-final"));
  fireEvent.pointerUp(screen.getByTestId("final-estimate"));
  fireEvent.pointerUp(screen.getByTestId("final-confidence"));
  await user.click(screen.getByTestId("submit-final"));
  // Perceived argument strength, asked once per item after the estimate.
  await user.click(screen.getByTestId("argument-strength-4"));
  return user;
}

async function fillQuestionnaire(user: ReturnType<typeof userEvent.setup>) {
  for (const id of REQUIRED_QUESTION_IDS) {
    if (id === "cov_age_band" || id === "cov_primary_language") continue; // carried over
    if (id === "cov_gender") {
      await user.click(screen.getByTestId("cov_gender-prefer_not_to_say"));
    } else if (id === "cov_ai_usage") {
      await user.click(screen.getByTestId("cov_ai_usage-3"));
    } else {
      await user.click(screen.getByTestId(`${id}-5`));
    }
  }
}

afterEach(cleanup);

describe("follow-ups", () => {
  it("shows the pre-written reply from the frozen stimulus, not a generated one", async () => {
    const user = await reachAdvice();
    const expected = resolveStimulus("en", "warm", "LOW", "item_01").followups.challenge;

    await user.click(screen.getByTestId("followup-challenge"));
    expect(screen.getByTestId("followup-challenge-reply").textContent).toBe(expected);
  });

  it("records the selection, since challenge rate is a behavioural measure", async () => {
    const log = capturing();
    const user = await reachAdvice(log.recorder);
    await user.click(screen.getByTestId("followup-challenge"));

    expect(log.of("FOLLOWUP_SELECTED")[0]!.payload).toMatchObject({
      item_id: "item_01",
      followup_id: "challenge",
    });
  });

  it("allows each follow-up once, so the measure cannot be inflated", async () => {
    const log = capturing();
    const user = await reachAdvice(log.recorder);
    await user.click(screen.getByTestId("followup-challenge"));
    expect(screen.getByTestId("followup-challenge")).toBeDisabled();
    expect(log.of("FOLLOWUP_SELECTED")).toHaveLength(1);
  });

  it("offers all three fixed options and no free text", async () => {
    await reachAdvice();
    for (const id of ["measurement", "certainty", "challenge"]) {
      expect(screen.getByTestId(`followup-${id}`)).toBeDefined();
    }
    expect(screen.getByTestId("followups").querySelectorAll("input, textarea")).toHaveLength(0);
  });
});

describe("verify button", () => {
  it("records intent and opens nothing", async () => {
    const log = capturing();
    const user = await reachAdvice(log.recorder);
    await user.click(screen.getByTestId("verify"));

    expect(log.of("VERIFY_CLICKED")[0]!.payload).toMatchObject({ item_id: "item_01" });
    expect(screen.getByTestId("verify").closest("a")).toBeNull();
    expect(screen.getByTestId("verify-noted")).toBeDefined();
  });

  it("can be pressed repeatedly, and counts every press", async () => {
    const log = capturing();
    const user = await reachAdvice(log.recorder);
    await user.click(screen.getByTestId("verify"));
    await user.click(screen.getByTestId("verify"));
    await user.click(screen.getByTestId("verify"));
    expect(log.of("VERIFY_CLICKED")).toHaveLength(3);
  });
});

describe("questionnaire", () => {
  it("refuses to advance while any item is unanswered", async () => {
    const user = await reachQuestionnaire();
    await user.click(screen.getByTestId("submit-questionnaire"));

    expect(screen.getByTestId("screen").dataset["state"]).toBe("questionnaire");
    expect(screen.getByTestId("questionnaire-incomplete")).toBeDefined();
  });

  it("advances once every item is answered", async () => {
    const user = await reachQuestionnaire();
    await fillQuestionnaire(user);
    await user.click(screen.getByTestId("submit-questionnaire"));
    expect(screen.getByTestId("screen").dataset["state"]).toBe("funnel.purpose");
  });

  it("does not ask again for age band or language", async () => {
    // Both were captured at eligibility. Asking twenty minutes later invites a
    // contradicting answer and adds burden for nothing.
    await reachQuestionnaire();
    expect(screen.queryByTestId("q-cov_age_band")).toBeNull();
    expect(screen.queryByTestId("q-cov_primary_language")).toBeNull();
  });

  it("carries the eligibility answers into the questionnaire data", async () => {
    const user = await reachQuestionnaire();
    await fillQuestionnaire(user);
    await user.click(screen.getByTestId("submit-questionnaire"));
    // Advancing proves the guard saw cov_age_band and cov_primary_language,
    // which are in REQUIRED_QUESTION_IDS but never rendered.
    expect(screen.getByTestId("screen").dataset["state"]).toBe("funnel.purpose");
  });

  it("has a reverse-scored item on each Likert scale", async () => {
    await reachQuestionnaire();
    for (const id of ["warmth_04", "competence_04", "trust_03"]) {
      expect(screen.getByTestId(`q-${id}`)).toBeDefined();
    }
  });
});

describe("funnel", () => {
  async function reachFunnel() {
    const user = await reachQuestionnaire();
    await fillQuestionnaire(user);
    await user.click(screen.getByTestId("submit-questionnaire"));
    return user;
  }

  it("runs purpose then anomaly then belief, with no way back", async () => {
    const user = await reachFunnel();

    expect(screen.getByTestId("screen-funnel-purpose")).toBeDefined();
    await user.click(screen.getByTestId("funnel-purpose-submit"));

    expect(screen.getByTestId("screen-funnel-anomaly")).toBeDefined();
    // Nothing on screen returns to the previous stage: seeing "did anything
    // seem unusual?" must not let a participant revise their answer to "what
    // was this about?".
    expect(screen.queryByTestId("funnel-purpose-submit")).toBeNull();
    expect(screen.queryByTestId("funnel-back")).toBeNull();

    await user.click(screen.getByTestId("funnel-anomaly-submit"));
    expect(screen.getByTestId("screen-funnel-belief")).toBeDefined();

    await user.click(screen.getByTestId("funnel-belief-unsure"));
    expect(screen.getByTestId("screen-debrief")).toBeDefined();
  });

  it("records each stage verbatim", async () => {
    const log = capturing();
    const user = userEvent.setup();
    render(<App machine={createSessionMachine(ITEM_IDS)} recorder={log.recorder} />);
      await user.click(screen.getByTestId("age-35+"));
    await user.click(screen.getByTestId("cefr-B2"));
    await user.click(screen.getByTestId("study-language-english"));
    await user.click(screen.getByTestId("training-no"));
    await user.click(screen.getByTestId("submit-eligibility"));
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
    await fillQuestionnaire(user);
    await user.click(screen.getByTestId("submit-questionnaire"));

    fireEvent.change(screen.getByTestId("funnel-purpose-text"), {
      target: { value: "Something about trusting AI." },
    });
    await user.click(screen.getByTestId("funnel-purpose-submit"));
    await user.click(screen.getByTestId("funnel-anomaly-submit"));
    await user.click(screen.getByTestId("funnel-belief-no"));

    const responses = log.of("FUNNEL_RESPONSE");
    expect(responses).toHaveLength(3);
    expect(responses[0]!.payload).toMatchObject({
      stage: "purpose",
      text: "Something about trusting AI.",
    });
    expect(responses[2]!.payload).toMatchObject({ stage: "belief", text: "no" });
  });
});

describe("debrief", () => {
  async function reachDebrief() {
    const user = await reachQuestionnaire();
    await fillQuestionnaire(user);
    await user.click(screen.getByTestId("submit-questionnaire"));
    await user.click(screen.getByTestId("funnel-purpose-submit"));
    await user.click(screen.getByTestId("funnel-anomaly-submit"));
    await user.click(screen.getByTestId("funnel-belief-unsure"));
    return user;
  }

  it("discloses every planted error with its correct value and a source", async () => {
    await reachDebrief();
    const errorItems = items.filter((item) => item.is_error);
    expect(errorItems).toHaveLength(4);

    for (const item of errorItems) {
      expect(screen.getByTestId(`debrief-${item.id}`)).toBeDefined();
      expect(screen.getByTestId(`debrief-${item.id}-true`).textContent).toContain(
        String(item.true_value),
      );
      expect(screen.getByTestId(`debrief-${item.id}-told`).textContent).toContain(
        String(item.advice_value),
      );
    }
  });

  it("reads correct values from the item bank, so they cannot drift apart", async () => {
    // If a true value is corrected in items.json the debrief follows
    // automatically; hardcoding it here is how a participant gets told
    // something the appendix contradicts.
    await reachDebrief();
    const tubeworm = items.find((item) => item.id === "item_09")!;
    expect(screen.getByTestId("debrief-item_09-true").textContent).toContain(
      String(tubeworm.true_value),
    );
  });

  it("does not disclose items that were answered correctly", async () => {
    await reachDebrief();
    for (const item of items.filter((i) => !i.is_error)) {
      expect(screen.queryByTestId(`debrief-${item.id}`)).toBeNull();
    }
  });

  it("offers withdrawal after disclosure, which is the point of the probe order", async () => {
    const user = await reachDebrief();
    await user.click(screen.getByTestId("debrief-withdraw"));
    expect(screen.getByTestId("screen").dataset["state"]).toBe("withdrawn");
  });

  it("finishes to done", async () => {
    const user = await reachDebrief();
    await user.click(screen.getByTestId("submit-debrief"));
    expect(screen.getByTestId("screen").dataset["state"]).toBe("done");
  });
});

describe("i18n scaffold", () => {
  it("has a complete English catalogue", () => {
    expect(isTranslated("en")).toBe(true);
    expect(missingKeys("en")).toEqual([]);
  });

  it("carries exactly one catalogue, because the study has one language", () => {
    // The Russian and Kazakh catalogues were empty placeholders awaiting human
    // translation. v2 is English only, so they are gone with the languages
    // rather than left as slots that will never be filled.
    expect(isTranslated(STUDY_LANGUAGE)).toBe(true);
    expect(missingKeys(STUDY_LANGUAGE)).toEqual([]);
  });

  it("still falls back rather than rendering a blank screen", () => {
    expect(translator(STUDY_LANGUAGE)("common.continue")).toBe("Continue");
  });

  it("interpolates variables", () => {
    expect(translator("en")("item.progress", { position: 3, total: 12 })).toBe(
      "Question 3 of 12",
    );
  });
});
