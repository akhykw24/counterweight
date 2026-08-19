import { expect, test, type Page } from "@playwright/test";

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

/** Reads the write-ahead log straight out of IndexedDB. */
async function walTypes(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const records = await new Promise<{ seq: number; event: { type: string } }[]>(
      (resolve, reject) => {
        const request = indexedDB.open("eiai-telemetry");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const tx = request.result.transaction("events", "readonly");
          const all = tx.objectStore("events").getAll();
          all.onsuccess = () => resolve(all.result);
          all.onerror = () => reject(all.error);
        };
      },
    );
    return records.sort((a, b) => a.seq - b.seq).map((record) => record.event.type);
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  // Each test is a fresh participant.
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase("eiai-telemetry");
      request.onsuccess = resolve;
      request.onerror = resolve;
      request.onblocked = resolve;
    });
  });
  await page.reload();
});

test("an adult completes a full twelve-item session", async ({ page }) => {
  test.setTimeout(120_000);

  await expect(page.locator(testId("screen-eligibility"))).toBeVisible();
  await page.locator(testId("lang-en")).click();
  await page.locator(testId("age-25+")).click();
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
  expect(await allocateButton.getAttribute("data-stratum")).toBe("en:adult");
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

  // --- the log ---
  const types = await walTypes(page);
  for (const required of [
    "SESSION_STARTED", "CONSENT_GIVEN", "ALLOCATED", "ITEM_PRESENTED",
    "ESTIMATE_CHANGED", "CONFIDENCE_SET", "RESPONSE_REVEALED",
    "FOLLOWUP_SELECTED", "VERIFY_CLICKED", "ESTIMATE_FINALIZED",
    "QUESTIONNAIRE_ANSWERED", "FUNNEL_RESPONSE", "SESSION_COMPLETED",
  ]) {
    expect(types, `missing ${required}`).toContain(required);
  }
  expect(types.filter((type) => type === "ITEM_PRESENTED")).toHaveLength(12);
  expect(types.filter((type) => type === "ESTIMATE_FINALIZED")).toHaveLength(12);
  expect(types.filter((type) => type === "FUNNEL_RESPONSE")).toHaveLength(3);
});

test("a minor is routed through assent and cannot reach adult consent", async ({ page }) => {
  await page.locator(testId("lang-en")).click();
  await page.locator(testId("age-14-15")).click();
  await page.locator(testId("training-no")).click();
  await page.locator(testId("submit-eligibility")).click();

  await expect(page.locator(testId("screen-assent"))).toBeVisible();
  await expect(page.locator(testId("screen-consent"))).toHaveCount(0);

  // Assent is blocked until the parental form's session code is entered.
  await expect(page.locator(testId("give-assent"))).toBeDisabled();
  await page.locator(testId("parental-code")).fill("PC-2026-014");
  await expect(page.locator(testId("give-assent"))).toBeEnabled();
  await page.locator(testId("give-assent")).click();

  await expect(page.locator(testId("screen-allocating"))).toBeVisible();
});

test("screening excludes formal training", async ({ page }) => {
  await page.locator(testId("lang-en")).click();
  await page.locator(testId("age-25+")).click();
  await page.locator(testId("training-yes")).click();
  await page.locator(testId("submit-eligibility")).click();

  await expect(page.locator(testId("screen-ineligible"))).toBeVisible();
});

test("a reload mid-session resumes on the same item and loses nothing", async ({ page }) => {
  await page.locator(testId("lang-en")).click();
  await page.locator(testId("age-25+")).click();
  await page.locator(testId("training-no")).click();
  await page.locator(testId("submit-eligibility")).click();
  await page.locator(testId("give-consent")).click();
  await page.locator(testId("allocate")).click();

  await tapSlider(page, "initial-estimate");
  await setSlider(page, "initial-confidence", 15);
  await page.locator(testId("submit-initial")).click();
  await expect(page.locator(testId("advice"))).toBeVisible();

  const before = await walTypes(page);
  await page.reload();

  await expect(page.locator(testId("advice"))).toBeVisible();
  expect(await screenName(page)).toBe("task.advice");

  const after = await walTypes(page);
  // Nothing is lost, and the resumed opening is recorded.
  expect(after.length).toBeGreaterThan(before.length);
  expect(after.slice(0, before.length)).toEqual(before);
  expect(after.filter((type) => type === "SESSION_STARTED").length).toBe(2);
});

test("withdrawal is available from the item screen and ends the session", async ({ page }) => {
  await page.locator(testId("lang-en")).click();
  await page.locator(testId("age-25+")).click();
  await page.locator(testId("training-no")).click();
  await page.locator(testId("submit-eligibility")).click();
  await page.locator(testId("give-consent")).click();
  await page.locator(testId("allocate")).click();

  await page.locator(testId("withdraw")).click();
  await page.locator(testId("withdraw-confirm")).click();

  await expect(page.locator(testId("screen-withdrawn"))).toBeVisible();
  expect(await walTypes(page)).toContain("SESSION_WITHDRAWN");
});
