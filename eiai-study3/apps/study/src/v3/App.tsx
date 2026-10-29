import { useEffect, useMemo, useRef, useState } from "react";
import { useMachine } from "@xstate/react";
import { v3 } from "@eiai/fsm";
import type { CellName } from "@eiai/schema";
import {
  DEMOGRAPHICS_ITEM_IDS,
  FUNNEL_ITEMS,
  DEMOGRAPHICS_REQUIRED,
  PILOT_ITEM_IDS,
  PRE_ITEM_IDS,
  TRUST_ITEM_IDS,
  STIMULI_MANIFEST_HASH,
  TUTOR_PAGES,
  design,
  explanation,
  ncs6Items,
  tone,
  toneKey,
  toneLine,
} from "./materials";
import {
  AttentionScreen,
  ConsentScreen,
  DebriefScreen,
  DemographicsScreen,
  FunnelScreen,
  IneligibleScreen,
  LessonScreen,
  MissionTaskScreen,
  NcsScreen,
  NovaMessageScreen,
  PilotFeedbackScreen,
  PreScreen,
  QualityScreen,
  QuizScreen,
  ScreeningScreen,
  TrustScreen,
  TutorScreen,
} from "./screens";
import {
  SlotsExhaustedError,
  claimSlot,
  httpAllocate,
  noopV3Recorder,
  type AllocateSlot,
  type V3Recorder,
} from "./telemetry";

export const APP_VERSION = "0.3.0";

export interface V3AppProps {
  recorder?: V3Recorder;
  sessionId?: string;
  participantId?: string;
  runMode?: "live" | "pilot" | "test";
  pilotFlow?: boolean;
  pilotParticipant?: number | null;
  requestedCell?: CellName | null;
  resumed?: boolean;
  repeatSession?: boolean;
  snapshot?: unknown;
  onSnapshot?: (snapshot: unknown) => void;
  onComplete?: () => void;
  /** Where a run that takes its cell from the server gets its slot. */
  allocateSlot?: AllocateSlot;
}

const TRANSITION_AFTER: Record<number, "after_m1" | "after_m2" | "end"> = { 1: "after_m1", 2: "after_m2", 3: "end" };

/** A key per screen, so each one is logged once however often React renders it. */
function screenKey(state: string, c: v3.V3Context): { key: string; module: number | null } {
  switch (state) {
    case "lesson":
      return { key: `lesson:${c.module}:${c.lessonIndex + 1}`, module: c.module };
    case "mission":
      return { key: `mission:${c.module}:${v3.currentMissionScreen(c)}`, module: c.module };
    case "transition":
      return { key: `transition:${TRANSITION_AFTER[c.module]}`, module: c.module };
    case "quiz":
      return { key: `quiz:${c.quizPage + 1}`, module: null };
    case "tutor":
      return { key: `tutor:${c.tutorPage + 1}`, module: null };
    case "funnel":
      return { key: `funnel:${v3.currentFunnelItem(c)?.id}`, module: null };
    default:
      return { key: state, module: null };
  }
}

