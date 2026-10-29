import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  fillToneChoice,
  instruments,
  preMeasures,
  trustMeasures,
  mission,
  missionHeading,
  quiz,
  quizItem,
  task as taskById,
  type NcsItem,
  type Scale,
} from "./materials";

/**
 * v3 screens. Every sentence a participant reads comes from ./materials, which
 * reads the approved texts; the only strings written here are button labels
 * and the typing indicator's accessible name.
 */

export const testId = (id: string) => ({ "data-testid": id });

/** How long Nova "types" before a message appears. The brief caps it at 1 s. */
export const TYPING_MS = 800;
/** Continue appears this long after a lesson message is shown. */
export const CONTINUE_DELAY_MS = 2000;

export function Scale7({
  id,
  scale,
  value,
  onChange,
}: {
  id: string;
  scale: Scale;
  value: number | undefined;
  onChange: (value: number) => void;
}) {
  const points = [];
  for (let n = scale.min; n <= scale.max; n += 1) points.push(n);
  return (
    <div className="scale" role="radiogroup" {...testId(`scale-${id}`)}>
      <div className="scale-points">
        {points.map((point) => (
          <button
            key={point}
            type="button"
            role="radio"
            aria-checked={value === point}
            className={value === point ? "point selected" : "point"}
            onClick={() => onChange(point)}
            {...testId(`${id}-${point}`)}
          >
            {point}
          </button>
        ))}
      </div>
      <div className="scale-anchors" aria-hidden="true">
        <span>
          {scale.min} = {scale.low}
        </span>
        <span>
          {scale.max} = {scale.high}
        </span>
      </div>
    </div>
  );
}

