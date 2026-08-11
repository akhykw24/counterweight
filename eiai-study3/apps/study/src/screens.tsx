import { useState } from "react";
import type { AgeBand, Language } from "@eiai/schema";
import type { SessionContext, SessionEvent } from "@eiai/fsm";
import { currentItemId } from "@eiai/fsm";
import { itemById, resolveStimulus } from "./stimuli";

/**
 * Screens for the day-3 flow.
 *
 * Every interactive control carries a `data-testid`, because the model-based
 * test drives these by generated path rather than by hand-written script and
 * needs a stable handle on each one.
 *
 * Questionnaire, funnel and debrief are stubs: their content is day 5. They
 * exist so the statechart's later states are reachable and clickable now.
 */

export type Send = (event: SessionEvent) => void;

const LANGUAGES: { code: Language; label: string }[] = [
  { code: "en", label: "English" },
  { code: "ru", label: "Русский" },
  { code: "kk", label: "Қазақша" },
];

const AGE_BANDS: AgeBand[] = ["14-15", "16-17", "18-24", "25+"];

export function EligibilityScreen({
  context,
  send,
}: {
  context: SessionContext;
  send: Send;
}) {
  return (
    <section data-testid="screen-eligibility">
      <h1>Before we start</h1>

      <fieldset>
        <legend>Which language would you like to use?</legend>
        {LANGUAGES.map(({ code, label }) => (
          <button
            key={code}
            type="button"
            data-testid={`lang-${code}`}
            aria-pressed={context.language === code}
            className={context.language === code ? "choice selected" : "choice"}
            onClick={() => send({ type: "SET_LANGUAGE", language: code })}
          >
            {label}
          </button>
        ))}
      </fieldset>

      <fieldset>
        <legend>Which age group are you in?</legend>
        {AGE_BANDS.map((band) => (
          <button
            key={band}
            type="button"
            data-testid={`age-${band}`}
            aria-pressed={context.ageBand === band}
            className={context.ageBand === band ? "choice selected" : "choice"}
            onClick={() => send({ type: "SET_AGE_BAND", ageBand: band })}
          >
            {band}
          </button>
        ))}
      </fieldset>

      <fieldset>
        <legend>
          Have you had formal training in marine biology or oceanography?
        </legend>
        <button
          type="button"
          data-testid="training-no"
          aria-pressed={context.priorTraining === false}
          className={context.priorTraining === false ? "choice selected" : "choice"}
          onClick={() => send({ type: "SET_PRIOR_TRAINING", priorTraining: false })}
        >
          No
        </button>
        <button
          type="button"
          data-testid="training-yes"
          aria-pressed={context.priorTraining === true}
          className={context.priorTraining === true ? "choice selected" : "choice"}
          onClick={() => send({ type: "SET_PRIOR_TRAINING", priorTraining: true })}
        >
          Yes
        </button>
      </fieldset>

      <button
        type="button"
        className="primary"
        data-testid="submit-eligibility"
        onClick={() => send({ type: "SUBMIT_ELIGIBILITY" })}
      >
        Continue
      </button>
    </section>
  );
}

export function ConsentScreen({ send }: { send: Send }) {
  return (
    <section data-testid="screen-consent">
      <h1>Informed consent</h1>
      <p>
        This study is about how people interact with AI assistants. You will
        answer eight to twelve estimation questions and see an assistant's
        response to each.
      </p>
      <p>
        We record what you enter, how long you take, how far you scroll through
        each response, and when you switch away from this tab. We do not record
        your name, your email, or your exact age.
      </p>
      <p>You may stop at any point, and stopping costs you nothing.</p>
      <button
        type="button"
        className="primary"
        data-testid="give-consent"
        onClick={() => send({ type: "GIVE_CONSENT" })}
      >
        I consent, and I want to take part
      </button>
    </section>
  );
}

