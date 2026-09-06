/** @vitest-environment jsdom */
import { STUDY_LANGUAGE } from "@eiai/schema";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { REQUIRED_QUESTION_IDS, createSessionMachine } from "@eiai/fsm";
import { App } from "../src/App";
import { isTranslated, missingKeys, translator } from "../src/i18n";
import { items, stimulusByResponseId } from "../src/stimuli";
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
  await user.click(screen.getByTestId("confirm-adult"));
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

    // Read which stimulus the app actually served rather than assuming the
    // warm arm. Allocation comes from the committed sequence, so the arm is
    // not the test's to choose -- this asserted "warm" and passed only while
    // the placeholder texts were formulaic enough to coincide across
    // conditions. The first real stimuli exposed it immediately.
    const responseId = screen.getByTestId("advice").getAttribute("data-response-id")!;
    const served = stimulusByResponseId(responseId);

    await user.click(screen.getByTestId("followup-challenge"));
    expect(screen.getByTestId("followup-challenge-reply").textContent).toBe(
      served.followups.challenge,
    );
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

describe("consent", () => {
  async function reachConsent() {
    const user = userEvent.setup();
    render(<App machine={createSessionMachine(ITEM_IDS)} />);
    await user.click(screen.getByTestId("age-35+"));
    await user.click(screen.getByTestId("cefr-B2"));
    await user.click(screen.getByTestId("study-language-english"));
    await user.click(screen.getByTestId("training-no"));
    await user.click(screen.getByTestId("submit-eligibility"));
    return user;
  }

  async function consentText() {
    await reachConsent();
    return screen.getByTestId("screen-consent").textContent ?? "";
  }

  it("names the researcher, her school, and that this is a school project", async () => {
    const text = await consentText();
    expect(text).toContain("Prokopenko Darya Artyomovna");
    expect(text).toContain("Nazarbayev Intellectual School");
    expect(text).toContain("Kokshetau");
    expect(text.toLowerCase()).toContain("school research project");
  });

  it("names the supervisor", async () => {
    const text = await consentText();
    expect(text).toContain("Rakhimbekova Saya Dissembeyevna");
    expect(text.toLowerCase()).toContain("supervisor");
  });

  it("gives a contact address that works", async () => {
    await reachConsent();
    const mailto = screen
      .getByTestId("screen-consent")
      .querySelector('a[href^="mailto:"]');
    expect(mailto).not.toBeNull();
    expect(mailto!.getAttribute("href")).toContain("@");
  });

  it("states the real number of questions and the real duration", async () => {
    // It said "eight to twelve" for months, and later "about 20 minutes".
    // A session is twelve items and runs about fifteen.
    const text = await consentText();
    expect(text).toContain("12 questions");
    expect(text).toMatch(/15 minutes/);
    expect(text).not.toMatch(/eight to twelve/i);
  });

  it("says outright that some details are held back until the end", async () => {
    // The licence for incomplete disclosure: the participant is told in
    // advance that they are not being told everything, and when they will be.
    const text = await consentText();
    expect(text.toLowerCase()).toContain("not telling you everything");
    expect(text.toLowerCase()).toContain("after you finish");
  });

  it("promises the debriefing that the study actually gives", async () => {
    const text = await consentText();
    expect(text.toLowerCase()).toContain("debriefing");
  });

  it("describes anonymity, publication, and how long data are kept", async () => {
    const text = await consentText();
    expect(text.toLowerCase()).toContain("anonymous");
    expect(text.toLowerCase()).toContain("publish");
    expect(text.toLowerCase()).toContain("kept");
  });

  it("names the tab-switch logging explicitly, as the spec requires", async () => {
    // Spec: "tab-blur logging is behavioural monitoring and must be named
    // explicitly in the consent form. Do not bury it."
    const text = await consentText();
    expect(text.toLowerCase()).toContain("switch away from this tab");
  });

  it("states that leaving costs nothing", async () => {
    const text = await consentText();
    expect(text.toLowerCase()).toContain("voluntary");
    expect(text.toLowerCase()).toContain("no consequences");
  });

  it("cannot be consented to without confirming adulthood", async () => {
    // The screening gate already turns away under-18s, but a consent form is
    // also a record, and it has to record the affirmation itself.
    const user = await reachConsent();
    const button = screen.getByTestId("give-consent") as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    await user.click(screen.getByTestId("confirm-adult"));
    expect(button.disabled).toBe(false);
  });

  it("does not proceed while the box is unticked", async () => {
    const user = await reachConsent();
    await user.click(screen.getByTestId("give-consent"));
    // Still on consent: the click did nothing.
    expect(screen.getByTestId("screen").dataset["state"]).toBe("consent");
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

  it("discloses every planted error with its correct value", async () => {
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

  it("explains why the details were held back, without giving the direction", async () => {
    // A debrief has to justify the deception, and must not hand the
    // participant the hypothesis -- they may talk to future participants.
    await reachDebrief();
    const text = screen.getByTestId("debrief-manipulation").textContent ?? "";
    expect(text.toLowerCase()).toContain("if we had told you");
    // No directional claim: nothing saying which style was expected to win.
    expect(text.toLowerCase()).not.toMatch(/we expect(ed)? (that )?(the )?warm/);
    expect(text.toLowerCase()).not.toMatch(/more likely to (accept|rely)/);
  });

  it("says some arguments were deliberately weak", async () => {
    await reachDebrief();
    const text = screen.getByTestId("debrief-manipulation").textContent ?? "";
    expect(text.toLowerCase()).toContain("on purpose");
    expect(text.toLowerCase()).toContain("weak");
  });

  it("offers a button that removes the participant's data from the study", async () => {
    const user = await reachDebrief();
    const remove = screen.getByTestId("debrief-withdraw");
    expect(remove.textContent?.toLowerCase()).toContain("delete");

    await user.click(remove);
    expect(screen.getByTestId("screen").dataset["state"]).toBe("withdrawn");
  });

  it("discloses the style manipulation itself, not only the planted errors", async () => {
    // The debrief revealed the wrong answers and said nothing about the
    // study's independent variable: that the participant was randomly assigned
    // a warm or a neutral advisor. Debriefing the errors but not the
    // manipulation explains the deception while hiding the experiment.
    await reachDebrief();
    const disclosure = screen.getByTestId("debrief-manipulation").textContent ?? "";
    expect(disclosure.toLowerCase()).toContain("random");
    expect(disclosure.toLowerCase()).toContain("warm");
    expect(disclosure.toLowerCase()).toContain("neutral");
    // And the argument-quality half of the design, which is also manipulated.
    expect(disclosure.toLowerCase()).toContain("strong");
    expect(disclosure.toLowerCase()).toContain("weak");
  });

  it("cites a source for every correction, which is what makes it checkable", async () => {
    await reachDebrief();
    // The screen renders `item.sources[0]`. Nothing above proved a source is
    // actually there: an item bank entry with an empty `sources` array would
    // render the label and no citation, and every existing assertion would
    // still pass. A debrief that says "Source:" and stops is worse than one
    // that says nothing, because it looks like it has been checked.
    for (const item of items.filter((i) => i.is_error)) {
      const citation = screen.getByTestId(`debrief-${item.id}-source`).textContent ?? "";
      expect(citation.trim(), `${item.id} has no citation`).not.toHaveLength(0);
      expect(citation).toContain(item.sources[0]!.citation);
    }
  });

  it("is the only way to reach done, so nobody finishes undebriefed", () => {
    // "Debrief screen after completion" is a claim about reachability, not
    // about a screen existing. If any other state could target done, a
    // participant could finish without being told about the planted errors --
    // and the withdrawal offer that follows disclosure would go with it.
    const machine = createSessionMachine(ITEM_IDS);
    const targetsDone = Object.entries(machine.states).filter(([name, state]) => {
      if (name === "debrief") return false;
      return JSON.stringify(state.config.on ?? {}).includes('"done"');
    });
    expect(targetsDone.map(([name]) => name)).toEqual([]);
    expect(JSON.stringify(machine.states["debrief"]!.config.on)).toContain("done");
  });

  it("keeps disclosure tied to the planted error, not to the quality label", async () => {
    await reachDebrief();
    // v2 relabelled item_08 and item_12 weak. They are still correct answers,
    // so they must stay out of the debrief. Keying disclosure off the quality
    // label instead of `is_error` would "correct" two answers that were never
    // wrong -- telling a participant they were deceived when they were not.
    for (const id of ["item_08", "item_12"]) {
      expect(items.find((i) => i.id === id)!.is_error).toBe(false);
      expect(screen.queryByTestId(`debrief-${id}`)).toBeNull();
    }
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
