import { useState, type UIEvent } from "react";
import type { AgeScreenAnswer, FollowupId, StimulusResponse } from "@eiai/schema";
import type { SessionContext, SessionEvent } from "@eiai/fsm";
import { currentItemId, stratumFor } from "@eiai/fsm";
import { allocate } from "./allocation";
import { itemById, requireLanguage, stimulusFor } from "./stimuli";

/**
 * Eligibility, consent, allocation and the item screen.
 *
 * Every interactive control carries a `data-testid`, because the model-based
 * test drives these by generated path rather than by hand-written script and
 * needs a stable handle on each one.
 *
 * The questionnaire, funnel and debrief live in screens-end.tsx.
 */

export type Send = (event: SessionEvent) => void;

/**
 * What the screen offers, which is one option wider than what it stores.
 *
 * `under-18` exists so a visitor can say so and be turned away; it never becomes
 * an `AgeBand` and never reaches the log. Spec v2 §1.
 */
const AGE_OPTIONS: AgeScreenAnswer[] = ["under-18", "18-24", "25-34", "35+"];

const AGE_LABELS: Record<AgeScreenAnswer, string> = {
  "under-18": "Under 18",
  "18-24": "18-24",
  "25-34": "25-34",
  "35+": "35 or over",
};

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
        <legend>Which age group are you in?</legend>
        {AGE_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            data-testid={`age-${option}`}
            aria-pressed={context.ageAnswer === option}
            className={context.ageAnswer === option ? "choice selected" : "choice"}
            onClick={() => send({ type: "SET_AGE_ANSWER", ageAnswer: option })}
          >
            {AGE_LABELS[option]}
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

export function ScreenedOutScreen({ context }: { context: SessionContext }) {
  // Participant-facing copy written for v2; flagged for the researcher's review.
  // Deliberately says nothing about why beyond the eligibility criterion, and
  // asks for nothing further: a visitor who is turned away has given the study
  // one fact and should not be asked for a second.
  return (
    <section data-testid="screen-screened-out" data-reason={context.screenedOutReason ?? ""}>
      <h1>Thank you for your interest</h1>
      <p>
        This study is open to participants aged 18 and over who have not had
        formal training in marine biology or oceanography.
      </p>
      <p>
        Nothing you entered has been kept. You can close this page.
      </p>
    </section>
  );
}

export function AllocatingScreen({
  context,
  send,
  sessionId,
}: {
  context: SessionContext;
  send: Send;
  sessionId: string;
}) {
  // Drawn from the committed seeded sequence in materials/allocation.json,
  // against the participant's real stratum. Previously both were literals
  // (`warm`, `en:adult`), which made the neutral arm unreachable and recorded a
  // stratum that contradicted the eligibility answers.
  const stratum =
    context.language && context.ageGroup
      ? stratumFor(context.language, context.ageGroup)
      : null;
  const assignment = stratum ? allocate(sessionId, stratum) : null;

  return (
    <section data-testid="screen-allocating">
      <h1>Setting up your session</h1>
      <p>One moment.</p>
      {assignment === null ? (
        // Reachable only if the machine let someone past eligibility without
        // both answers, which would be a statechart bug. Better to show it than
        // to invent an assignment.
        <p className="warning" data-testid="allocate-blocked">
          Eligibility answers are incomplete, so no condition can be assigned.
        </p>
      ) : (
        <button
          type="button"
          className="primary"
          data-testid="allocate"
          data-condition={assignment.condition}
          data-stratum={assignment.stratum}
          data-allocation-seq={assignment.allocationSeq}
          onClick={() =>
            send({
              type: "ALLOCATE",
              condition: assignment.condition,
              stratum: assignment.stratum,
              allocationSeq: assignment.allocationSeq,
            })
          }
        >
          Continue
        </button>
      )}
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
  onAdviceScroll,
}: {
  context: SessionContext;
  send: Send;
  phase: "estimate" | "advice" | "revise";
  onAdviceScroll?: ((fraction: number) => void) | undefined;
}) {
  const itemId = currentItemId(context);
  if (!itemId) return null;
  const item = itemById(itemId);
  const language = requireLanguage(context, "the item screen");
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

      {phase === "advice" && (
        <>
          <AdviceBlock
            context={context}
            send={send}
            itemId={itemId}
            onScroll={onAdviceScroll}
          />
          <VerifyButton send={send} clicks={context.verifyClicks} />
        </>
      )}

      {phase === "revise" && (
        <>
          <AdviceBlock
            context={context}
            send={send}
            itemId={itemId}
            onScroll={onAdviceScroll}
            readOnly
          />
          <VerifyButton send={send} clicks={context.verifyClicks} />
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
  onScroll,
  readOnly = false,
}: {
  context: SessionContext;
  send: Send;
  itemId: string;
  onScroll?: ((fraction: number) => void) | undefined;
  readOnly?: boolean | undefined;
}) {
  const stimulus = stimulusFor(context, itemId);

  // Fraction of the scrollable extent reached. A response that fits entirely on
  // screen has no extent, and counts as fully seen rather than as zero -- the
  // H4 mediator asks whether the justification was displayed, not whether the
  // participant happened to need to scroll for it.
  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    if (!onScroll) return;
    const el = event.currentTarget;
    const extent = el.scrollHeight - el.clientHeight;
    onScroll(extent <= 0 ? 1 : Math.min(1, (el.scrollTop + el.clientHeight) / el.scrollHeight));
  };

  return (
    <div
      className="advice"
      data-testid="advice"
      data-response-id={stimulus.response_id}
      onScroll={handleScroll}
    >
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
        <>
          <FollowupBlock context={context} send={send} stimulus={stimulus} />
          <button
            type="button"
            className="primary"
            data-testid="request-final"
            onClick={() => send({ type: "REQUEST_FINAL" })}
          >
            Continue
          </button>
        </>
      )}
    </div>
  );
}

const FOLLOWUP_PROMPTS: { id: FollowupId; label: string }[] = [
  { id: "measurement", label: "Can you explain how that's measured?" },
  { id: "certainty", label: "How certain are you about that?" },
  { id: "challenge", label: "I think that might be wrong." },
];

function FollowupBlock({
  context,
  send,
  stimulus,
}: {
  context: SessionContext;
  send: Send;
  stimulus: StimulusResponse;
}) {
  return (
    <div className="followups" data-testid="followups">
      <p className="followup-prompt">Would you like to ask anything about that?</p>
      {FOLLOWUP_PROMPTS.map(({ id, label }) => {
        const asked = context.followupsSelected.includes(id);
        return (
          <div key={id}>
            <button
              type="button"
              className={asked ? "choice selected" : "choice"}
              data-testid={`followup-${id}`}
              disabled={asked}
              onClick={() => send({ type: "SELECT_FOLLOWUP", followupId: id })}
            >
              {label}
            </button>
            {asked && (
              <p className="followup-reply" data-testid={`followup-${id}-reply`}>
                {stimulus.followups[id]}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Logs verification intent and opens nothing (spec section 6, step 5). The
 * point is to measure the impulse to check, not to satisfy it -- following a
 * link would leave the study and confound the measure with whatever the
 * participant then read.
 */
export function VerifyButton({ send, clicks }: { send: Send; clicks: number }) {
  return (
    <div className="verify">
      <button
        type="button"
        className="choice"
        data-testid="verify"
        onClick={() => send({ type: "CLICK_VERIFY" })}
      >
        Check this claim
      </button>
      {clicks > 0 && (
        <span className="verify-noted" data-testid="verify-noted">
          Noted.
        </span>
      )}
    </div>
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
