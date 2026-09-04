import { useEffect, useRef } from "react";
import { useMachine } from "@xstate/react";
import type { StateValue } from "xstate";
import { currentItemId, sessionMachine, type SessionMachine } from "@eiai/fsm";
import {
  APP_VERSION,
  STIMULI_MANIFEST_HASH,
  noopRecorder,
  type Recorder,
} from "./telemetry";
import { requireLanguage, stimulusFor } from "./stimuli";
import { translator } from "./i18n";
import {
  AllocatingScreen,
  ConsentScreen,
  ScreenedOutScreen,
  EligibilityScreen,
  ArgumentRatingScreen,
  ItemScreen,
  TerminalScreen,
  WithdrawButton,
  type Send,
} from "./screens";
import { DebriefScreen, FunnelScreen, QuestionnaireScreen } from "./screens-end";

/** Flattens a possibly-nested state value to a dotted name, e.g. `task.estimate`. */
export function stateName(value: StateValue): string {
  if (typeof value === "string") return value;
  const [key, child] = Object.entries(value)[0] ?? [];
  if (key === undefined || child === undefined) return String(value);
  return `${key}.${stateName(child as StateValue)}`;
}

const TERMINAL = new Set(["done", "withdrawn", "ineligible", "screenedOut"]);

/**
 * With one study language there is nothing to bootstrap: the machine sets the
 * language from `STUDY_LANGUAGE` at the start of the session, so the eligibility
 * screen already has it. The constant that used to cover the gap is gone.
 */

export interface AppProps {
  machine?: SessionMachine;
  recorder?: Recorder;
  /** Drives condition assignment from the committed sequence. */
  sessionId?: string;
  resumed?: boolean;
  snapshot?: unknown;
  onSnapshot?: (snapshot: unknown) => void;
  onComplete?: () => void;
}

export function App({
  machine = sessionMachine,
  recorder = noopRecorder,
  sessionId = "00000000-0000-4000-8000-000000000000",
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
  const t = translator(requireLanguage(context, "the interface"));

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
  const screenedOnce = useRef(false);

  // --- SESSION_STARTED, exactly once per mount -----------------------------
  useEffect(() => {
    if (startedOnce.current) return;
    startedOnce.current = true;
    recorder.record("SESSION_STARTED", {
      app_version: APP_VERSION,
      stimuli_manifest_hash: STIMULI_MANIFEST_HASH,
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
      const stimulus = stimulusFor(context, itemId);
      recorder.record("RESPONSE_REVEALED", {
        item_id: itemId,
        response_id: stimulus.response_id,
        register_state: context.registerState,
      });
    }

    if (name === "screenedOut" && context.screenedOutReason && !screenedOnce.current) {
      // Once per session: the state is terminal, but React may re-run the
      // effect, and a duplicate would double-count in the screening tally.
      screenedOnce.current = true;
      recorder.record("SCREENED_OUT", { reason: context.screenedOutReason });
    }

    if (name === "done") onComplete?.();
  }, [name, context, recorder, onComplete]);

  // --- user-driven events --------------------------------------------------
  const send: Send = (event) => {
    const itemId = currentItemId(context);
    const phase = name === "task.revise" ? "final" : "initial";

    switch (event.type) {
      case "GIVE_CONSENT":
        // No flow discriminator: v2 admits adults only, so there is one flow.
        // Naming it would be a literal that could drift from the participant.
        recorder.record("CONSENT_GIVEN", {});
        break;
      case "ALLOCATE":
        recorder.record("ALLOCATED", {
          condition: event.condition,
          stratum: event.stratum,
          allocation_seq: event.allocationSeq,
        });
        break;
      case "RATE_ARGUMENT":
        if (itemId) {
          recorder.record("ARGUMENT_RATED", {
            item_id: itemId,
            perceived_strength: event.perceivedStrength,
          });
        }
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
      case "SELECT_FOLLOWUP":
        if (itemId) {
          recorder.record("FOLLOWUP_SELECTED", {
            item_id: itemId,
            followup_id: event.followupId,
            ms_since_reveal: Date.now() - revealedAt.current,
          });
        }
        break;
      case "CLICK_VERIFY":
        if (itemId) {
          recorder.record("VERIFY_CLICKED", {
            item_id: itemId,
            ms_since_reveal: Date.now() - revealedAt.current,
          });
        }
        break;
      case "ANSWER_QUESTION":
        recorder.record("QUESTIONNAIRE_ANSWERED", {
          scale: event.id.startsWith("cov_")
            ? "covariates"
            : event.id.split("_")[0],
          question_id: event.id,
          value: event.value,
        });
        break;
      case "ANSWER_FUNNEL":
        recorder.record("FUNNEL_RESPONSE", { stage: event.stage, text: event.text });
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
        {name === "allocating" && (
          <AllocatingScreen context={context} send={send} sessionId={sessionId} />
        )}

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
        {name === "task.rate" && currentItemId(context) && (
          <ArgumentRatingScreen
            context={context}
            send={send}
            itemId={currentItemId(context)!}
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
          <QuestionnaireScreen context={context} send={send} t={t} />
        )}

        {name === "funnel.purpose" && <FunnelScreen stage="purpose" send={send} t={t} />}
        {name === "funnel.anomaly" && <FunnelScreen stage="anomaly" send={send} t={t} />}
        {name === "funnel.belief" && <FunnelScreen stage="belief" send={send} t={t} />}

        {name === "debrief" && (
          <DebriefScreen send={send} t={t} language={requireLanguage(context, "the debrief")} />
        )}

        {name === "done" && (
          <TerminalScreen
            name="done"
            title={t("done.title")}
            body={t("done.body")}
          />
        )}
        {name === "withdrawn" && (
          <TerminalScreen
            name="withdrawn"
            title={t("withdrawn.title")}
            body={t("withdrawn.body")}
          />
        )}
        {name === "screenedOut" && <ScreenedOutScreen context={context} />}
        {name === "ineligible" && (
          <TerminalScreen
            name="ineligible"
            title={t("ineligible.title")}
            body={t("ineligible.body")}
          />
        )}
      </div>
    </main>
  );
}
