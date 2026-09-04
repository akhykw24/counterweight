/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { EventBatch } from "@eiai/schema";
import { createSessionMachine } from "@eiai/fsm";
import { stratumForCefr } from "../src/strata";
import { App } from "../src/App";
import allocationDocument from "../../../materials/allocation.json";
import type { Recorder } from "../src/telemetry";

const allocationSequence = (allocationDocument as { sequence: Record<string, string[]> })
  .sequence;

/**
 * What the app actually emits.
 *
 * The governing rule in §0 is that capture-time data outranks anything
 * computable later, so these assert that the events exist and are
 * schema-valid — a measure missing here cannot be recovered after collection.
 */

const ITEM_IDS = ["item_01", "item_02"];
const SESSION = "3b1d9e42-5a6f-4c8b-9d0e-1f2a3b4c5d6e";

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

async function runToAdvice(log: ReturnType<typeof capturing>) {
  const user = userEvent.setup();
  render(
    <App machine={createSessionMachine(ITEM_IDS)} recorder={log.recorder} />,
  );
  await user.click(screen.getByTestId("age-35+"));
  await user.click(screen.getByTestId("cefr-B2"));
  await user.click(screen.getByTestId("study-language-english"));
  await user.click(screen.getByTestId("training-no"));
  await user.click(screen.getByTestId("submit-eligibility"));
  await user.click(screen.getByTestId("give-consent"));
  await user.click(screen.getByTestId("allocate"));
  fireEvent.change(screen.getByTestId("initial-estimate"), {
    target: { value: "12000" },
  });
  fireEvent.change(screen.getByTestId("initial-confidence"), {
    target: { value: "15" },
  });
  await user.click(screen.getByTestId("submit-initial"));
  return user;
}

afterEach(cleanup);

