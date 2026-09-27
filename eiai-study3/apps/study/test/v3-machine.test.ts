import { describe, expect, it } from "vitest";
import { createActor } from "xstate";
import { v3 } from "@eiai/fsm";
import { V3Event } from "@eiai/schema";
import {
  DEMOGRAPHICS_ITEM_IDS,
  DEMOGRAPHICS_REQUIRED,
  PILOT_ITEM_IDS,
  PRE_ITEM_IDS,
  TUTOR_PAGES,
  design,
  task,
} from "../src/v3/materials";

/**
 * The v3 flow, driven end to end through the statechart with the real
 * materials. Every recorded event is also validated against the wire schema,
 * so a payload the ingest would reject fails here rather than on the server.
 */

type Recorded = { type: string; payload: Record<string, unknown>; cell: string | null };

const SESSION = "0b8f5c1e-6d2a-4f3b-9c7e-1a2b3c4d5e6f";
const PARTICIPANT = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

function start(overrides: Partial<v3.V3Input> = {}) {
  const log: Recorded[] = [];
  let seq = 0;
  const machine = v3.v3Machine.provide({
    actions: {
      record: ({ context }, params: v3.RecordParams) => {
        const cell = params.cell !== undefined ? params.cell : context.cell;
        const event = {
          event_id: crypto.randomUUID(),
          session_id: SESSION,
          participant_id: PARTICIPANT,
          seq: seq++,
          client_ts: new Date().toISOString(),
          run_mode: context.runMode,
          cell,
          type: params.type,
          payload: params.payload,
        };
        const parsed = V3Event.safeParse(event);
        if (!parsed.success) {
          throw new Error(`${params.type} fails the schema: ${JSON.stringify(parsed.error.issues)}`);
        }
        log.push({ type: params.type, payload: params.payload, cell });
      },
    },
  });
  const input: v3.V3Input = {
    sessionId: SESSION,
    participantId: PARTICIPANT,
    runMode: "test",
    pilotFlow: false,
    pilotParticipant: null,
    requestedCell: "EI-A",
    design: design(),
    ncsItemIds: [],
    preItemIds: PRE_ITEM_IDS,
    tutorPages: TUTOR_PAGES,
    demographicsRequired: DEMOGRAPHICS_REQUIRED,
    demographicsItemIds: DEMOGRAPHICS_ITEM_IDS,
    pilotItemIds: PILOT_ITEM_IDS,
    ...overrides,
  };
  const actor = createActor(machine, { input }).start();
  return { actor, log };
}

const state = (actor: ReturnType<typeof start>["actor"]) => String(actor.getSnapshot().value);
const ctx = (actor: ReturnType<typeof start>["actor"]) => actor.getSnapshot().context;
const types = (log: Recorded[]) => log.map((e) => e.type);
const count = (log: Recorded[], type: string) => log.filter((e) => e.type === type).length;

function throughScreening(actor: ReturnType<typeof start>["actor"]) {
  actor.send({ type: "CONSENT" });
  actor.send({ type: "SCREEN", age: 30, englishLevel: "B2", studyLanguage: "Russian" });
}

function pre(): Record<string, number | string> {
  return { P1: 5, P2: 3, P3: "Weekly", P4: 4, P5: 4, P6: 5 };
}