export function AssentScreen({
  context,
  send,
}: {
  context: SessionContext;
  send: Send;
}) {
  return (
    <section data-testid="screen-assent">
      <h1>Do you want to take part?</h1>
      <p>
        Your parent or guardian has already been given a form about this study.
        Enter the session code from that form so we know it was returned. The
        code is not your name and does not identify you.
      </p>
      <p>
        You are being asked separately, because it is your choice too. You can
        stop at any time and nobody will mind.
      </p>
      <label htmlFor="parental-code">Session code</label>
      <input
        id="parental-code"
        data-testid="parental-code"
        value={context.parentalConsentCode ?? ""}
        onChange={(event) =>
          send({ type: "SET_PARENTAL_CODE", code: event.target.value })
        }
      />
      <button
        type="button"
        className="primary"
        data-testid="give-assent"
        disabled={!context.parentalConsentCode?.trim()}
        onClick={() => send({ type: "GIVE_ASSENT" })}
      >
        Yes, I want to take part
      </button>
    </section>
  );
}

export function AllocatingScreen({ send }: { send: Send }) {
  return (
    <section data-testid="screen-allocating">
      <h1>Setting up your session</h1>
      <p>One moment.</p>
      {/* Day 4 replaces this with a fetch of the pre-computed seeded sequence
          from the backend. The button keeps the state observable and driveable
          until then. */}
      <button
        type="button"
        className="primary"
        data-testid="allocate"
        onClick={() =>
          send({
            type: "ALLOCATE",
            condition: "warm",
            stratum: "en:adult",
            allocationSeq: 0,
          })
        }
      >
        Continue
      </button>
    </section>
  );
}

function Slider({
  id,
  label,
  min,
  max,
  value,
  onChange,
  testId,
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  value: number | null;
  onChange: (value: number) => void;
  testId: string;
}) {
  // A range input always has a thumb somewhere, so an unset slider still shows
  // a position. If the participant agrees with that position, `change` never
  // fires, the machine never receives a value, and Continue stays disabled
  // with nothing on screen explaining why. Committing on pointer and key
  // release as well means any deliberate interaction registers, including one
  // that lands on the value already displayed.
  const commit = (raw: string) => onChange(Number(raw));

  return (
    <div className="slider">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        data-testid={testId}
        value={value ?? Math.round((min + max) / 2)}
        aria-valuetext={value === null ? "not set" : String(value)}
        onChange={(event) => commit(event.target.value)}
        onPointerUp={(event) => commit(event.currentTarget.value)}
        onKeyUp={(event) => commit(event.currentTarget.value)}
      />
      <output data-testid={`${testId}-value`}>{value ?? "—"}</output>
      {value === null && (
        <p className="hint" data-testid={`${testId}-hint`}>
          Move the slider to set your answer. If the current position is right,
          click it to confirm.
        </p>
      )}
    </div>
  );
}