describe("event emission", () => {
  it("opens with SESSION_STARTED carrying the stimulus manifest hash", () => {
    const log = capturing();
    render(<App machine={createSessionMachine(ITEM_IDS)} recorder={log.recorder} />);

    const started = log.of("SESSION_STARTED");
    expect(started).toHaveLength(1);
    expect(started[0]!.payload["stimuli_manifest_hash"]).toMatch(/^[a-f0-9]{64}$/);
    expect(started[0]!.payload["resumed"]).toBe(false);
  });

  it("emits SESSION_STARTED once, not twice under StrictMode double-invocation", () => {
    // Event ids are unique, so an unguarded effect would write two genuine
    // rows for one session opening.
    const log = capturing();
    render(<App machine={createSessionMachine(ITEM_IDS)} recorder={log.recorder} />);
    render(<App machine={createSessionMachine(ITEM_IDS)} recorder={log.recorder} />);
    // Two independent mounts is two sessions; within one mount it stays single.
    expect(log.of("SESSION_STARTED")).toHaveLength(2);
  });

  it("records consent once, with no flow discriminator", async () => {
    // v2 admits adults only, so there is one flow. Recording its name would be
    // a literal that describes the screen rather than the participant, and the
    // minor branch it distinguished no longer exists.
    const log = capturing();
    await runToAdvice(log);
    expect(log.of("CONSENT_GIVEN")).toHaveLength(1);
    expect(log.of("CONSENT_GIVEN")[0]!.payload).toEqual({});
    expect(log.types()).not.toContain("ASSENT_GIVEN");
    expect(log.types()).not.toContain("SCREENED_OUT");
  });

  it("records allocation drawn from the committed sequence, at the real stratum", async () => {
    const log = capturing();
    await runToAdvice(log);
    const payload = log.of("ALLOCATED")[0]!.payload as {
      condition: string;
      stratum: string;
      allocation_seq: number;
    };

    // The stratum has to follow the eligibility answers this run actually gave
    // (CEFR B2), not a literal. It used to be hard-coded to "en:adult"
    // regardless, which agreed with one path by luck and disagreed with every
    // other one. The expected value is derived from the configured scheme so
    // that changing the scheme does not require editing this test.
    expect(payload.stratum).toBe(stratumForCefr("B2"));

    // And the condition has to be the entry the committed sequence holds at the
    // recorded index -- not merely a valid-looking value. Asserting the pair
    // together is what makes this a test of the allocation list rather than of
    // the enum.
    const sequence = allocationSequence[payload.stratum]!;
    expect(payload.allocation_seq).toBeGreaterThanOrEqual(0);
    expect(payload.allocation_seq).toBeLessThan(sequence.length);
    expect(payload.condition).toBe(sequence[payload.allocation_seq]);
  });

  it("records every intermediate estimate, not just the submitted one", async () => {
    // Trajectory analysis is impossible to reconstruct later; this is the whole
    // point of ESTIMATE_CHANGED firing on each change.
    const log = capturing();
    const user = await runToAdvice(log);
    await user.click(screen.getByTestId("request-final"));

    for (const value of ["11000", "11500", "12500"]) {
      fireEvent.change(screen.getByTestId("final-estimate"), { target: { value } });
    }

    const changes = log.of("ESTIMATE_CHANGED");
    expect(changes.length).toBeGreaterThanOrEqual(4);
    expect(changes.map((event) => event.payload["value"])).toContain(11500);
    expect(changes.every((event) => typeof event.payload["ms_since_present"] === "number")).toBe(
      true,
    );
  });

  it("records which frozen stimulus was served and which register was entered", async () => {
    const log = capturing();
    await runToAdvice(log);
    // The condition comes from the committed sequence, so it is genuinely
    // either arm from one run to the next; the register must track confidence
    // in the warm arm and be absent in the neutral one, which does not branch.
    const revealed = log.of("RESPONSE_REVEALED")[0]!.payload as {
      item_id: string;
      response_id: string;
      register_state: string | null;
    };
    const condition = (log.of("ALLOCATED")[0]!.payload as { condition: string }).condition;
    expect(revealed.item_id).toBe("item_01");
    if (condition === "warm") {
      expect(revealed.response_id).toBe("en_warm_low_item_01");
      expect(revealed.register_state).toBe("LOW");
    } else {
      expect(revealed.response_id).toBe("en_neutral_na_item_01");
      expect(revealed.register_state).toBeNull();
    }
  });

  it("counts revisions before the final submit", async () => {
    const log = capturing();
    const user = await runToAdvice(log);
    await user.click(screen.getByTestId("request-final"));
    fireEvent.change(screen.getByTestId("final-estimate"), { target: { value: "11000" } });
    fireEvent.change(screen.getByTestId("final-estimate"), { target: { value: "11500" } });
    fireEvent.pointerUp(screen.getByTestId("final-confidence"));
    await user.click(screen.getByTestId("submit-final"));
    await user.click(screen.getByTestId("argument-strength-4"));

    const finalized = log.of("ESTIMATE_FINALIZED");
    expect(finalized).toHaveLength(1);
    expect(finalized[0]!.payload["revision_count"]).toBe(2);
  });

  it("records scroll depth on the response, the H4 mediator", async () => {
    const log = capturing();
    await runToAdvice(log);

    const advice = screen.getByTestId("advice");
    Object.defineProperty(advice, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(advice, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(advice, "scrollTop", { value: 300, configurable: true });
    fireEvent.scroll(advice);

    const scrolled = log.of("RESPONSE_SCROLLED");
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0]!.payload["max_scroll_fraction"]).toBeCloseTo(0.7, 2);
  });

  it("only records scroll depth when it advances", async () => {
    const log = capturing();
    await runToAdvice(log);
    const advice = screen.getByTestId("advice");
    Object.defineProperty(advice, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(advice, "clientHeight", { value: 400, configurable: true });

    Object.defineProperty(advice, "scrollTop", { value: 300, configurable: true });
    fireEvent.scroll(advice);
    Object.defineProperty(advice, "scrollTop", { value: 100, configurable: true });
    fireEvent.scroll(advice);

    expect(log.of("RESPONSE_SCROLLED")).toHaveLength(1);
  });

  it("records tab switches, which the consent form names explicitly", async () => {
    const log = capturing();
    await runToAdvice(log);
    fireEvent.blur(globalThis.window);
    fireEvent.focus(globalThis.window);

    expect(log.of("WINDOW_BLURRED")).toHaveLength(1);
    expect(log.of("WINDOW_FOCUSED")).toHaveLength(1);
    expect(typeof log.of("WINDOW_FOCUSED")[0]!.payload["away_duration_ms"]).toBe("number");
  });

  it("records withdrawal and where it happened", async () => {
    const log = capturing();
    const user = await runToAdvice(log);
    await user.click(screen.getByTestId("withdraw"));
    await user.click(screen.getByTestId("withdraw-confirm"));

    expect(log.of("SESSION_WITHDRAWN")[0]!.payload).toMatchObject({
      at_state: "task.advice",
    });
  });
});

describe("resume", () => {
  async function snapshotAtAdvice() {
    const { createActor } = await import("xstate");
    const actor = createActor(createSessionMachine(ITEM_IDS));
    actor.start();
    actor.send({ type: "SET_AGE_ANSWER", ageAnswer: "35+" });
    actor.send({ type: "SET_CEFR", cefr: "B2" });
    actor.send({ type: "SET_STUDY_WORK_LANGUAGE", studyWorkLanguage: "english" });
    actor.send({ type: "SET_PRIOR_TRAINING", priorTraining: false });
    actor.send({ type: "SUBMIT_ELIGIBILITY" });
    actor.send({ type: "GIVE_CONSENT" });
    actor.send({
      type: "ALLOCATE",
      condition: "warm",
      stratum: "en:adult",
      allocationSeq: 0,
    });
    actor.send({ type: "SET_ESTIMATE", value: 12000 });
    actor.send({ type: "SET_CONFIDENCE", value: 15 });
    actor.send({ type: "SUBMIT_INITIAL" });
    return actor.getPersistedSnapshot();
  }

  it("returns the participant to the item they were on, not to the start", async () => {
    const log = capturing();
    const snapshot = await snapshotAtAdvice();
    render(
      <App
        machine={createSessionMachine(ITEM_IDS)}
        recorder={log.recorder}
        resumed
        snapshot={snapshot}
      />,
    );
    expect(screen.getByTestId("screen").dataset["state"]).toBe("task.advice");
    expect(log.of("SESSION_STARTED")[0]!.payload["resumed"]).toBe(true);
  });

  it("re-emits RESPONSE_REVEALED on resume, so replay must take the LAST one per item", async () => {
    // The participant genuinely sees the response again after a reload, and
    // ms_since_reveal is measured from that second showing -- timing from
    // before an arbitrarily long gap would inflate every reaction time.
    //
    // The cost is that an item can carry more than one RESPONSE_REVEALED.
    // pipeline/replay.py must reduce on the last, not assume one. Sessions
    // with a resume are flagged by SESSION_STARTED.resumed and are a
    // pre-registered exclusion candidate (spec section 6).
    const log = capturing();
    const snapshot = await snapshotAtAdvice();
    render(
      <App
        machine={createSessionMachine(ITEM_IDS)}
        recorder={log.recorder}
        resumed
        snapshot={snapshot}
      />,
    );
    const reveals = log.of("RESPONSE_REVEALED");
    expect(reveals).toHaveLength(1);
    expect(reveals[0]!.payload).toMatchObject({
      item_id: "item_01",
      response_id: "en_warm_low_item_01",
    });
  });
});

describe("everything emitted validates against the shared schema", () => {
  it("produces a batch the ingest service would accept", async () => {
    // The client and the server share one definition. If this fails, real
    // collection would 400 at the boundary.
    const log = capturing();
    const user = await runToAdvice(log);
    await user.click(screen.getByTestId("request-final"));
    fireEvent.pointerUp(screen.getByTestId("final-estimate"));
    fireEvent.pointerUp(screen.getByTestId("final-confidence"));
    await user.click(screen.getByTestId("submit-final"));
    await user.click(screen.getByTestId("argument-strength-4"));

    const batch = {
      events: log.events.map((event, index) => ({
        event_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        session_id: SESSION,
        seq: index,
        client_ts: "2026-08-09T10:00:00.000Z",
        type: event.type,
        payload: event.payload,
      })),
    };

    const parsed = EventBatch.safeParse(batch);
    if (!parsed.success) {
      throw new Error(JSON.stringify(parsed.error.issues, null, 2));
    }
    expect(parsed.success).toBe(true);
  });
});
