import { useState } from "react";
import { questionnaireDefinition, type Language, type QuestionDefinition } from "@eiai/schema";
import type { SessionContext, SessionEvent } from "@eiai/fsm";
import type { Translate } from "./i18n";
import { items } from "./stimuli";

/**
 * Questionnaire, funnelled suspicion probe, and debrief.
 *
 * The funnel is three separate screens rather than one form, because the spec
 * requires the stages be administered in order without backtracking: seeing
 * "did anything seem unusual?" must not let a participant go back and revise
 * their more spontaneous answer to "what was this about?".
 */

export type Send = (event: SessionEvent) => void;

const LIKERT7 = [1, 2, 3, 4, 5, 6, 7];
const LIKERT5 = [1, 2, 3, 4, 5];
const GENDERS = ["female", "male", "other", "prefer_not_to_say"] as const;
const AI_USAGE = ["Never", "Rarely", "Monthly", "Weekly", "Daily"];

function LikertRow({
  question,
  value,
  onChange,
  t,
  scale,
}: {
  question: QuestionDefinition;
  value: number | string | undefined;
  onChange: (value: number) => void;
  t: Translate;
  scale: number[];
}) {
  return (
    <fieldset className="likert" data-testid={`q-${question.id}`}>
      <legend>{question.text_en}</legend>
      <span className="anchor">{t("questionnaire.scaleLow")}</span>
      {scale.map((point) => (
        <button
          key={point}
          type="button"
          data-testid={`${question.id}-${point}`}
          aria-pressed={value === point}
          className={value === point ? "choice selected" : "choice"}
          onClick={() => onChange(point)}
        >
          {point}
        </button>
      ))}
      <span className="anchor">{t("questionnaire.scaleHigh")}</span>
    </fieldset>
  );
}

export function QuestionnaireScreen({
  context,
  send,
  t,
}: {
  context: SessionContext;
  send: Send;
  t: Translate;
}) {
  const [showIncomplete, setShowIncomplete] = useState(false);
  const answer = (id: string, value: number | string) =>
    send({ type: "ANSWER_QUESTION", id, value });

  const bySale = (scale: string) =>
    questionnaireDefinition.filter((question) => question.scale === scale);

  // Age band and primary language were captured at eligibility and are carried
  // across by the machine, so they are not asked again here.
  const askedCovariates = bySale("covariates").filter(
    (question) => question.id !== "cov_age_band" && question.id !== "cov_primary_language",
  );

  return (
    <section data-testid="screen-questionnaire">
      <h1>{t("questionnaire.title")}</h1>

      <h2>{t("questionnaire.warmth")}</h2>
      {bySale("warmth").map((question) => (
        <LikertRow
          key={question.id}
          question={question}
          value={context.answers[question.id]}
          onChange={(value) => answer(question.id, value)}
          t={t}
          scale={LIKERT7}
        />
      ))}

      <h2>{t("questionnaire.competence")}</h2>
      {bySale("competence").map((question) => (
        <LikertRow
          key={question.id}
          question={question}
          value={context.answers[question.id]}
          onChange={(value) => answer(question.id, value)}
          t={t}
          scale={LIKERT7}
        />
      ))}

      <h2>{t("questionnaire.trust")}</h2>
      {bySale("trust").map((question) => (
        <LikertRow
          key={question.id}
          question={question}
          value={context.answers[question.id]}
          onChange={(value) => answer(question.id, value)}
          t={t}
          scale={LIKERT7}
        />
      ))}

      <h2>{t("questionnaire.covariates")}</h2>
      {askedCovariates.map((question) => {
        if (question.id === "cov_gender") {
          return (
            <fieldset key={question.id} className="likert" data-testid={`q-${question.id}`}>
              <legend>{question.text_en}</legend>
              {GENDERS.map((option) => (
                <button
                  key={option}
                  type="button"
                  data-testid={`${question.id}-${option}`}
                  aria-pressed={context.answers[question.id] === option}
                  className={
                    context.answers[question.id] === option ? "choice selected" : "choice"
                  }
                  onClick={() => answer(question.id, option)}
                >
                  {option.replace(/_/g, " ")}
                </button>
              ))}
            </fieldset>
          );
        }
        if (question.id === "cov_ai_usage") {
          return (
            <fieldset key={question.id} className="likert" data-testid={`q-${question.id}`}>
              <legend>{question.text_en}</legend>
              {LIKERT5.map((point) => (
                <button
                  key={point}
                  type="button"
                  data-testid={`${question.id}-${point}`}
                  aria-pressed={context.answers[question.id] === point}
                  className={
                    context.answers[question.id] === point ? "choice selected" : "choice"
                  }
                  onClick={() => answer(question.id, point)}
                >
                  {AI_USAGE[point - 1]}
                </button>
              ))}
            </fieldset>
          );
        }
        return (
          <LikertRow
            key={question.id}
            question={question}
            value={context.answers[question.id]}
            onChange={(value) => answer(question.id, value)}
            t={t}
            scale={LIKERT7}
          />
        );
      })}

      {showIncomplete && (
        <p className="warning" data-testid="questionnaire-incomplete">
          {t("questionnaire.incomplete")}
        </p>
      )}

      <button
        type="button"
        className="primary"
        data-testid="submit-questionnaire"
        onClick={() => {
          setShowIncomplete(true);
          send({ type: "SUBMIT_QUESTIONNAIRE" });
        }}
      >
        {t("common.continue")}
      </button>
    </section>
  );
}

