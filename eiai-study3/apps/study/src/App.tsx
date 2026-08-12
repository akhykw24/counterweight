import { useEffect, useRef } from "react";
import { useMachine } from "@xstate/react";
import type { StateValue } from "xstate";
import { currentItemId, sessionMachine, type SessionMachine } from "@eiai/fsm";
import {
  APP_VERSION,
  STIMULI_MANIFEST_HASH,
  initialLocale,
  noopRecorder,
  type Recorder,
} from "./telemetry";
import { resolveStimulus } from "./stimuli";
import {
  AllocatingScreen,
  AssentScreen,
  ConsentScreen,
  EligibilityScreen,
  ItemScreen,
  StubScreen,
  TerminalScreen,
  WithdrawButton,
  type Send,
} from "./screens";

/** Flattens a possibly-nested state value to a dotted name, e.g. `task.estimate`. */
export function stateName(value: StateValue): string {
  if (typeof value === "string") return value;
  const [key, child] = Object.entries(value)[0] ?? [];
  if (key === undefined || child === undefined) return String(value);
  return `${key}.${stateName(child as StateValue)}`;
}

const TERMINAL = new Set(["done", "withdrawn", "ineligible"]);

export interface AppProps {
  machine?: SessionMachine;
  recorder?: Recorder;
  resumed?: boolean;
  snapshot?: unknown;
  onSnapshot?: (snapshot: unknown) => void;
  onComplete?: () => void;
}

