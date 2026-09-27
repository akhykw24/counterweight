/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V3App } from "../src/v3/App";
import { explanation, instruments, toneLine, tone } from "../src/v3/materials";
import { CONTINUE_DELAY_MS, TYPING_MS } from "../src/v3/screens";
import { readLink, type V3Recorder } from "../src/v3/telemetry";

/**
 * The v3 screens, rendered. The flow itself is tested against the statechart
 * in v3-machine.test.ts; these check what a participant actually sees.
 */

afterEach(cleanup);

function capturing() {
  const events: { type: string; payload: Record<string, unknown>; envelope: Record<string, unknown> }[] = [];
  const recorder: V3Recorder = { record: (type, payload, envelope) => events.push({ type, payload, envelope }) };
  return { events, recorder };
}

const click = (id: string) => fireEvent.click(screen.getByTestId(id));

function toLesson(pilotFlow = false, requestedCell: "EI-A" | "Neutral-B" = "EI-A") {
  const { events, recorder } = capturing();
  render(<V3App recorder={recorder} runMode="test" pilotFlow={pilotFlow} requestedCell={requestedCell} />);
  fireEvent.click(screen.getByTestId("consent-adult"));
  fireEvent.click(screen.getByTestId("consent-agree"));
  click("consent-start");
  fireEvent.change(screen.getByTestId("screening-age"), { target: { value: "22" } });
  click("english-B2");
  click("study-language-English");
  click("screening-submit");
  for (const id of ["P1", "P2", "P4", "P5", "P6"]) click(`${id}-4`);
  click("P3-2");
  click("pre-submit");
  return { events };
}

describe("links", () => {
  it("reads pilot, test, p and cell exactly as documented", () => {
    expect(readLink("?pilot=true&p=3")).toEqual({
      runMode: "pilot",
      pilotFlow: true,
      pilotParticipant: 3,
      requestedCell: null,
    });
    expect(readLink("?test=true&cell=Neutral-B").requestedCell).toBe("Neutral-B");
  });

  it("ignores cell= unless the run is a test", () => {
    expect(readLink("?pilot=true&cell=Neutral-B").requestedCell).toBeNull();
    expect(readLink("?cell=EI-A").requestedCell).toBeNull();
  });

  it("does not treat a mistyped flag as a pilot or a test", () => {
    for (const search of ["?pilot=1", "?pilot=yes", "?test=TRUE", "?pilot"]) {
      expect(readLink(search).runMode).toBe("live");
    }
    expect(readLink("?test=true&cell=nonsense").requestedCell).toBeNull();
    expect(readLink("?pilot=true&p=0").pilotParticipant).toBeNull();
  });
});

describe("consent", () => {
  it("shows the pilot notice only on a pilot link", () => {
    render(<V3App pilotFlow />);
    expect(screen.getByTestId("pilot-notice")).toHaveTextContent(instruments.consent.pilot_notice!);
    cleanup();
    render(<V3App pilotFlow={false} />);
    expect(screen.queryByTestId("pilot-notice")).toBeNull();
  });

  it("will not start until both boxes are ticked", () => {
    render(<V3App />);
    expect(screen.getByTestId("consent-start")).toBeDisabled();
    fireEvent.click(screen.getByTestId("consent-adult"));
    expect(screen.getByTestId("consent-start")).toBeDisabled();
    fireEvent.click(screen.getByTestId("consent-agree"));
    expect(screen.getByTestId("consent-start")).toBeEnabled();
  });
});

describe("lesson", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("types for under a second, shows the message with its tone line, and offers Continue two seconds later", () => {
    toLesson(false, "EI-A");
    // Nova's introduction offers no Continue until its message has been up.
    expect(screen.queryByTestId("nova-continue")).toBeNull();
    act(() => void vi.advanceTimersByTime(TYPING_MS + CONTINUE_DELAY_MS));
    click("nova-continue");

    expect(screen.getByTestId("nova-typing")).toBeInTheDocument();
    expect(TYPING_MS).toBeLessThanOrEqual(1000);
    act(() => void vi.advanceTimersByTime(TYPING_MS));
    const bubble = screen.getByTestId("lesson-message-1");
    expect(screen.queryByTestId("lesson-continue")).toBeNull();

    // EI-A is list A with the warm tone: the message is the explanation and,
    // on its own line, that claim's EI line.
    const text = bubble.textContent ?? "";
    const claim = ["claim_01", "claim_02", "claim_03", "claim_04"].find((c) => text.includes(toneLine(c, "EI")))!;
    expect(claim).toBeDefined();
    const n = Number(claim.slice(-2));
    expect(text).toContain(explanation(claim, n % 2 === 1 ? "strong" : "weak").text);

    act(() => void vi.advanceTimersByTime(CONTINUE_DELAY_MS - 1));
    expect(screen.queryByTestId("lesson-continue")).toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.getByTestId("lesson-continue")).toBeInTheDocument();
  });

  it("uses the neutral line in a neutral cell", () => {
    toLesson(false, "Neutral-B");
    act(() => void vi.advanceTimersByTime(TYPING_MS + CONTINUE_DELAY_MS));
    expect(screen.getByTestId("nova-message")).toHaveTextContent(tone.transitions.start.neutral);
    click("nova-continue");
    act(() => void vi.advanceTimersByTime(TYPING_MS));
    const text = screen.getByTestId("lesson-message-1").textContent ?? "";
    expect(tone.lines.some((l) => text.includes(l.neutral_line))).toBe(true);
    expect(tone.lines.some((l) => text.includes(l.ei_line))).toBe(false);
  });

  it("records the reading time from the message appearing to Continue", () => {
    const { events } = toLesson();
    act(() => void vi.advanceTimersByTime(TYPING_MS + CONTINUE_DELAY_MS));
    click("nova-continue");
    act(() => void vi.advanceTimersByTime(TYPING_MS + CONTINUE_DELAY_MS + 1500));
    click("lesson-continue");
    const lesson = events.find((e) => e.type === "lesson_item")!;
    expect(lesson.payload["dwell_ms"]).toBeGreaterThanOrEqual(CONTINUE_DELAY_MS + 1500);
    expect(lesson.envelope["cell"]).toBe("EI-A");
  });

  it("shows only 'Module 1 of 3', nothing that hints at versions", () => {
    toLesson();
    act(() => void vi.advanceTimersByTime(TYPING_MS + CONTINUE_DELAY_MS));
    click("nova-continue");
    expect(screen.getByTestId("progress")).toHaveTextContent(/^Module 1 of 3$/);
    expect(document.body.textContent).not.toMatch(/strong|weak|list [AB]|EI-|Neutral-/i);
  });
});
