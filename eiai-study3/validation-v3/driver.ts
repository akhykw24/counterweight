import { devices, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * Drives the v3 study the way a participant does. Shared by the pre-pilot
 * validation (local server) and the production walkthrough, so both exercise
 * exactly the same clicks.
 */

export const tid = (id: string) => `[data-testid="${id}"]`;

export async function open(browser: Browser, query: string, mobile = false): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(mobile ? { ...devices["Pixel 5"] } : {});
  const page = await context.newPage();
  await page.goto(`/?${query}`);
  return { context, page };
}

export async function sessionIdOf(page: Page): Promise<string> {
  const id = await page.evaluate(() => localStorage.getItem("eiai.v3.session_id"));
  expect(id, "the app never wrote a session id").toBeTruthy();
  return id!;
}

export async function undelivered(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const records = await new Promise<unknown[]>((done, fail) => {
      const request = indexedDB.open("eiai-telemetry");
      request.onerror = () => fail(request.error);
      request.onsuccess = () => {
        const all = request.result.transaction("events", "readonly").objectStore("events").getAll();
        all.onsuccess = () => done(all.result);
        all.onerror = () => fail(all.error);
      };
    });
    return records.length;
  });
}

export async function consentAndScreen(page: Page, age = "30", level = "B2"): Promise<void> {
  await page.locator(tid("consent-adult")).check();
  await page.locator(tid("consent-agree")).check();
  await page.locator(tid("consent-start")).click();
  await page.locator(tid("screening-age")).fill(age);
  await page.locator(tid(`english-${level}`)).click();
  await page.locator(tid("study-language-English")).click();
  await page.locator(tid("screening-submit")).click();
}

export async function preMeasures(page: Page): Promise<void> {
  for (const id of ["P1", "P2"]) await page.locator(tid(`${id}-4`)).click();
  await page.locator(tid("P3-3")).click();
  await page.locator(tid("pre-submit")).click();
}

export async function nova(page: Page): Promise<void> {
  await page.locator(tid("nova-continue")).click();
}

/** Continue through the rest of a module's lesson, from message `from` (1-based). */
export async function lesson(page: Page, from = 1): Promise<void> {
  for (let n = from; n <= 4; n += 1) {
    await expect(page.locator(tid(`lesson-message-${n}`))).toBeVisible({ timeout: 10_000 });
    await page.locator(tid("lesson-continue")).click();
    if (n < 4) await expect(page.locator(tid(`lesson-message-${n + 1}`))).toBeAttached({ timeout: 10_000 });
  }
}

export const MISSION_OR_AFTER = `${tid("screen-mission-task")}, ${tid("screen-attention")}, [data-testid^="screen-transition"]`;

/** Answers one mission screen; returns false once the module's mission is over. */
export async function missionStep(page: Page, option = 1, clickCount = 1): Promise<boolean> {
  const screen = page.locator(MISSION_OR_AFTER).first();
  await screen.waitFor();
  const testid = await screen.getAttribute("data-testid");
  if (testid === "screen-attention") {
    await page.locator(tid("attention-Olympus")).click();
    await page.locator(tid("mission-next")).click({ clickCount, delay: 30 });
    await expect(page.locator(tid("screen-attention"))).toHaveCount(0);
    return true;
  }
  if (testid === "screen-mission-task") {
    const task = await screen.getAttribute("data-task");
    await page.locator(tid(`option-${option}`)).click();
    await page.locator(tid("confidence-3")).click();
    await page.locator(tid("mission-next")).click({ clickCount, delay: 30 });
    await expect(page.locator(`[data-task="${task}"]`)).toHaveCount(0);
    return true;
  }
  return false;
}

export async function mission(page: Page, option = 1): Promise<void> {
  while (await missionStep(page, option)) {
    /* next screen */
  }
}

export async function ratePage(page: Page, screen: string, point = 5): Promise<void> {
  const section = page.locator(tid(`screen-${screen}`));
  await section.waitFor();
  const first = await section.locator('[data-testid^="q-"]').first().getAttribute("data-testid");
  const ids = await section.locator('[data-testid^="scale-"]').evaluateAll((els) =>
    els.map((e) => e.getAttribute("data-testid")!.slice("scale-".length)),
  );
  for (const id of ids) await section.locator(tid(`${id}-${point}`)).click();
  await page.locator(tid(`${screen}-next`)).click();
  await expect(page.locator(tid(first!))).toHaveCount(0);
}

export async function afterModules(page: Page, pilotFlow: boolean): Promise<void> {
  for (let i = 0; i < 4; i += 1) await ratePage(page, "quiz");
  // The funnel comes straight after the quiz (order revised after the pilot).
  for (const id of ["F1", "F2", "F3"]) {
    await page.locator(tid(`funnel-${id}-text`)).fill(id === "F1" ? "How people learn from an AI tutor." : "");
    await page.locator(tid("funnel-next")).click();
    await expect(page.locator(tid(`screen-funnel-${id}`))).toHaveCount(0);
  }
  await page.locator(tid("funnel-F4-2")).click();
  await page.locator(tid("funnel-next")).click();
  for (let i = 0; i < 2; i += 1) await ratePage(page, "tutor", 4);
  await ratePage(page, "quality", 4);
  await ratePage(page, "trust", 4);
  await page.locator(tid("D1-4")).click();
  await page.locator(tid("D2-text")).fill("Kazakhstan");
  await page.locator(tid("D3-1")).click();
  await page.locator(tid("D4-1")).click();
  await page.locator(tid("demographics-next")).click();
  if (pilotFlow) {
    await page.locator(tid("pilot-PF2")).fill("Validation bot: nothing to report.");
    await page.locator(tid("pilot-next")).click();
  }
  await expect(page.locator(tid("screen-debrief"))).toBeVisible();
}

export async function fullSession(page: Page, pilotFlow = true, option = 1): Promise<string> {
  await consentAndScreen(page);
  const id = await sessionIdOf(page);
  await preMeasures(page);
  await nova(page);
  for (let module = 1; module <= 3; module += 1) {
    await lesson(page);
    await mission(page, option);
    await nova(page); // transition after the module
  }
  await afterModules(page, pilotFlow);
  return id;
}

export async function drained(page: Page): Promise<boolean> {
  try {
    await expect.poll(() => undelivered(page), { timeout: 60_000 }).toBe(0);
    return true;
  } catch {
    return false;
  }
}