/** Drives a whole session, choosing the lesson option everywhere. */
function fullSession(
  actor: ReturnType<typeof start>["actor"],
  choose: (taskId: string) => "lesson" | "intuitive" | "distractor" = () => "lesson",
) {
  throughScreening(actor);
  actor.send({ type: "SUBMIT_PRE", answers: pre() });
  actor.send({ type: "CONTINUE" }); // Nova's introduction
  for (let module = 1; module <= 3; module += 1) {
    expect(state(actor)).toBe("lesson");
    for (let i = 0; i < 4; i += 1) actor.send({ type: "LESSON_CONTINUE", dwellMs: 3000 + i });
    while (state(actor) === "mission") {
      const screen = v3.currentMissionScreen(ctx(actor))!;
      if (screen === v3.ATTENTION) {
        actor.send({ type: "ANSWER_ATTENTION", choice: "Olympus", correct: true, rtMs: 900 });
      } else {
        actor.send({ type: "ANSWER_TASK", taskId: screen, role: choose(screen), confidence: 3, rtMs: 1200 });
      }
    }
    expect(state(actor)).toBe("transition");
    actor.send({ type: "CONTINUE" });
  }
  for (let page = 0; page < 4; page += 1) {
    const ratings = Object.fromEntries(v3.quizPageItems(ctx(actor)).map((id) => [id, 5]));
    actor.send({ type: "SUBMIT_QUIZ_PAGE", ratings });
  }
  for (const page of TUTOR_PAGES) actor.send({ type: "SUBMIT_TUTOR_PAGE", answers: Object.fromEntries(page.map((id) => [id, 4])) });
  for (const id of v3.FUNNEL_IDS) actor.send({ type: "ANSWER_FUNNEL", itemId: id, text: id === "F4" ? "No" : "" });
  actor.send({ type: "SUBMIT_QUALITY", ratings: Object.fromEntries(ctx(actor).plan!.qualityItems.map((c) => [c, 4])) });
  if (state(actor) === "ncs") {
    actor.send({ type: "SUBMIT_NCS", answers: Object.fromEntries(ctx(actor).ncsItemIds.map((id) => [id, 3])) });
  }
  actor.send({ type: "SUBMIT_DEMOGRAPHICS", answers: { D1: "Prefer not to say", D3: "Student", D4: "STEM" } });
}

describe("a complete v3 session", () => {
  it("records exactly 12 lesson items, 12 mission answers, 1 attention check and 16 quiz ratings", () => {
    const { actor, log } = start();
    fullSession(actor);
    expect(state(actor)).toBe("debrief");
    expect(count(log, "lesson_item")).toBe(12);
    expect(count(log, "mission_answer")).toBe(12);
    expect(count(log, "attention_check")).toBe(1);
    expect(count(log, "quiz_rating")).toBe(16);
    expect(count(log, "arg_quality_rating")).toBe(4);
    expect(count(log, "funnel_answer")).toBe(4);
    expect(count(log, "allocation")).toBe(1);
    expect(count(log, "session_completed")).toBe(1);
    expect(count(log, "debrief_viewed")).toBe(1);
  });

  it("follows the specified order of the procedure", () => {
    const { actor, log } = start();
    fullSession(actor);
    const first = (type: string) => types(log).indexOf(type);
    const order = [
      "consent_given",
      "screening_answered",
      "questionnaire_item",
      "allocation",
      "plan_generated",
      "lesson_item",
      "mission_answer",
      "quiz_rating",
      "funnel_answer",
      "arg_quality_rating",
      "session_completed",
      "debrief_viewed",
    ].map(first);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
  });

  it("stamps the cell on every event from allocation onwards, and on none before", () => {
    const { actor, log } = start();
    fullSession(actor);
    const allocated = types(log).indexOf("allocation");
    log.forEach((e, i) => expect(e.cell).toBe(i < allocated ? null : "EI-A"));
  });

  it("gives each version the lists say: list A, odd claims strong", () => {
    const { actor, log } = start({ requestedCell: "Neutral-A" });
    fullSession(actor);
    for (const e of log.filter((x) => ["lesson_item", "mission_answer"].includes(x.type))) {
      const n = Number(String(e.payload["claim_id"]).slice(-2));
      expect(e.payload["version"]).toBe(n % 2 === 1 ? "strong" : "weak");
    }
    const { actor: b, log: logB } = start({ requestedCell: "EI-B" });
    fullSession(b);
    for (const e of logB.filter((x) => x.type === "lesson_item")) {
      const n = Number(String(e.payload["claim_id"]).slice(-2));
      expect(e.payload["version"]).toBe(n % 2 === 1 ? "weak" : "strong");
    }
  });

  it("logs the lesson order and the option order it actually used", () => {
    const { actor, log } = start();
    fullSession(actor);
    const plan = ctx(actor).plan!;
    const lessons = log.filter((e) => e.type === "lesson_item");
    [1, 2, 3].forEach((m) => {
      const inModule = lessons.filter((e) => e.payload["module"] === m);
      expect(inModule.map((e) => e.payload["claim_id"])).toEqual(plan.lessonOrder[m - 1]);
      expect(inModule.map((e) => e.payload["order_position"])).toEqual([1, 2, 3, 4]);
    });
    for (const e of log.filter((x) => x.type === "mission_answer")) {
      expect(e.payload["option_order"]).toEqual(plan.optionOrder[String(e.payload["task_id"])]);
      expect(task(String(e.payload["task_id"])).claim_id).toBe(e.payload["claim_id"]);
    }
  });

  it("scores the debrief as the number of lesson-consistent answers", () => {
    const { actor } = start();
    let n = 0;
    fullSession(actor, () => (n++ % 3 === 0 ? "lesson" : "intuitive"));
    expect(ctx(actor).score).toBe(4);
  });

  it("stores the age band, never the age", () => {
    const { actor, log } = start();
    throughScreening(actor);
    const screening = log.find((e) => e.type === "screening_answered")!;
    expect(screening.payload).toEqual({ age_band: "25-34", english_level: "B2", study_language: "Russian" });
    expect(JSON.stringify(log)).not.toContain('"age"');
  });
});