export function FunnelScreen({
  stage,
  send,
  t,
}: {
  stage: "purpose" | "anomaly" | "belief";
  send: Send;
  t: Translate;
}) {
  const [text, setText] = useState("");

  if (stage === "belief") {
    return (
      <section data-testid="screen-funnel-belief">
        <h1>{t("funnel.belief")}</h1>
        {(["yes", "no", "unsure"] as const).map((option) => (
          <button
            key={option}
            type="button"
            className="choice"
            data-testid={`funnel-belief-${option}`}
            onClick={() => send({ type: "ANSWER_FUNNEL", stage: "belief", text: option })}
          >
            {option === "unsure" ? t("funnel.unsure") : t(`common.${option}`)}
          </button>
        ))}
      </section>
    );
  }

  return (
    <section data-testid={`screen-funnel-${stage}`}>
      <h1>{t(`funnel.${stage}`)}</h1>
      <p className="hint">{t("funnel.freeTextHint")}</p>
      <textarea
        data-testid={`funnel-${stage}-text`}
        rows={4}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <button
        type="button"
        className="primary"
        data-testid={`funnel-${stage}-submit`}
        onClick={() => send({ type: "ANSWER_FUNNEL", stage, text })}
      >
        {t("common.continue")}
      </button>
    </section>
  );
}

export function DebriefScreen({
  send,
  t,
  language,
}: {
  send: Send;
  t: Translate;
  language: Language;
}) {
  // Generated from the item bank rather than written out, so a corrected true
  // value can never disagree with what the debrief tells the participant.
  const errorItems = items.filter((item) => item.is_error);

  return (
    <section data-testid="screen-debrief">
      <h1>{t("debrief.title")}</h1>
      <p>{t("debrief.body")}</p>

      {/* The independent variable, disclosed before the errors. A debrief
          that reveals the wrong answers but not the experiment explains the
          deception while hiding the study. */}
      <h2>{t("debrief.designTitle")}</h2>
      <p data-testid="debrief-manipulation">{t("debrief.designBody")}</p>

      <h2>{t("debrief.errorsTitle")}</h2>
      <ul className="debrief-errors">
        {errorItems.map((item) => (
          <li key={item.id} data-testid={`debrief-${item.id}`}>
            <strong>{item.question[language]}</strong>
            <br />
            {t("debrief.told")}: <span data-testid={`debrief-${item.id}-told`}>
              {item.advice_value} {item.unit[language]}
            </span>
            <br />
            {t("debrief.correct")}: <span data-testid={`debrief-${item.id}-true`}>
              {item.true_value} {item.unit[language]}
            </span>
            <br />
            <span className="source" data-testid={`debrief-${item.id}-source`}>
              {/* The schema requires at least one source per item, so the
                  assertion states what is already enforced at load. Optional
                  chaining here would render the label with nothing after it --
                  a correction that looks sourced and is not. */}
              {t("debrief.source")}: {item.sources[0]!.citation}
            </span>
          </li>
        ))}
      </ul>

      <h2>{t("debrief.withdrawTitle")}</h2>
      <p>{t("debrief.withdrawBody")}</p>
      <button
        type="button"
        className="withdraw"
        data-testid="debrief-withdraw"
        onClick={() => send({ type: "WITHDRAW", atState: "debrief" })}
      >
        {t("debrief.withdraw")}
      </button>

      <button
        type="button"
        className="primary"
        data-testid="submit-debrief"
        onClick={() => send({ type: "FINISH" })}
      >
        {t("debrief.finish")}
      </button>
    </section>
  );
}
