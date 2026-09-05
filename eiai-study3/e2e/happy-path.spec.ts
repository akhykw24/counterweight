import { expect, test, type Page } from "@playwright/test";
import {
  resetParticipant,
  rowsFor,
  sessionIdOf,
  typesFor,
  waitForType,
} from "./event-log.js";

/**
 * Happy path, end to end, in a real browser (day 5 done-criterion).
 *
 * The vitest suites already drive every generated statechart path, but they do
 * it in jsdom with a faked IndexedDB and no layout. This exists to catch what
 * that cannot: a stimulus that fails to bundle, a scroll container with no
 * extent, a write-ahead log that will not open, a screen that renders but does
 * not fit.
 */

const testId = (id: string) => `[data-testid="${id}"]`;

async function screenName(page: Page): Promise<string | null> {
  return page.locator(testId("screen")).getAttribute("data-state");
}

/** Commits a slider at its resting position, as an agreeing participant would. */
async function tapSlider(page: Page, id: string): Promise<void> {
  const slider = page.locator(testId(id));
  await slider.click();
  await expect(page.locator(testId(`${id}-value`))).not.toHaveText("—");
}

async function setSlider(page: Page, id: string, value: number): Promise<void> {
  await page.locator(testId(id)).fill(String(value));
}

/*
 * Events are read from the server's store (./event-log.ts), not from the
 * browser's write-ahead log.
 *
 * These tests used to read IndexedDB directly, which worked only while nothing
 * consumed it: the log is a buffer, and delivered events are removed from it.
 * Once the dev server started accepting events, reading it at the end of a
 * session returned only the undelivered tail. The server's copy is the one the
 * analysis runs on, so asserting against it makes "recorded" and "received"
 * one claim instead of two.
 */

test.beforeEach(async ({ page }) => {
  // Each test is a fresh participant.
  await resetParticipant(page);
});