function Choices({
  id,
  options,
  value,
  onChange,
}: {
  id: string;
  options: readonly string[];
  value: string | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <div className="choices" role="radiogroup">
      {options.map((option, i) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          className={value === option ? "option selected" : "option"}
          onClick={() => onChange(option)}
          {...testId(`${id}-${i + 1}`)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

/** A primary button that ignores clicks while a previous one is in flight. */
function Primary({
  id,
  disabled,
  onClick,
  children,
}: {
  id: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="primary" disabled={disabled} onClick={onClick} {...testId(id)}>
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Consent and screening
// ---------------------------------------------------------------------------

export function ConsentScreen({ pilotFlow, onConsent }: { pilotFlow: boolean; onConsent: () => void }) {
  const c = instruments.consent;
  const [adult, setAdult] = useState(false);
  const [agree, setAgree] = useState(false);
  return (
    <section {...testId("screen-consent")}>
      {c.paragraphs.map((p) => (
        <p key={p}>{p}</p>
      ))}
      {pilotFlow && c.pilot_notice && (
        <p className="notice" {...testId("pilot-notice")}>
          {c.pilot_notice}
        </p>
      )}
      <label className="check">
        <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} {...testId("consent-adult")} />
        {c.checkboxes[0]}
      </label>
      <label className="check">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} {...testId("consent-agree")} />
        {c.checkboxes[1]}
      </label>
      <Primary id="consent-start" disabled={!(adult && agree)} onClick={onConsent}>
        {c.button}
      </Primary>
    </section>
  );
}

export function ScreeningScreen({
  onSubmit,
}: {
  onSubmit: (answer: { age: number; englishLevel: string; studyLanguage: string }) => void;
}) {
  const s = instruments.screening;
  const [age, setAge] = useState("");
  const [level, setLevel] = useState<string | undefined>();
  const [language, setLanguage] = useState<string | undefined>();
  const ageNumber = /^\d{1,3}$/.test(age.trim()) ? Number(age.trim()) : null;
  const ready = ageNumber !== null && level !== undefined && language !== undefined;
  return (
    <section {...testId("screen-screening")}>
      <div className="question">
        <label htmlFor="age">{s.age.text}</label>
        <input
          id="age"
          inputMode="numeric"
          autoComplete="off"
          value={age}
          onChange={(e) => setAge(e.target.value)}
          {...testId("screening-age")}
        />
      </div>
      <div className="question">
        <p className="question-text">{s.english.text}</p>
        <div className="choices" role="radiogroup">
          {s.english.options.map((o) => (
            <button
              key={o.code}
              type="button"
              role="radio"
              aria-checked={level === o.code}
              className={level === o.code ? "option selected" : "option"}
              onClick={() => setLevel(o.code)}
              {...testId(`english-${o.code}`)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="question">
        <p className="question-text">{s.study_language.text}</p>
        <div className="choices" role="radiogroup">
          {s.study_language.options.map((o) => (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={language === o}
              className={language === o ? "option selected" : "option"}
              onClick={() => setLanguage(o)}
              {...testId(`study-language-${o}`)}
            >
              {o}
            </button>
          ))}
        </div>
      </div>
      <Primary
        id="screening-submit"
        disabled={!ready}
        onClick={() => ready && onSubmit({ age: ageNumber!, englishLevel: level!, studyLanguage: language! })}
      >
        Continue
      </Primary>
    </section>
  );
}

export function IneligibleScreen() {
  return (
    <section {...testId("screen-ineligible")}>
      <p>{instruments.screening.ineligible}</p>
    </section>
  );
}

export function PreScreen({ onSubmit }: { onSubmit: (answers: Record<string, number | string>) => void }) {
  const [answers, setAnswers] = useState<Record<string, number | string>>({});
  const set = (id: string, value: number | string) => setAnswers((a) => ({ ...a, [id]: value }));
  const ready = preMeasures.every((p) => answers[p.item_id] !== undefined);
  return (
    <section {...testId("screen-pre")}>
      {preMeasures.map((p) => (
        <div className="question" key={p.item_id} {...testId(`q-${p.item_id}`)}>
          <p className="question-text">{p.text}</p>
          {"scale" in p && p.scale ? (
            <Scale7 id={p.item_id} scale={p.scale} value={answers[p.item_id] as number | undefined} onChange={(v) => set(p.item_id, v)} />
          ) : (
            <Choices
              id={p.item_id}
              options={("options" in p ? p.options : []) as string[]}
              value={answers[p.item_id] as string | undefined}
              onChange={(v) => set(p.item_id, v)}
            />
          )}
        </div>
      ))}
      <Primary id="pre-submit" disabled={!ready} onClick={() => ready && onSubmit(answers)}>
        Continue
      </Primary>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Nova: chat messages, lesson, transitions
// ---------------------------------------------------------------------------

export function NovaBubble({ lines, id }: { lines: readonly string[]; id: string }) {
  return (
    <div className="bubble" {...testId(id)}>
      <span className="speaker">Nova</span>
      {lines.map((line, i) => (
        <p key={i} className={i === lines.length - 1 && lines.length > 1 ? "tone-line" : undefined}>
          {line}
        </p>
      ))}
    </div>
  );
}

function Typing() {
  return (
    <div className="bubble typing" aria-label="Nova is typing" {...testId("nova-typing")}>
      <span />
      <span />
      <span />
    </div>
  );
}

/**
 * One message at a time: a typing indicator for under a second, the message,
 * and Continue two seconds after it appears. `onContinue` receives the time
 * the message was on screen before Continue, which is the reading time.
 */
export function useMessageTiming(key: string) {
  // The phase is stored with the message it belongs to. Resetting it in an
  // effect instead left one rendered frame, after each Continue, in which the
  // *next* message was drawn with the previous one's "ready" phase -- its
  // Continue already on screen, clickable before a word of it was read.
  const [state, setState] = useState<{ key: string; phase: "typing" | "shown" | "ready" }>({
    key,
    phase: "typing",
  });
  const shownAt = useRef<{ key: string; at: number } | null>(null);
  useEffect(() => {
    const show = setTimeout(() => {
      shownAt.current = { key, at: performance.now() };
      setState({ key, phase: "shown" });
    }, TYPING_MS);
    const ready = setTimeout(() => setState({ key, phase: "ready" }), TYPING_MS + CONTINUE_DELAY_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(ready);
    };
  }, [key]);
  const phase = state.key === key ? state.phase : "typing";
  const dwell = () =>
    shownAt.current && shownAt.current.key === key ? performance.now() - shownAt.current.at : 0;
  return { phase, dwell };
}

export function NovaMessageScreen({
  screenKey,
  heading,
  text,
  onContinue,
}: {
  screenKey: string;
  heading?: string;
  text: string;
  onContinue: () => void;
}) {
  const { phase } = useMessageTiming(screenKey);
  const [sent, setSent] = useState(false);
  return (
    <section className="chat" {...testId(`screen-${screenKey}`)}>
      {heading && <h1>{heading}</h1>}
      {phase === "typing" ? <Typing /> : <NovaBubble id="nova-message" lines={[text]} />}
      {phase === "ready" && (
        <Primary
          id="nova-continue"
          disabled={sent}
          onClick={() => {
            if (sent) return;
            setSent(true);
            onContinue();
          }}
        >
          Continue
        </Primary>
      )}
    </section>
  );
}

export function LessonScreen({
  module,
  messages,
  index,
  onContinue,
}: {
  module: number;
  /** All four messages of the module, in lesson order: explanation, then tone line. */
  messages: readonly { claimId: string; lines: readonly string[] }[];
  index: number;
  onContinue: (dwellMs: number) => void;
}) {
  const key = `lesson-${module}-${index}`;
  const { phase, dwell } = useMessageTiming(key);
  const clicked = useRef<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: "end", behavior: "smooth" });
  }, [phase, index]);
  return (
    <section className="chat" {...testId("screen-lesson")}>
      <p className="progress" {...testId("progress")}>Module {module} of 3</p>
      <h1 {...testId("lesson-heading")}>{mission.lesson_headings[String(module)]}</h1>
      {messages.slice(0, index).map((m, i) => (
        <NovaBubble key={m.claimId} id={`lesson-message-${i + 1}`} lines={m.lines} />
      ))}
      {phase === "typing" ? (
        <Typing />
      ) : (
        <NovaBubble id={`lesson-message-${index + 1}`} lines={messages[index]!.lines} />
      )}
      {phase === "ready" && (
        <Primary
          id="lesson-continue"
          onClick={() => {
            // One Continue per message, however fast the second click lands.
            if (clicked.current === key) return;
            clicked.current = key;
            onContinue(dwell());
          }}
        >
          Continue
        </Primary>
      )}
      <div ref={bottom} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Mission
// ---------------------------------------------------------------------------

export function MissionTaskScreen({
  module,
  taskId,
  optionOrder,
  onAnswer,
}: {
  module: number;
  taskId: string;
  optionOrder: readonly ("lesson" | "intuitive" | "distractor")[];
  onAnswer: (answer: { role: "lesson" | "intuitive" | "distractor"; confidence: number; rtMs: number }) => void;
}) {
  const t = taskById(taskId);
  const [role, setRole] = useState<"lesson" | "intuitive" | "distractor" | undefined>();
  const [confidence, setConfidence] = useState<number | undefined>();
  const mounted = useRef(performance.now());
  const sent = useRef(false);
  const ordered = optionOrder.map((r) => t.options.find((o) => o.role === r)!);
  return (
    <section {...testId("screen-mission-task")} data-task={taskId}>
      <p className="progress" {...testId("progress")}>Module {module} of 3</p>
      <p className="mission-heading">{missionHeading(module)}</p>
      <h1>{t.title}</h1>
      <p>{t.situation}</p>
      <div className="choices stacked" role="radiogroup">
        {ordered.map((o, i) => (
          <button
            key={o.role}
            type="button"
            role="radio"
            aria-checked={role === o.role}
            className={role === o.role ? "option selected" : "option"}
            onClick={() => setRole(o.role)}
            {...testId(`option-${i + 1}`)}
          >
            {o.text}
          </button>
        ))}
      </div>
      <p className="question-text">{mission.confidence.prompt}</p>
      <div className="choices" role="radiogroup">
        {mission.confidence.labels.map((label, i) => {
          const code = mission.confidence.codes[i]!;
          return (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={confidence === code}
              className={confidence === code ? "option selected" : "option"}
              onClick={() => setConfidence(code)}
              {...testId(`confidence-${code}`)}
            >
              {label}
            </button>
          );
        })}
      </div>
      <Primary
        id="mission-next"
        disabled={role === undefined || confidence === undefined}
        onClick={() => {
          if (sent.current || role === undefined || confidence === undefined) return;
          sent.current = true;
          onAnswer({ role, confidence, rtMs: performance.now() - mounted.current });
        }}
      >
        Next
      </Primary>
    </section>
  );
}

export function AttentionScreen({
  module,
  onAnswer,
}: {
  module: number;
  onAnswer: (answer: { choice: string; correct: boolean; rtMs: number }) => void;
}) {
  const a = mission.attention_check;
  const [choice, setChoice] = useState<string | undefined>();
  const mounted = useRef(performance.now());
  const sent = useRef(false);
  return (
    <section {...testId("screen-attention")}>
      <p className="progress" {...testId("progress")}>Module {module} of 3</p>
      <p className="mission-heading">{missionHeading(module)}</p>
      <h1>{a.title}</h1>
      <p>{a.instruction}</p>
      <div className="choices stacked" role="radiogroup">
        {a.options.map((o) => (
          <button
            key={o.text}
            type="button"
            role="radio"
            aria-checked={choice === o.text}
            className={choice === o.text ? "option selected" : "option"}
            onClick={() => setChoice(o.text)}
            {...testId(`attention-${o.text}`)}
          >
            {o.text}
          </button>
        ))}
      </div>
      <Primary
        id="mission-next"
        disabled={choice === undefined}
        onClick={() => {
          if (sent.current || choice === undefined) return;
          sent.current = true;
          const correct = a.options.find((o) => o.text === choice)?.correct === true;
          onAnswer({ choice, correct, rtMs: performance.now() - mounted.current });
        }}
      >
        Next
      </Primary>
    </section>
  );
}

// ---------------------------------------------------------------------------
// After the modules
// ---------------------------------------------------------------------------

function RatingPage({
  screen,
  heading,
  intro,
  scale,
  items,
  onSubmit,
}: {
  screen: string;
  heading?: string;
  intro?: ReactNode;
  scale: Scale;
  items: readonly { id: string; text: ReactNode }[];
  onSubmit: (ratings: Record<string, number>) => void;
}) {
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const sent = useRef(false);
  const ready = items.every((i) => ratings[i.id] !== undefined);
  return (
    <section {...testId(`screen-${screen}`)}>
      {heading && <h1>{heading}</h1>}
      {intro}
      {items.map((item) => (
        <div className="question" key={item.id} {...testId(`q-${item.id}`)}>
          <div className="question-text">{item.text}</div>
          <Scale7 id={item.id} scale={scale} value={ratings[item.id]} onChange={(v) => setRatings((r) => ({ ...r, [item.id]: v }))} />
        </div>
      ))}
      <Primary
        id={`${screen}-next`}
        disabled={!ready}
        onClick={() => {
          if (sent.current || !ready) return;
          sent.current = true;
          onSubmit(ratings);
        }}
      >
        Next
      </Primary>
    </section>
  );
}

export function QuizScreen({
  page,
  itemIds,
  onSubmit,
}: {
  page: number;
  itemIds: readonly string[];
  onSubmit: (ratings: Record<string, number>) => void;
}) {
  return (
    <RatingPage
      key={`quiz-${page}`}
      screen="quiz"
      heading={quiz.heading}
      scale={quiz.scale}
      items={itemIds.map((id) => ({ id, text: quizItem(id).statement }))}
      onSubmit={onSubmit}
    />
  );
}

export function TutorScreen({
  page,
  itemIds,
  onSubmit,
}: {
  page: number;
  itemIds: readonly string[];
  onSubmit: (answers: Record<string, number>) => void;
}) {
  const t = instruments.tutor;
  const items = itemIds.map((id) => {
    const item = t.items.find((i) => i.item_id === id)!;
    return { id, text: item.text, usesStem: item.uses_stem };
  });
  return (
    <RatingPage
      key={`tutor-${page}`}
      screen="tutor"
      intro={
        <>
          <p>{t.instruction}</p>
          {items.some((i) => i.usesStem) && <p className="stem">{t.stem}</p>}
        </>
      }
      scale={t.scale}
      items={items}
      onSubmit={onSubmit}
    />
  );
}

export function FunnelScreen({
  itemId,
  onAnswer,
}: {
  itemId: string;
  onAnswer: (text: string) => void;
}) {
  const f = instruments.funnel.find((x) => x.item_id === itemId)!;
  const [text, setText] = useState("");
  const [choice, setChoice] = useState<string | undefined>();
  const sent = useRef(false);
  const isChoice = f.kind === "choice";
  return (
    <section {...testId(`screen-funnel-${itemId}`)}>
      <p className="question-text">{f.text}</p>
      {isChoice ? (
        <Choices id={`funnel-${itemId}`} options={("options" in f ? f.options : []) as string[]} value={choice} onChange={setChoice} />
      ) : (
        <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} {...testId(`funnel-${itemId}-text`)} />
      )}
      <Primary
        id="funnel-next"
        disabled={isChoice && choice === undefined}
        onClick={() => {
          if (sent.current) return;
          if (isChoice && choice === undefined) return;
          sent.current = true;
          onAnswer(isChoice ? choice! : text);
        }}
      >
        Next
      </Primary>
    </section>
  );
}

export function QualityScreen({
  items,
  onSubmit,
}: {
  /** Claim id and the explanation text as the participant saw it, without the tone line. */
  items: readonly { claimId: string; text: string }[];
  onSubmit: (ratings: Record<string, number>) => void;
}) {
  const q = instruments.explanation_quality;
  return (
    <RatingPage
      screen="quality"
      intro={<p>{q.instruction}</p>}
      scale={q.scale}
      items={items.map((i) => ({ id: i.claimId, text: <blockquote className="quoted">{i.text}</blockquote> }))}
      onSubmit={onSubmit}
    />
  );
}

/** P4-P6, after the funnel. Same wording and scale as approved; only the position moved. */
export function TrustScreen({ onSubmit }: { onSubmit: (answers: Record<string, number>) => void }) {
  const scale = trustMeasures[0]!.scale!;
  return (
    <RatingPage
      screen="trust"
      scale={scale}
      items={trustMeasures.map((p) => ({ id: p.item_id, text: p.text }))}
      onSubmit={onSubmit}
    />
  );
}

export function NcsScreen({ items, onSubmit }: { items: readonly NcsItem[]; onSubmit: (answers: Record<string, number>) => void }) {
  const fallback: Scale = { min: 1, max: 5, low: "", high: "" };
  return (
    <RatingPage
      screen="ncs"
      scale={items[0]?.scale ?? fallback}
      items={items.map((i) => ({ id: i.item_id, text: i.text }))}
      onSubmit={onSubmit}
    />
  );
}

export function DemographicsScreen({ onSubmit }: { onSubmit: (answers: Record<string, string>) => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [selfDescribe, setSelfDescribe] = useState("");
  const sent = useRef(false);
  const items = instruments.demographics;
  const required = items.filter((d) => d.kind === "choice").map((d) => d.item_id);
  const ready = required.every((id) => answers[id] !== undefined);
  return (
    <section {...testId("screen-demographics")}>
      {items.map((d) => (
        <div className="question" key={d.item_id} {...testId(`q-${d.item_id}`)}>
          <p className="question-text">{d.text}</p>
          {d.kind === "text" ? (
            <input
              value={answers[d.item_id] ?? ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [d.item_id]: e.target.value }))}
              {...testId(`${d.item_id}-text`)}
            />
          ) : (
            <>
              <Choices
                id={d.item_id}
                options={(d.options ?? []).map((o) => o.label)}
                value={answers[d.item_id]}
                onChange={(v) => setAnswers((a) => ({ ...a, [d.item_id]: v }))}
              />
              {(d.options ?? []).some((o) => o.free_text && o.label === answers[d.item_id]) && (
                <input value={selfDescribe} onChange={(e) => setSelfDescribe(e.target.value)} {...testId(`${d.item_id}-self`)} />
              )}
            </>
          )}
        </div>
      ))}
      <Primary
        id="demographics-next"
        disabled={!ready}
        onClick={() => {
          if (sent.current || !ready) return;
          sent.current = true;
          const out = { ...answers };
          const free = items.flatMap((d) => (d.options ?? []).filter((o) => o.free_text).map((o) => [d.item_id, o.label] as const));
          for (const [id, label] of free) {
            if (out[id] === label && selfDescribe.trim()) out[id] = `${label}: ${selfDescribe.trim()}`;
          }
          onSubmit(out);
        }}
      >
        Next
      </Primary>
    </section>
  );
}

export function PilotFeedbackScreen({ onSubmit }: { onSubmit: (answers: Record<string, string>) => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const sent = useRef(false);
  return (
    <section {...testId("screen-pilot-feedback")}>
      {instruments.pilot_feedback.map((p) => (
        <div className="question" key={p.item_id}>
          <p className="question-text">{p.text}</p>
          <textarea
            rows={3}
            value={answers[p.item_id] ?? ""}
            onChange={(e) => setAnswers((a) => ({ ...a, [p.item_id]: e.target.value }))}
            {...testId(`pilot-${p.item_id}`)}
          />
        </div>
      ))}
      <Primary
        id="pilot-next"
        onClick={() => {
          if (sent.current) return;
          sent.current = true;
          onSubmit(answers);
        }}
      >
        Next
      </Primary>
    </section>
  );
}

export function DebriefScreen({
  score,
  toneName,
  flawed,
  withdrawn,
  onWithdraw,
}: {
  score: number;
  toneName: "EI" | "Neutral";
  flawed: readonly { claimId: string; claim: string; flaw: string }[];
  withdrawn: boolean;
  onWithdraw: () => void;
}) {
  const d = instruments.debrief;
  const fill = (text: string) => fillToneChoice(text, toneName);
  const paragraph = (text: string) => {
    const lines = fill(text).split("\n");
    return lines.length > 1 ? (
      <ul key={text} className="plain-list">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    ) : (
      <p key={text}>{lines[0]}</p>
    );
  };
  return (
    <section {...testId("screen-debrief")}>
      <h1>{d.title}</h1>
      <p className="score" {...testId("debrief-score")}>
        {d.score_template.replace("{score}", String(score))}
      </p>
      <h2>{d.about_heading}</h2>
      {d.about_paragraphs.map(paragraph)}
      <h2>{d.flawed_heading}</h2>
      <ul className="flawed" {...testId("debrief-flawed")}>
        {flawed.map((f) => (
          <li key={f.claimId} {...testId(`flawed-${f.claimId}`)}>
            <strong>{f.claim}</strong>
            <br />
            {f.flaw}
          </li>
        ))}
      </ul>
      <h2>{d.answers_heading}</h2>
      {d.answers_paragraphs.map(paragraph)}
      <h2>{d.data_heading}</h2>
      {d.data_paragraphs.map(paragraph)}
      <button type="button" className="withdraw" disabled={withdrawn} onClick={onWithdraw} {...testId("debrief-remove")}>
        {d.remove_button}
      </button>
      {withdrawn && (
        <p className="notice" role="status" {...testId("debrief-removed")}>
          ✓
        </p>
      )}
      {d.closing_paragraphs.map(paragraph)}
    </section>
  );
}
