import { expect, test, type Page } from "@playwright/test";

/**
 * The minor consent branch, walked end to end.
 *
 * The existing minor test stopped at the allocating screen, so half the consent
 * design had never actually been completed in a browser -- exactly the topology
 * of the allocation stub the bots found, where a branch existed in the
 * statechart but no test ever went down it.
 *
 * This session is deliberately Kazakh as well as minor, because that combination
 * exercises three things at once that had never been exercised together: the
 * assent flow, the `kk:minor` stratum, and non-Latin stimulus resolution. UI
 * chrome is still English (translations are human work, see README §11); the
 * question stems and the advice are Kazakh, and those are what the participant
 * is actually reasoning about.
 */

const testId = (id: string) => `[data-testid="${id}"]`;

interface WalRecord {
  seq: number;
  event: { type: string; payload: Record<string, unknown> };
}

async function readWal(page: Page): Promise<WalRecord[]> {
  return page.evaluate(async () => {
    const records = await new Promise<WalRecord[]>((resolve, reject) => {
      const request = indexedDB.open("eiai-telemetry");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const tx = request.result.transaction("events", "readonly");
        const all = tx.objectStore("events").getAll();
        all.onsuccess = () => resolve(all.result as WalRecord[]);
        all.onerror = () => reject(all.error);
      };
    });
    return records.sort((a, b) => a.seq - b.seq);
  });
}

/**
 * Sets a slider and confirms the machine received it.
 *
 * `fill()` alone is not enough: writing the value the input already holds
 * dispatches no event, so the machine keeps `null` and the submit button stays
 * disabled. That is not an app defect -- the slider shows "Move the slider to
 * set your answer. If the current position is right, click it to confirm." and
 * commits on pointer release -- but a test that only fills can land on the
 * resting midpoint and block itself. Clicking afterwards is what a participant
 * does, and it commits whatever is displayed.
 */
