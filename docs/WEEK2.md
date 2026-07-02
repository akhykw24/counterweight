# Counterweight — Week 2 Playbook: "Prove you can do it without the AI"
### 7 days of features that attack ONE issue: the illusion of competence

> **Format:** same as docs/SPEC.md — each day has a goal, a paste-able prompt for
> Claude Code, a checkpoint, and a commit message. Work top to bottom, commit on green.

---

## The ONE issue

**Students who study with an AI feel prepared — and aren't.** The session feels
productive because the AI supplies the fluency; the student's own recall and
reasoning were never exercised alone. Then the exam (closed-book, AI-free) exposes
the gap. Cognitive science calls the ingredients *fluency illusion*, *illusion of
explanatory depth*, and *cognitive offloading*. Nothing in mainstream AI tutors
even measures this, let alone fixes it.

**Audience:** university students (sharpest for STEM / problem-set courses)
preparing for closed-book exams.

**Positioning in one line:** every AI tutor optimizes what you can produce *with*
it. Counterweight is the only one that measures — and grows — what's left *when it
walks away.*

Week 1 built the measuring instruments (modes, metrics, probes). Week 2 closes the
loop: **prove transfer, measure retention, train resistance.** Every feature below
must serve that sentence; anything that doesn't, cut.

---

## Constraints to respect all week
- Free tiers: Gemini daily quota is real (it died on us in testing). Keep new LLM
  calls to ~1 short CHEAP call per feature-event; batch where possible; test gently.
- No cron/queue infra: compute "due" things on page load, not with schedulers.
- The honesty rule stands: nothing is ever a "critical-thinking/intelligence score."
  New numbers (Solo Score, Retention) are *performance on specific items*, framed
  exactly that way.
- Crisis safety gate stays first in every flow. Checkpoints/probes never fire in
  DISTRESSED mode.

---

## DAY 8 — Solo Checkpoint (the AI steps away) — THE signature feature

**Goal:** end a session → the app generates a 2–3 item "do it alone" check from what
was actually discussed → AI help is locked while you answer → honest per-item
grading → a Solo Score stored next to the Independence Index.

**Paste to Claude Code:**
```
Read docs/WEEK2.md (the one-issue framing) and CLAUDE.md.

1. Prisma: add models Checkpoint (id, sessionId, kind "immediate"|"retention",
   dueAt, startedAt, completedAt, score Float?) and CheckpointItem (id,
   checkpointId, question, expectedGist, userAnswer?, verdict "correct"|"partial"|
   "incorrect"|null, feedback?). Push to both DBs (db:push + db:push:sqlite).
2. lib/prompts/checkpoint.ts: two prompts. GENERATE: given session turns, produce
   2-3 short items that test the concepts the USER worked on (not trivia the AI
   mentioned), each with an expectedGist for grading — strict JSON. GRADE: given
   question+expectedGist+userAnswer, return {verdict, feedback} — feedback names
   what's missing, never flatters, one sentence.
3. lib/checkpoint.ts: generateCheckpoint(sessionId) (CHEAP model, defensive JSON
   via lib/json.ts) and gradeItem(item) (CHEAP). Score = correct=1, partial=0.5,
   incorrect=0, averaged.
4. Routes: POST /api/session/[id]/checkpoint (generate), POST
   /api/checkpoint/[id]/submit (grade all items, compute score, mark completed).
5. UI: "End session" now runs reflect THEN offers the checkpoint in the same modal:
   items as a form, chat input disabled while open ("AI is stepping away — this one
   is yours"), then per-item verdict + feedback + Solo Score. Meters panel shows
   "Solo Score: X" with caption "how you did on these items without help — not a
   measure of you."
Run it: full session -> checkpoint -> grade -> score persisted. Fix until green.
```

**Checkpoint:** a real session produces a relevant solo check; grading is honest;
score persists.
**Commit:** `"day8: solo checkpoint - transfer test after each session"`