test("an adult completes a full twelve-item session", async ({ page }) => {
  test.setTimeout(120_000);

  await expect(page.locator(testId("screen-eligibility"))).toBeVisible();
  await page.locator(testId("age-35+")).click();
  await page.locator(testId("cefr-B2")).click();
  await page.locator(testId("study-language-english")).click();
  await page.locator(testId("training-no")).click();
  await page.locator(testId("submit-eligibility")).click();

  await expect(page.locator(testId("screen-consent"))).toBeVisible();
  await page.locator(testId("give-consent")).click();

  // The condition now comes from the committed allocation sequence keyed on the
  // session id, so it is genuinely either arm from one run to the next. This
  // test used to assert `warm` outright, which passed only because allocation
  // was hard-coded -- and would therefore never have exercised the neutral arm.
  const allocateButton = page.locator(testId("allocate"));
  const condition = await allocateButton.getAttribute("data-condition");
  expect(condition === "warm" || condition === "neutral").toBe(true);
  // Strata are configuration (materials/strata.json), so the assertion is that
  // the participant landed in one of the configured ones -- naming a literal
  // here is what made the previous version outlive the design it described.
  const stratum = await allocateButton.getAttribute("data-stratum");
  expect(["B1-B2", "C1-C2/native"]).toContain(stratum);
  await allocateButton.click();

  for (let i = 0; i < 12; i += 1) {
    await expect(page.locator(testId("screen-item-estimate"))).toBeVisible();
    await expect(page.locator(testId("progress"))).toHaveText(`Question ${i + 1} of 12`);

    await tapSlider(page, "initial-estimate");
    // Vary confidence so all three registers are exercised across the session.
    await setSlider(page, "initial-confidence", i < 4 ? 15 : i < 8 ? 55 : 90);
    await page.locator(testId("submit-initial")).click();

    // The frozen stimulus the register selected. In the warm arm the register
    // must track confidence; the neutral arm does not branch at all, and that
    // non-branching is constitutive of the control rather than an omission.
    const responseId = await page.locator(testId("advice")).getAttribute("data-response-id");
    if (condition === "warm") {
      const expectedRegister = i < 4 ? "low" : i < 8 ? "moderate" : "high";
      expect(responseId).toContain(`warm_${expectedRegister}`);
    } else {
      expect(responseId).toContain("neutral_na");
    }
    await expect(page.locator(testId("advice-justification"))).not.toBeEmpty();

    // Exercise a follow-up and the verify button on the first item.
    if (i === 0) {
      await page.locator(testId("followup-challenge")).click();
      await expect(page.locator(testId("followup-challenge-reply"))).toBeVisible();
      await page.locator(testId("verify")).click();
      await expect(page.locator(testId("verify-noted"))).toBeVisible();
    }

    await page.locator(testId("request-final")).click();
    await tapSlider(page, "final-estimate");
    await tapSlider(page, "final-confidence");
    await page.locator(testId("submit-final")).click();
    // Perceived argument strength, asked once per item after the estimate.
    await page.locator(testId("argument-strength-4")).click();
  }

  // --- questionnaire ---
  await expect(page.locator(testId("screen-questionnaire"))).toBeVisible();
  for (const prefix of ["warmth_01", "warmth_02", "warmth_03", "warmth_04", "warmth_05",
                        "competence_01", "competence_02", "competence_03", "competence_04",
                        "trust_01", "trust_02", "trust_03", "trust_04",
                        "cov_prior_knowledge"]) {
    await page.locator(testId(`${prefix}-5`)).click();
  }
  await page.locator(testId("cov_gender-prefer_not_to_say")).click();
  await page.locator(testId("cov_ai_usage-3")).click();
  await page.locator(testId("submit-questionnaire")).click();

  // --- funnel: three screens, forward only ---
  await expect(page.locator(testId("screen-funnel-purpose"))).toBeVisible();
  await page.locator(testId("funnel-purpose-text")).fill("How people use AI assistants.");
  await page.locator(testId("funnel-purpose-submit")).click();

  await expect(page.locator(testId("screen-funnel-anomaly"))).toBeVisible();
  await page.locator(testId("funnel-anomaly-text")).fill("Nothing I noticed.");
  await page.locator(testId("funnel-anomaly-submit")).click();

  await expect(page.locator(testId("screen-funnel-belief"))).toBeVisible();
  await page.locator(testId("funnel-belief-unsure")).click();

  // --- debrief discloses every planted error with its correct value ---
  await expect(page.locator(testId("screen-debrief"))).toBeVisible();
  for (const itemId of ["item_03", "item_05", "item_09", "item_11"]) {
    await expect(page.locator(testId(`debrief-${itemId}`))).toBeVisible();
    await expect(page.locator(testId(`debrief-${itemId}-true`))).not.toBeEmpty();
    await expect(page.locator(testId(`debrief-${itemId}-told`))).not.toBeEmpty();
  }
  await expect(page.locator(testId("debrief-withdraw"))).toBeVisible();

  await page.locator(testId("submit-debrief")).click();
  await expect(page.locator(testId("screen-done"))).toBeVisible();
  expect(await screenName(page)).toBe("done");

  // Withdrawal is not offered once the session is over.
  await expect(page.locator(testId("withdraw"))).toHaveCount(0);

  // --- the log, as the server received it ---
  // Delivery is asynchronous, so the completed session is waited for rather
  // than read immediately: an assertion that ran before the last flush would
  // fail for a reason that has nothing to do with the study.
  const id = await sessionIdOf(page);
  await waitForType(id, "SESSION_COMPLETED", 1);
  const types = typesFor(id);
  for (const required of [
    "SESSION_STARTED", "CONSENT_GIVEN", "ALLOCATED", "ITEM_PRESENTED",
    "ESTIMATE_CHANGED", "CONFIDENCE_SET", "RESPONSE_REVEALED",
    "FOLLOWUP_SELECTED", "VERIFY_CLICKED", "ESTIMATE_FINALIZED", "ARGUMENT_RATED",
    "QUESTIONNAIRE_ANSWERED", "FUNNEL_RESPONSE", "SESSION_COMPLETED",
  ]) {
    expect(types, `missing ${required}`).toContain(required);
  }
  expect(types.filter((type) => type === "ITEM_PRESENTED")).toHaveLength(12);
  expect(types.filter((type) => type === "ESTIMATE_FINALIZED")).toHaveLength(12);
  expect(types.filter((type) => type === "ARGUMENT_RATED")).toHaveLength(12);
  expect(types.filter((type) => type === "FUNNEL_RESPONSE")).toHaveLength(3);
});

