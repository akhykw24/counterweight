import { useMachine } from "@xstate/react";
import type { StateValue } from "xstate";
import { sessionMachine, type SessionMachine } from "@eiai/fsm";
import { record } from "./events";
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

export function App({ machine = sessionMachine }: { machine?: SessionMachine }) {
  const [state, rawSend] = useMachine(machine);
  const name = stateName(state.value);

  const send: Send = (event) => {
    record(`UI_${event.type}`, { ...event, at_state: name });
    rawSend(event);
  };

  return (
    <main className="app">
      <header>
        <span className="brand">Deep-sea estimation study</span>
        {!TERMINAL.has(name) && <WithdrawButton send={send} atState={name} />}
      </header>

      <div className="screen" data-testid="screen" data-state={name}>
        {name === "eligibility" && (
          <EligibilityScreen context={state.context} send={send} />
        )}
        {name === "consent" && <ConsentScreen send={send} />}
        {name === "assent" && <AssentScreen context={state.context} send={send} />}
        {name === "allocating" && <AllocatingScreen send={send} />}

        {name === "task.estimate" && (
          <ItemScreen context={state.context} send={send} phase="estimate" />
        )}
        {name === "task.advice" && (
          <ItemScreen context={state.context} send={send} phase="advice" />
        )}
        {name === "task.revise" && (
          <ItemScreen context={state.context} send={send} phase="revise" />
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