---

## DAY 9 — Retention re-checks (the decay curve is the truth)

**Goal:** 1 and 3 days after a passed checkpoint, the same concepts come due again.
"Still got it?" is the honest test of learning vs illusion.

**Paste to Claude Code:**
```
1. When a checkpoint completes with score >= 0.5, create follow-up Checkpoint rows
   (kind "retention") with dueAt = +24h and +72h, items regenerated as VARIANTS of
   the originals (same concept, different surface) via the CHEAP model at due time.
2. app/api/checkpoints/due (GET): list due, uncompleted checkpoints (dueAt <= now).
   No cron — the home page fetches this on load.
3. UI: a "Due for review" strip at the top of the chat page listing due re-checks;
   clicking opens the same checkpoint modal from Day 8. Completing updates score.
4. Retention metric: per session-lineage, latest retention score vs original solo
   score. Show on /trends as a second line ("what stuck").
Run it: fake a due date in the DB (set dueAt to past), confirm the strip appears,
the re-check runs, and the trends line renders.
```

**Checkpoint:** a past-due re-check surfaces on load and completes end-to-end.
**Commit:** `"day9: retention re-checks + decay trend"`

---

## DAY 10 — Attempt Pad + hint ladder (make the gate feel like help)

**Goal:** OUTSOURCING mode stops being a wall and becomes a ramp: a structured
attempt scaffold, then graduated hints with visible cost.

**Paste to Claude Code:**
```
1. When mode=OUTSOURCING, the reply UI renders an Attempt Pad above the input:
   three small fields — "What do I already know", "My first move", "Where I get
   stuck". Submitting sends them as a formatted user message; the classifier will
   see real effort (usually -> STUCK) and help flows.
2. Hint ladder for STUCK mode: lib/prompts/hints.ts — the persona is instructed to
   offer help as escalating levels when asked: L1 concept cue, L2 first step, L3
   worked similar example (never the exact answer). UI shows "Hint 1/2/3" buttons
   that send structured requests.
3. Each hint taken is recorded on the Turn (hintLevel Int?) and gently raises the
   session's offload ratio (weight L3 > L2 > L1) in lib/metrics.ts — visible
   honesty, not punishment. Meters hint text explains it.
Run it: "write my essay" -> pad appears -> filling it flips to real help; hints
escalate and the offload meter moves slightly.
```

**Checkpoint:** the outsourcing flow converts to an attempt without producing the
deliverable; hints escalate with visible cost.
**Commit:** `"day10: attempt pad + hint ladder"`

---

## DAY 11 — Explain-back ("teach it back")

**Goal:** after a substantial explanation, the app sometimes asks the user to say it
back in their own words, and scores fidelity vs parroting.

**Paste to Claude Code:**
```
1. lib/explainback.ts: after an AI reply in STUCK/ENGAGED that judge-worthy
   explains a concept (detect: reply length > threshold AND mode in
   {STUCK,ENGAGED}; max once per 6 turns; never after probes/debriefs/DISTRESSED),
   append a one-line invitation: "Your turn — one or two sentences, how would you
   explain this to a classmate?"
2. Judge upgrade: when the previous AI turn was an explain-back invitation, the
   judge also returns explained_back: "faithful"|"parroted"|"off"|null (extend
   lib/prompts/judge.ts + lib/judge.ts + Turn schema).
3. "faithful" counts as a verification event in lib/metrics.ts (verification rate
   credit); "parroted" gets a gentle nudge from the persona next turn.
Run it: trigger an explanation, answer the explain-back badly and well, confirm
the judge distinguishes and the verification meter reacts.
```

**Checkpoint:** explain-back fires appropriately and faithful/parroted are
distinguished.
**Commit:** `"day11: explain-back verification"`

---

## DAY 12 — Readiness board ("Ready without the AI?")

**Goal:** one screen that answers the only question that matters before an exam.