export function App({
  machine = sessionMachine,
  recorder = noopRecorder,
  resumed = false,
  snapshot,
  onSnapshot,
  onComplete,
}: AppProps) {
  const [state, rawSend, actor] = useMachine(
    machine,
    snapshot ? ({ snapshot } as never) : undefined,
  );
  const name = stateName(state.value);
  const context = state.context;

  const startedAt = useRef(Date.now());
  const itemPresentedAt = useRef(Date.now());
  const revealedAt = useRef(Date.now());
  const finalRevisions = useRef(0);
  const maxScroll = useRef(0);
  // StrictMode double-invokes effects in development. Event ids are unique, so
  // an unguarded emit would write two genuine rows for one occurrence.
  const startedOnce = useRef(false);
  const lastPresented = useRef<string | null>(null);
  const lastRevealed = useRef<string | null>(null);

  // --- SESSION_STARTED, exactly once per mount -----------------------------
  useEffect(() => {
    if (startedOnce.current) return;
    startedOnce.current = true;
    recorder.record("SESSION_STARTED", {
      app_version: APP_VERSION,
      stimuli_manifest_hash: STIMULI_MANIFEST_HASH,
      locale: context.language ?? initialLocale(),
      viewport: {
        width: globalThis.innerWidth || 1024,
        height: globalThis.innerHeight || 768,
      },
      resumed,
    });
  }, [recorder, resumed, context.language]);

  // --- resume snapshot, written on every transition ------------------------
  useEffect(() => {
    if (!onSnapshot) return;
    const subscription = actor.subscribe(() => {
      onSnapshot(actor.getPersistedSnapshot());
    });
    return () => subscription.unsubscribe();
  }, [actor, onSnapshot]);

  // --- tab switching: proxy for external verification ----------------------
  useEffect(() => {
    let blurredAt: number | null = null;
    const onBlur = () => {
      blurredAt = Date.now();
      recorder.record("WINDOW_BLURRED", {
        item_id: currentItemId(context),
        ms_since_session_start: Date.now() - startedAt.current,
      });
    };
    const onFocus = () => {
      recorder.record("WINDOW_FOCUSED", {
        item_id: currentItemId(context),
        ms_since_session_start: Date.now() - startedAt.current,
        away_duration_ms: blurredAt === null ? 0 : Date.now() - blurredAt,
      });
      blurredAt = null;
    };
    globalThis.addEventListener?.("blur", onBlur);
    globalThis.addEventListener?.("focus", onFocus);
    return () => {
      globalThis.removeEventListener?.("blur", onBlur);
      globalThis.removeEventListener?.("focus", onFocus);
    };
  }, [recorder, context]);

  // --- state-entry events --------------------------------------------------
  useEffect(() => {
    const itemId = currentItemId(context);

    if (name === "task.estimate" && itemId) {
      const key = `${itemId}:${context.itemIndex}`;
      if (lastPresented.current !== key) {
        lastPresented.current = key;
        lastRevealed.current = null;
        itemPresentedAt.current = Date.now();
        finalRevisions.current = 0;
        maxScroll.current = 0;
        recorder.record("ITEM_PRESENTED", {
          item_id: itemId,
          position: context.itemIndex + 1,
        });
      }
    }

    if (name === "task.advice" && itemId && lastRevealed.current !== itemId) {
      lastRevealed.current = itemId;
      revealedAt.current = Date.now();
      const stimulus = resolveStimulus(
        context.language ?? "en",
        context.condition ?? "neutral",
        context.registerState,
        itemId,
      );
      recorder.record("RESPONSE_REVEALED", {
        item_id: itemId,
        response_id: stimulus.response_id,
        register_state: context.registerState,
      });
    }

    if (name === "done") onComplete?.();
  }, [name, context, recorder, onComplete]);

  // --- user-driven events --------------------------------------------------
  const send: Send = (event) => {
    const itemId = currentItemId(context);
    const phase = name === "task.revise" ? "final" : "initial";

    switch (event.type) {
      case "GIVE_CONSENT":
        recorder.record("CONSENT_GIVEN", { flow: "adult" });
        break;
      case "GIVE_ASSENT":
        recorder.record("ASSENT_GIVEN", {
          parental_consent_code: context.parentalConsentCode ?? "",
        });
        break;
      case "ALLOCATE":
        recorder.record("ALLOCATED", {
          condition: event.condition,
          stratum: event.stratum,
          allocation_seq: event.allocationSeq,
        });
        break;
      case "SET_ESTIMATE":
        if (phase === "final") finalRevisions.current += 1;
        if (itemId) {
          recorder.record("ESTIMATE_CHANGED", {
            item_id: itemId,
            phase,
            value: event.value,
            ms_since_present: Date.now() - itemPresentedAt.current,
          });
        }
        break;
      case "SET_CONFIDENCE":
        if (itemId) {
          recorder.record("CONFIDENCE_SET", { item_id: itemId, phase, value: event.value });
        }
        break;
      case "SUBMIT_FINAL":
        if (itemId && context.finalEstimate !== null) {
          recorder.record("ESTIMATE_FINALIZED", {
            item_id: itemId,
            value: context.finalEstimate,
            revision_count: finalRevisions.current,
            ms_since_reveal: Date.now() - revealedAt.current,
          });
        }
        break;
      case "FINISH":
        recorder.record("SESSION_COMPLETED", {
          total_duration_ms: Date.now() - startedAt.current,
        });
        break;
      case "WITHDRAW":
        recorder.record("SESSION_WITHDRAWN", { reason: null, at_state: event.atState });
        break;
      default:
        break;
    }

    rawSend(event);
  };

  const onAdviceScroll = (fraction: number) => {
    const itemId = currentItemId(context);
    // Only the deepest point matters, and only when it advances. Emitting on
    // every scroll tick would bury the log in noise for no extra information.
    if (!itemId || fraction <= maxScroll.current) return;
    maxScroll.current = fraction;
    recorder.record("RESPONSE_SCROLLED", {
      item_id: itemId,
      max_scroll_fraction: Number(fraction.toFixed(3)),
    });
  };

  return (
    <main className="app">
      <header>
        <span className="brand">Deep-sea estimation study</span>
        {!TERMINAL.has(name) && <WithdrawButton send={send} atState={name} />}
      </header>

      <div className="screen" data-testid="screen" data-state={name}>
        {name === "eligibility" && (
          <EligibilityScreen context={context} send={send} />
        )}
        {name === "consent" && <ConsentScreen send={send} />}
        {name === "assent" && <AssentScreen context={context} send={send} />}
        {name === "allocating" && <AllocatingScreen send={send} />}

        {name === "task.estimate" && (
          <ItemScreen context={context} send={send} phase="estimate" />
        )}
        {name === "task.advice" && (
          <ItemScreen
            context={context}
            send={send}
            phase="advice"
            onAdviceScroll={onAdviceScroll}
          />
        )}
        {name === "task.revise" && (
          <ItemScreen
            context={context}
            send={send}
            phase="revise"
            onAdviceScroll={onAdviceScroll}
          />
        )}

        {name === "questionnaire" && (
          <StubScreen
            name="questionnaire"
            title="A few questions about the assistant"
            cta="Continue"
            event={{ type: "SUBMIT_QUESTIONNAIRE" }}
            send={send}
          />
        )}
        {name === "funnel" && (
          <StubScreen
            name="funnel"
            title="Three last questions"
            cta="Continue"
            event={{ type: "SUBMIT_FUNNEL" }}
            send={send}
          />
        )}
        {name === "debrief" && (
          <StubScreen
            name="debrief"
            title="What this study was really about"
            cta="Finish"
            event={{ type: "FINISH" }}
            send={send}
          />
        )}

        {name === "done" && (
          <TerminalScreen
            name="done"
            title="Thank you"
            body="Your responses have been recorded. You can close this tab."
          />
        )}
        {name === "withdrawn" && (
          <TerminalScreen
            name="withdrawn"
            title="You have stopped"
            body="Nothing further will be recorded. Thank you for your time."
          />
        )}
        {name === "ineligible" && (
          <TerminalScreen
            name="ineligible"
            title="Thank you for your interest"
            body="This study needs participants without formal training in marine biology or oceanography, so it is not a fit this time."
          />
        )}
      </div>
    </main>
  );
}