async function setSlider(page: Page, id: string, value: number): Promise<void> {
  const slider = page.locator(testId(id));
  await slider.fill(String(value));
  await slider.click();
  await expect(page.locator(testId(`${id}-value`))).not.toHaveText("—");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
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

test("a Kazakh minor completes a full session through assent", async ({ page }) => {
  test.setTimeout(180_000);

  await page.locator(testId("lang-kk")).click();
  await page.locator(testId("age-16-17")).click();
  await page.locator(testId("training-no")).click();
  await page.locator(testId("submit-eligibility")).click();

  // --- assent, not consent ------------------------------------------------
  await expect(page.locator(testId("screen-assent"))).toBeVisible();
  await expect(page.locator(testId("screen-consent"))).toHaveCount(0);
  await expect(page.locator(testId("give-assent"))).toBeDisabled();
  await page.locator(testId("parental-code")).fill("PC-2026-221");
  await page.locator(testId("give-assent")).click();

  // --- allocation follows the eligibility answers -------------------------
  const allocate = page.locator(testId("allocate"));
  const condition = await allocate.getAttribute("data-condition");
  // The stratum has to be the one this participant actually is. Before the
  // allocation fix it would have read "en:adult" for everybody.
  expect(await allocate.getAttribute("data-stratum")).toBe("kk:minor");
  expect(condition === "warm" || condition === "neutral").toBe(true);
  await allocate.click();

  // --- twelve items, in Kazakh --------------------------------------------
  for (let index = 0; index < 12; index += 1) {
    await expect(page.locator(testId("screen-item-estimate"))).toBeVisible();

    const estimate = page.locator(testId("initial-estimate"));
    const max = Number(await estimate.getAttribute("max"));
    await setSlider(page, "initial-estimate", Math.round(max * 0.4));
    await setSlider(page, "initial-confidence", index % 3 === 0 ? 25 : 65);
    await page.locator(testId("submit-initial")).click();

    // The served stimulus must be the Kazakh one for the assigned arm. This is
    // the assertion that would have failed while the advice screen defaulted to
    // `context.language ?? "en"` -- silently, because the response id it logged
    // was internally consistent.
    const responseId = await page.locator(testId("advice")).getAttribute("data-response-id");
    expect(responseId, "served stimulus must match the allocation").toMatch(
      new RegExp(`^kk_${condition}_`),
    );

    await page.locator(testId("request-final")).click();
    await setSlider(page, "final-estimate", Math.round(max * 0.45));
    await setSlider(page, "final-confidence", index % 2 === 0 ? 72 : 31);
    await expect(page.locator(testId("submit-final"))).toBeEnabled();
    await page.locator(testId("submit-final")).click();
  }

  // --- questionnaire, funnel, debrief -------------------------------------
  await expect(page.locator(testId("screen-questionnaire"))).toBeVisible();
  for (const id of [
    "warmth_01", "warmth_02", "warmth_03", "warmth_04", "warmth_05",
    "competence_01", "competence_02", "competence_03", "competence_04",
    "trust_01", "trust_02", "trust_03", "trust_04", "cov_prior_knowledge",
  ]) {
    await page.locator(testId(`${id}-4`)).click();
  }
  await page.locator(testId("cov_gender-prefer_not_to_say")).click();
  await page.locator(testId("cov_ai_usage-2")).click();
  await page.locator(testId("submit-questionnaire")).click();

  await page.locator(testId("funnel-purpose-text")).fill("Assistant answers.");
  await page.locator(testId("funnel-purpose-submit")).click();
  await page.locator(testId("funnel-anomaly-text")).fill("No.");
  await page.locator(testId("funnel-anomaly-submit")).click();
  await page.locator(testId("funnel-belief-yes")).click();

  // A minor must still be told about every planted error.
  await expect(page.locator(testId("screen-debrief"))).toBeVisible();
  for (const itemId of ["item_03", "item_05", "item_09", "item_11"]) {
    await expect(page.locator(testId(`debrief-${itemId}-true`))).not.toBeEmpty();
  }
  await page.locator(testId("submit-debrief")).click();
  await expect(page.locator(testId("screen-done"))).toBeVisible();

  // --- the log describes a minor, not the screen that fired --------------
  const wal = await readWal(page);
  const types = wal.map((record) => record.event.type);
  expect(types, "a minor must not emit adult consent").not.toContain("CONSENT_GIVEN");
  expect(types).toContain("ASSENT_GIVEN");
  expect(types.filter((type) => type === "ESTIMATE_FINALIZED")).toHaveLength(12);

  const allocated = wal.find((record) => record.event.type === "ALLOCATED");
  expect(allocated?.event.payload["stratum"]).toBe("kk:minor");

  // SESSION_STARTED.locale is the BROWSER's locale at first load, recorded
  // before the participant has chosen anything. It is deliberately not their
  // language: the chosen language becomes authoritative at allocation, which is
  // why replay derives `language` from the stratum and keeps the two apart.
  const started = wal.find((record) => record.event.type === "SESSION_STARTED");
  expect(started?.event.payload["locale"], "browser locale, not the choice").toBeDefined();

  // Every revealed stimulus is Kazakh and in the assigned arm.
  for (const record of wal.filter((r) => r.event.type === "RESPONSE_REVEALED")) {
    expect(String(record.event.payload["response_id"])).toMatch(new RegExp(`^kk_${condition}_`));
  }

  const assent = wal.find((record) => record.event.type === "ASSENT_GIVEN");
  expect(assent?.event.payload["parental_consent_code"]).toBe("PC-2026-221");
});

test("an adult in the same language emits consent, not assent", async ({ page }) => {
  // The mirror of the above. Together these two walk both consent arms to the
  // point where they diverge, so neither can quietly stop working.
  await page.locator(testId("lang-kk")).click();
  await page.locator(testId("age-25+")).click();
  await page.locator(testId("training-no")).click();
  await page.locator(testId("submit-eligibility")).click();

  await expect(page.locator(testId("screen-consent"))).toBeVisible();
  await expect(page.locator(testId("screen-assent"))).toHaveCount(0);
  await page.locator(testId("give-consent")).click();

  expect(await page.locator(testId("allocate")).getAttribute("data-stratum")).toBe("kk:adult");

  const wal = await readWal(page);
  const consent = wal.find((record) => record.event.type === "CONSENT_GIVEN");
  // The flow must describe the participant. It used to be the literal "adult"
  // regardless of who was on the screen.
  expect(consent?.event.payload["flow"]).toBe("adult");
  expect(wal.map((r) => r.event.type)).not.toContain("ASSENT_GIVEN");
});