describe("screening", () => {
  it("turns away a 17-year-old before any allocation, recording only the reason", () => {
    const { actor, log } = start();
    actor.send({ type: "CONSENT" });
    actor.send({ type: "SCREEN", age: 17, englishLevel: "C1", studyLanguage: "English" });
    expect(state(actor)).toBe("screenedOut");
    expect(types(log)).toEqual(["consent_given", "screened_out"]);
    expect(log[1]!.payload).toEqual({ reason: "age" });
  });

  it("turns away an A1-A2 reader before any allocation", () => {
    const { actor, log } = start();
    actor.send({ type: "CONSENT" });
    actor.send({ type: "SCREEN", age: 40, englishLevel: "A1-A2", studyLanguage: "Kazakh" });
    expect(state(actor)).toBe("screenedOut");
    expect(log.at(-1)!.payload).toEqual({ reason: "language" });
    expect(types(log)).not.toContain("allocation");
  });

  it("never allocates before the pre-measures are complete", () => {
    const { actor, log } = start();
    throughScreening(actor);
    actor.send({ type: "SUBMIT_PRE", answers: { P1: 5 } });
    expect(state(actor)).toBe("pre");
    expect(types(log)).not.toContain("allocation");
  });
});

describe("no duplicates, no going back", () => {
  it("a second Next on the same task records nothing", () => {
    const { actor, log } = start();
    throughScreening(actor);
    actor.send({ type: "SUBMIT_PRE", answers: pre() });
    actor.send({ type: "CONTINUE" });
    for (let i = 0; i < 4; i += 1) actor.send({ type: "LESSON_CONTINUE", dwellMs: 2500 });
    const first = v3.currentMissionScreen(ctx(actor))!;
    actor.send({ type: "ANSWER_TASK", taskId: first, role: "lesson", confidence: 2, rtMs: 800 });
    actor.send({ type: "ANSWER_TASK", taskId: first, role: "lesson", confidence: 2, rtMs: 801 });
    expect(log.filter((e) => e.type === "mission_answer" && e.payload["task_id"] === first)).toHaveLength(1);
  });

  it("an event for an earlier screen is ignored", () => {
    const { actor, log } = start();
    throughScreening(actor);
    const before = log.length;
    actor.send({ type: "CONSENT" });
    actor.send({ type: "SCREEN", age: 20, englishLevel: "B1", studyLanguage: "English" });
    expect(log.length).toBe(before);
    expect(state(actor)).toBe("pre");
  });

  it("requires both an answer and a confidence rating", () => {
    const { actor } = start();
    throughScreening(actor);
    actor.send({ type: "SUBMIT_PRE", answers: pre() });
    actor.send({ type: "CONTINUE" });
    for (let i = 0; i < 4; i += 1) actor.send({ type: "LESSON_CONTINUE", dwellMs: 2500 });
    const index = ctx(actor).missionIndex;
    const first = v3.currentMissionScreen(ctx(actor))!;
    actor.send({ type: "ANSWER_TASK", taskId: first, role: "lesson", confidence: 0, rtMs: 800 });
    expect(ctx(actor).missionIndex).toBe(index);
  });
});