export function V3App({
  recorder = noopV3Recorder,
  sessionId = "00000000-0000-4000-8000-000000000000",
  participantId = "00000000-0000-4000-8000-0000000000ff",
  runMode = "test",
  pilotFlow = false,
  pilotParticipant = null,
  requestedCell = null,
  resumed = false,
  repeatSession = false,
  snapshot,
  onSnapshot,
  onComplete,
  allocateSlot,
}: V3AppProps) {
  const machine = useMemo(
    () =>
      v3.v3Machine.provide({
        actions: {
          record: ({ context }, params: v3.RecordParams) =>
            recorder.record(params.type, params.payload, {
              participant_id: context.participantId,
              cell: params.cell !== undefined ? params.cell : context.cell,
            }),
        },
      }),
    [recorder],
  );

  const input: v3.V3Input = {
    sessionId,
    participantId,
    runMode,
    pilotFlow,
    pilotParticipant,
    requestedCell,
    design: design(),
    ncsItemIds: ncs6Items.map((i) => i.item_id),
    preItemIds: PRE_ITEM_IDS,
    trustItemIds: TRUST_ITEM_IDS,
    tutorPages: TUTOR_PAGES,
    funnelItems: FUNNEL_ITEMS,
    demographicsRequired: DEMOGRAPHICS_REQUIRED,
    demographicsItemIds: DEMOGRAPHICS_ITEM_IDS,
    pilotItemIds: PILOT_ITEM_IDS,
  };

  const [state, send, actor] = useMachine(machine, snapshot ? ({ snapshot } as never) : { input });
  const name = String(state.value);
  const c = state.context;

  // --- session_started, once per mount ---------------------------------------
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    recorder.record(
      "session_started",
      {
        study_version: "v3",
        app_version: APP_VERSION,
        stimuli_manifest_hash: STIMULI_MANIFEST_HASH,
        viewport: {
          width: Math.max(1, globalThis.innerWidth || 1024),
          height: Math.max(1, globalThis.innerHeight || 768),
        },
        resumed,
        repeat_session: repeatSession,
        pilot_participant: c.pilotParticipant,
        requested_cell: c.requestedCell,
      },
      { participant_id: c.participantId, cell: c.cell },
    );
  }, [recorder, resumed, repeatSession, c]);

  // --- resume position, written on every transition --------------------------
  useEffect(() => {
    if (!onSnapshot) return;
    const subscription = actor.subscribe(() => onSnapshot(actor.getPersistedSnapshot()));
    return () => subscription.unsubscribe();
  }, [actor, onSnapshot]);

  // --- screen_viewed ----------------------------------------------------------
  const { key, module } = screenKey(name, c);
  const lastScreen = useRef<string | null>(null);
  useEffect(() => {
    if (lastScreen.current === key) return;
    lastScreen.current = key;
    recorder.record("screen_viewed", { screen: key, module }, { participant_id: c.participantId, cell: c.cell });
  }, [key, module, recorder, c.participantId, c.cell]);

  // --- a finished session is not resumed into ---------------------------------
  useEffect(() => {
    if (name === "debrief" || name === "withdrawn") onComplete?.();
  }, [name, onComplete]);

  // --- the browser's back button stays on the page ----------------------------
  useEffect(() => {
    const pin = () => globalThis.history?.pushState({ v3: true }, "", globalThis.location?.href);
    pin();
    globalThis.addEventListener?.("popstate", pin);
    return () => globalThis.removeEventListener?.("popstate", pin);
  }, []);

  // --- the server's slot, for the single public link and plain test runs ----
  const [allocating, setAllocating] = useState<"idle" | "waiting" | "full">("idle");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const allocator = useMemo(() => allocateSlot ?? httpAllocate(), [allocateSlot]);

  async function submitPre(answers: Record<string, number | string>) {
    if (!v3.needsServerSlot(c)) {
      send({ type: "SUBMIT_PRE", answers });
      return;
    }
    if (!c.englishBand) throw new Error("no English band after screening");
    setAllocating("waiting");
    try {
      const slot = await claimSlot(
        allocator,
        { sessionId: c.sessionId, englishBand: c.englishBand, runMode: c.runMode === "live" ? "live" : "test" },
        { stillWanted: () => mounted.current },
      );
      if (!mounted.current) return;
      send({ type: "SUBMIT_PRE", answers, slot });
      setAllocating("idle");
    } catch (error) {
      if (mounted.current && error instanceof SlotsExhaustedError) setAllocating("full");
    }
  }

  const toneName = c.tone ?? "Neutral";
  const key3 = toneKey(toneName);

  let screen: React.ReactNode = null;
  switch (name) {
    case "consent":
      screen = <ConsentScreen pilotFlow={c.pilotFlow} onConsent={() => send({ type: "CONSENT" })} />;
      break;
    case "screening":
      screen = <ScreeningScreen onSubmit={(a) => send({ type: "SCREEN", ...a })} />;
      break;
    case "screenedOut":
      screen = <IneligibleScreen />;
      break;
    case "pre":
      screen =
        allocating === "waiting" ? (
          <section className="waiting" data-testid="screen-allocating">
            <div className="bubble typing" aria-label="Connecting">
              <span />
              <span />
              <span />
            </div>
            <p className="hint">Connecting…</p>
          </section>
        ) : allocating === "full" ? (
          <section data-testid="screen-full">
            <p>This study is currently full. Thank you for your interest.</p>
          </section>
        ) : (
          <PreScreen onSubmit={(answers) => void submitPre(answers)} />
        );
      break;
    case "intro":
      screen = (
        <NovaMessageScreen
          screenKey="intro"
          text={tone.transitions.start[key3]}
          onContinue={() => send({ type: "CONTINUE" })}
        />
      );
      break;
    case "lesson": {
      const order = c.plan!.lessonOrder[c.module - 1]!;
      const messages = order.map((claimId) => ({
        claimId,
        lines: [explanation(claimId, v3.versionOf(c, claimId)).text, toneLine(claimId, toneName)],
      }));
      screen = (
        <LessonScreen
          key={`lesson-${c.module}`}
          module={c.module}
          messages={messages}
          index={c.lessonIndex}
          onContinue={(dwellMs) => send({ type: "LESSON_CONTINUE", dwellMs })}
        />
      );
      break;
    }
    case "mission": {
      const current = v3.currentMissionScreen(c);
      if (current === v3.ATTENTION) {
        screen = (
          <AttentionScreen
            key={`attention-${c.module}-${c.missionIndex}`}
            module={c.module}
            onAnswer={(a) => send({ type: "ANSWER_ATTENTION", ...a })}
          />
        );
      } else if (current) {
        screen = (
          <MissionTaskScreen
            key={`task-${current}`}
            module={c.module}
            taskId={current}
            optionOrder={c.plan!.optionOrder[current]!}
            onAnswer={(a) => send({ type: "ANSWER_TASK", taskId: current, ...a })}
          />
        );
      }
      break;
    }
    case "transition": {
      const which = TRANSITION_AFTER[c.module]!;
      screen = (
        <NovaMessageScreen
          key={which}
          screenKey={`transition-${which}`}
          text={tone.transitions[which][key3]}
          onContinue={() => send({ type: "CONTINUE" })}
        />
      );
      break;
    }
    case "quiz":
      screen = (
        <QuizScreen
          page={c.quizPage}
          itemIds={v3.quizPageItems(c)}
          onSubmit={(ratings) => send({ type: "SUBMIT_QUIZ_PAGE", ratings })}
        />
      );
      break;
    case "tutor":
      screen = (
        <TutorScreen
          page={c.tutorPage}
          itemIds={c.tutorPages[c.tutorPage] ?? []}
          onSubmit={(answers) => send({ type: "SUBMIT_TUTOR_PAGE", answers })}
        />
      );
      break;
    case "funnel": {
      const itemId = v3.currentFunnelItem(c)!.id;
      screen = (
        <FunnelScreen key={itemId} itemId={itemId} onAnswer={(text) => send({ type: "ANSWER_FUNNEL", itemId, text })} />
      );
      break;
    }
    case "quality":
      screen = (
        <QualityScreen
          items={c.plan!.qualityItems.map((claimId) => ({
            claimId,
            text: explanation(claimId, v3.versionOf(c, claimId)).text,
          }))}
          onSubmit={(ratings) => send({ type: "SUBMIT_QUALITY", ratings })}
        />
      );
      break;
    case "trust":
      screen = <TrustScreen onSubmit={(answers) => send({ type: "SUBMIT_TRUST", answers })} />;
      break;
    case "ncs":
      screen = <NcsScreen items={ncs6Items} onSubmit={(answers) => send({ type: "SUBMIT_NCS", answers })} />;
      break;
    case "demographics":
      screen = <DemographicsScreen onSubmit={(answers) => send({ type: "SUBMIT_DEMOGRAPHICS", answers })} />;
      break;
    case "pilotFeedback":
      screen = <PilotFeedbackScreen onSubmit={(answers) => send({ type: "SUBMIT_PILOT", answers })} />;
      break;
    case "debrief":
    case "withdrawn": {
      const flawed = c.list
        ? Object.values(c.design.modules)
            .flat()
            .filter((claimId) => v3.versionFor(c.list!, claimId) === "weak")
            .sort()
            .map((claimId) => {
              const e = explanation(claimId, "weak");
              return { claimId, claim: e.claim, flaw: e.flaw ?? "" };
            })
        : [];
      screen = (
        <DebriefScreen
          score={c.score}
          toneName={toneName}
          flawed={flawed}
          withdrawn={name === "withdrawn"}
          onWithdraw={() => send({ type: "WITHDRAW" })}
        />
      );
      break;
    }
  }

  return (
    <div className="app v3" data-state={name}>
      <header>
        <span className="brand">Nova</span>
      </header>
      <main>{screen}</main>
    </div>
  );
}