test("under-18 is screened out before consent, with a reason and no data", async ({ page }) => {
  await page.locator(testId("age-under-18")).click();
  await page.locator(testId("cefr-C1")).click();
  await page.locator(testId("study-language-english")).click();
  await page.locator(testId("training-no")).click();
  await page.locator(testId("submit-eligibility")).click();

  const screen = page.locator(testId("screen-screened-out"));
  await expect(screen).toBeVisible();
  await expect(screen).toHaveAttribute("data-reason", "age");
  // The consent screen must be unreachable: v2 admits adults only, and the
  // point of screening before consent is that nobody under 18 is ever asked.
  await expect(page.locator(testId("screen-consent"))).toHaveCount(0);

  // Only the screening outcome is recorded. Nothing identifies the visitor.
  const id = await sessionIdOf(page);
  await waitForType(id, "SCREENED_OUT", 1);
  const types = typesFor(id);
  expect(types).toContain("SCREENED_OUT");
  expect(types).not.toContain("CONSENT_GIVEN");
  expect(types).not.toContain("ALLOCATED");
});

test("English below B1 is screened out", async ({ page }) => {
  await page.locator(testId("age-25-34")).click();
  await page.locator(testId("cefr-A2")).click();
  await page.locator(testId("study-language-english")).click();
  await page.locator(testId("training-no")).click();
  await page.locator(testId("submit-eligibility")).click();

  const screen = page.locator(testId("screen-screened-out"));
  await expect(screen).toBeVisible();
  await expect(screen).toHaveAttribute("data-reason", "language");
});

test("screening excludes formal training", async ({ page }) => {
  await page.locator(testId("age-35+")).click();
  await page.locator(testId("cefr-B2")).click();
  await page.locator(testId("study-language-english")).click();
  await page.locator(testId("training-yes")).click();
  await page.locator(testId("submit-eligibility")).click();

  await expect(page.locator(testId("screen-screened-out"))).toHaveAttribute(
    "data-reason",
    "prior_training",
  );
});

test("a reload mid-session resumes on the same item and loses nothing", async ({ page }) => {
  await page.locator(testId("age-35+")).click();
  await page.locator(testId("cefr-B2")).click();
  await page.locator(testId("study-language-english")).click();
  await page.locator(testId("training-no")).click();
  await page.locator(testId("submit-eligibility")).click();
  await page.locator(testId("give-consent")).click();
  await page.locator(testId("allocate")).click();

  await tapSlider(page, "initial-estimate");
  await setSlider(page, "initial-confidence", 15);
  await page.locator(testId("submit-initial")).click();
  await expect(page.locator(testId("advice"))).toBeVisible();

  const id = await sessionIdOf(page);
  await waitForType(id, "RESPONSE_REVEALED", 1);
  const before = rowsFor(id).map((row) => row.event_id);

  await page.reload();

  await expect(page.locator(testId("advice"))).toBeVisible();
  expect(await screenName(page)).toBe("task.advice");

  // The resume is itself an event, so waiting for the second SESSION_STARTED
  // is what tells us the post-reload flush has landed.
  await waitForType(id, "SESSION_STARTED", 2);

  // Nothing recorded before the reload was lost, and nothing was duplicated.
  const after = rowsFor(id).map((row) => row.event_id);
  expect(after.slice(0, before.length)).toEqual(before);
  expect(new Set(after).size).toBe(after.length);
  expect(typesFor(id).filter((type) => type === "SESSION_STARTED")).toHaveLength(2);
});

test("withdrawal is available from the item screen and ends the session", async ({ page }) => {
  await page.locator(testId("age-35+")).click();
  await page.locator(testId("cefr-B2")).click();
  await page.locator(testId("study-language-english")).click();
  await page.locator(testId("training-no")).click();
  await page.locator(testId("submit-eligibility")).click();
  await page.locator(testId("give-consent")).click();
  await page.locator(testId("allocate")).click();

  await page.locator(testId("withdraw")).click();
  await page.locator(testId("withdraw-confirm")).click();

  await expect(page.locator(testId("screen-withdrawn"))).toBeVisible();
  const id = await sessionIdOf(page);
  await waitForType(id, "SESSION_WITHDRAWN", 1);
  expect(typesFor(id)).toContain("SESSION_WITHDRAWN");
});