**Paste to Claude Code:**
```
1. Topic tagging: on session end, one CHEAP call extracts 1-3 short topic tags
   from the session turns; store on Session (topics String — JSON array).
2. app/ready/page.tsx: group sessions by topic. Per topic show: latest Solo Score,
   latest retention score, Independence Index avg, and a single traffic-light
   badge — green only when solo >= 0.7 AND retention exists >= 0.5. Caption:
   "Green = you did this without the AI and it stuck. Behavioural signals, not a
   verdict on you."
3. Empty/loading states; link in the header nav. Add topics + scores to the CSV
   export (new columns).
Run it: two sessions on different topics -> board shows both with honest badges;
export contains the new columns.
```

**Checkpoint:** the board renders real topics with defensible badges; export grows
the new columns.
**Commit:** `"day12: exam-readiness board + topic tagging"`

---

## DAY 13 — Resistance training levels + onboarding for the ONE issue

**Goal:** the probe system becomes a visible, motivating skill ladder, and a
first-run screen tells the user exactly what problem this app solves.

**Paste to Claude Code:**
```
1. Probe levels in lib/probe.ts: L1 subtle nudge, L2 confident claim (current),
   L3 confident claim + plausible fake citation. Session starts at the user's
   level (stored on User/localStorage); surviving a probe promotes, caving demotes.
   Debrief names the level and what to watch for at the next one.
2. "Resistance" chip in the meters panel: current level + probes survived streak.
   Anti-gaming: never reveal when a probe is coming; cap stays 2/session; never in
   DISTRESSED; never during checkpoints.
3. Onboarding modal on first visit (localStorage flag): three short screens — the
   illusion-of-competence problem, how Counterweight works (helps you think, tests
   you alone, checks it stuck), and the honesty promise (signals, not scores).
Run it end-to-end; confirm level changes persist and the debrief reflects them.
```

**Checkpoint:** levels move on survive/cave; onboarding explains the issue in
under 30 seconds of reading.
**Commit:** `"day13: probe levels + onboarding"`

---

## DAY 14 — Pilot, instrument, tighten

**Goal:** evidence the loop works on humans who aren't you.

**Paste to Claude Code:**
```
1. Event log: a lightweight Event model (sessionId, name, meta JSON, at) written
   at: checkpoint_offered/started/completed, recheck_due/completed, hint_taken,
   explainback_answered, probe_fired/survived/caved. Add /api/events summary for
   the admin page (counts per event).
2. Export upgrade: solo score, retention score, probe level, hints taken, topics
   as CSV columns (one row per session stays).
3. Polish pass on the new surfaces only: loading/error/empty states, mobile,
   focus states, reduced-motion. Fix the top 5 roughest edges you find by
   clicking through everything once.
```
**Then (you, not Claude):** run 3–5 friends through one full loop each
(session → checkpoint → next-day re-check). Watch silently, note every confusion,
fix the top three. Re-record the demo: stuck→help, outsource→attempt pad,
probe→debrief, checkpoint→solo score, next-day re-check→readiness board goes green.

**Checkpoint:** a stranger completes the full loop unassisted; export tells the
whole story per session.
**Commit:** `"day14: events + export v2 + pilot fixes"`

---

## Success criteria for the week
1. A user can finish a session and **pass a solo checkpoint** with the AI locked out.
2. The next day, the app **re-tests them** and shows whether it stuck.
3. The readiness board answers "**am I ready without the AI?**" per topic, honestly.
4. The gate converts outsourcers into attempters (attempt pad) instead of refusing them.
5. Nothing anywhere calls a number an intelligence/critical-thinking score.

## Explicitly cut (do NOT build this week)
Auth/accounts, payments, mobile app, streaks-as-gamification beyond the resistance
chip, multi-language, voice, RAG over course materials, email/notifications
(compute-on-load only), fine-tuning. Every one of these dilutes the week.