export function ItemScreen({
  context,
  send,
  phase,
}: {
  context: SessionContext;
  send: Send;
  phase: "estimate" | "advice" | "revise";
}) {
  const itemId = currentItemId(context);
  if (!itemId) return null;
  const item = itemById(itemId);
  const language = context.language ?? "en";
  const [lo, hi] = item.plausible_answer_range;

  const position = context.itemIndex + 1;
  const total = context.itemIds.length;

  return (
    <section data-testid={`screen-item-${phase}`} data-item-id={itemId}>
      <p className="progress" data-testid="progress">
        Question {position} of {total}
      </p>
      <h1>{item.question[language]}</h1>
      <p className="unit">Answer in {item.unit[language]}.</p>

      {phase === "estimate" && (
        <>
          <Slider
            id="initial-estimate"
            testId="initial-estimate"
            label="Your estimate"
            min={lo}
            max={hi}
            value={context.initialEstimate}
            onChange={(value) => send({ type: "SET_ESTIMATE", value })}
          />
          <Slider
            id="initial-confidence"
            testId="initial-confidence"
            label="How confident are you? (0–100)"
            min={0}
            max={100}
            value={context.initialConfidence}
            onChange={(value) => send({ type: "SET_CONFIDENCE", value })}
          />
          <button
            type="button"
            className="primary"
            data-testid="submit-initial"
            disabled={
              context.initialEstimate === null || context.initialConfidence === null
            }
            onClick={() => send({ type: "SUBMIT_INITIAL" })}
          >
            Submit and see the assistant's answer
          </button>
        </>
      )}

      {phase === "advice" && <AdviceBlock context={context} send={send} itemId={itemId} />}

      {phase === "revise" && (
        <>
          <AdviceBlock context={context} send={send} itemId={itemId} readOnly />
          <Slider
            id="final-estimate"
            testId="final-estimate"
            label="Your final estimate"
            min={lo}
            max={hi}
            value={context.finalEstimate}
            onChange={(value) => send({ type: "SET_ESTIMATE", value })}
          />
          <Slider
            id="final-confidence"
            testId="final-confidence"
            label="How confident are you now? (0–100)"
            min={0}
            max={100}
            value={context.finalConfidence}
            onChange={(value) => send({ type: "SET_CONFIDENCE", value })}
          />
          <button
            type="button"
            className="primary"
            data-testid="submit-final"
            disabled={
              context.finalEstimate === null || context.finalConfidence === null
            }
            onClick={() => send({ type: "SUBMIT_FINAL" })}
          >
            {context.itemIndex + 1 < context.itemIds.length
              ? "Next question"
              : "Finish the questions"}
          </button>
        </>
      )}
    </section>
  );
}

function AdviceBlock({
  context,
  send,
  itemId,
  readOnly = false,
}: {
  context: SessionContext;
  send: Send;
  itemId: string;
  readOnly?: boolean;
}) {
  const stimulus = resolveStimulus(
    context.language ?? "en",
    context.condition ?? "neutral",
    context.registerState,
    itemId,
  );

  return (
    <div className="advice" data-testid="advice" data-response-id={stimulus.response_id}>
      <p data-testid="advice-body">{stimulus.body}</p>
      {/* Rendered as its own element: scroll depth on the justification is the
          H4 mediator, so it has to be separately measurable from the body. */}
      <p className="justification" data-testid="advice-justification">
        {stimulus.justification_text}
      </p>
      {stimulus.placeholder && (
        <p className="warning" data-testid="placeholder-warning">
          Placeholder stimulus — not collection material.
        </p>
      )}
      {!readOnly && (
        <button
          type="button"
          className="primary"
          data-testid="request-final"
          onClick={() => send({ type: "REQUEST_FINAL" })}
        >
          Continue
        </button>
      )}
    </div>
  );
}

export function StubScreen({
  name,
  title,
  cta,
  event,
  send,
}: {
  name: string;
  title: string;
  cta: string;
  event: SessionEvent;
  send: Send;
}) {
  return (
    <section data-testid={`screen-${name}`}>
      <h1>{title}</h1>
      <p className="stub">Built on day 5.</p>
      <button
        type="button"
        className="primary"
        data-testid={`submit-${name}`}
        onClick={() => send(event)}
      >
        {cta}
      </button>
    </section>
  );
}

export function TerminalScreen({
  name,
  title,
  body,
}: {
  name: string;
  title: string;
  body: string;
}) {
  return (
    <section data-testid={`screen-${name}`}>
      <h1>{title}</h1>
      <p>{body}</p>
    </section>
  );
}

export function WithdrawButton({ send, atState }: { send: Send; atState: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        className="withdraw"
        data-testid="withdraw"
        onClick={() => setConfirming(true)}
      >
        Stop and leave
      </button>
    );
  }

  return (
    <span className="withdraw-confirm">
      <button
        type="button"
        className="withdraw"
        data-testid="withdraw-confirm"
        onClick={() => send({ type: "WITHDRAW", atState })}
      >
        Yes, stop now
      </button>
      <button type="button" data-testid="withdraw-cancel" onClick={() => setConfirming(false)}>
        Keep going
      </button>
    </span>
  );
}