describe("pilot and optional screens", () => {
  it("asks the three pilot questions only on a pilot link, and records only what was written", () => {
    const { actor, log } = start({ pilotFlow: true });
    fullSession(actor);
    expect(state(actor)).toBe("pilotFeedback");
    actor.send({ type: "SUBMIT_PILOT", answers: { PF1: "  ", PF2: "The quiz was long", PF3: "20 min" } });
    expect(state(actor)).toBe("debrief");
    expect(log.filter((e) => e.type === "pilot_feedback").map((e) => e.payload)).toEqual([
      { item_id: "PF2", text: "The quiz was long" },
      { item_id: "PF3", text: "20 min" },
    ]);
    expect(log.find((e) => e.type === "consent_given")!.payload).toEqual({ pilot_notice_shown: true });
  });

  it("skips NCS-6 while it has no items, and asks it once it has", () => {
    const { actor: without } = start();
    fullSession(without);
    expect(state(without)).toBe("debrief");

    const { actor, log } = start({ ncsItemIds: ["N1", "N2"] });
    fullSession(actor);
    expect(state(actor)).toBe("debrief");
    const ncs = log.filter((e) => e.type === "questionnaire_item" && e.payload["instrument"] === "ncs6");
    expect(ncs.map((e) => e.payload["item_id"])).toEqual(["N1", "N2"]);
  });

  it("records a withdrawal from the debrief", () => {
    const { actor, log } = start();
    fullSession(actor);
    actor.send({ type: "WITHDRAW" });
    expect(state(actor)).toBe("withdrawn");
    expect(log.at(-1)).toMatchObject({ type: "withdrawal_requested", payload: { at_screen: "debrief" } });
  });

  it("a pilot link allocates by rotation position", () => {
    const { actor, log } = start({ runMode: "pilot", requestedCell: "EI-A", pilotParticipant: 2 });
    throughScreening(actor);
    actor.send({ type: "SUBMIT_PRE", answers: pre() });
    expect(log.find((e) => e.type === "allocation")!.payload).toMatchObject({
      cell: "Neutral-B",
      method: "pilot_rotation",
      pilot_position: 2,
    });
  });
});

describe("resume", () => {
  it("a persisted snapshot restores the same screen and the same plan", () => {
    const { actor } = start();
    throughScreening(actor);
    actor.send({ type: "SUBMIT_PRE", answers: pre() });
    actor.send({ type: "CONTINUE" });
    actor.send({ type: "LESSON_CONTINUE", dwellMs: 2500 });
    const saved = JSON.parse(JSON.stringify(actor.getPersistedSnapshot()));
    const restored = createActor(v3.v3Machine, { snapshot: saved } as never).start();
    expect(String(restored.getSnapshot().value)).toBe("lesson");
    expect(restored.getSnapshot().context.lessonIndex).toBe(1);
    expect(restored.getSnapshot().context.plan).toEqual(ctx(actor).plan);
  });
});
