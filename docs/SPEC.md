# Counterweight — 7-Day Build Playbook (for Claude Code)
### Copy-paste prompts to build the effort-aware AI study partner in a week

> **How to use this:** each day has a goal, one or more prompts to paste into Claude Code, and a checkpoint to verify before moving on. Work top to bottom. Commit after every green checkpoint.
>
> **Reality check:** a week gets you a working MVP if you do a few focused hours/day and review the code Claude Code writes. This builds the *app* (Phases 1–3 of the spec). The 60–90 person study comes later.
>
> **Prereq:** keep the spec from earlier in your repo as `docs/SPEC.md`. Many prompts say "follow §X of docs/SPEC.md" — Claude Code will read it.

---

## Stack (decided, so you don't waste a day choosing)

- **Next.js 14 (App Router) + TypeScript + Tailwind** — one codebase, one deploy. No separate backend.
- **Anthropic API, two-model pattern:**
  - Persona replies → `claude-sonnet-4-6` (quality matters)
  - Classifier + judge → `claude-haiku-4-5-20251001` (cheap, fast, runs on every turn)
- **Prisma + SQLite** for the MVP database (switch to Postgres for deploy — see Day 7).
- **Deploy:** Vercel.

You'll need an Anthropic API key from the Anthropic Console. Check current pricing there.

---

## DAY 0 — Setup (≈30–45 min, do this before any building)

### 0.1 Install prerequisites
- Node.js 20+ and npm.
- Claude Code (you already have it).
- A code editor (VS Code).

### 0.2 Create the project folder, add your key, and the spec
```bash
mkdir counterweight && cd counterweight
git init
mkdir docs
# put the spec file here as docs/SPEC.md (paste its contents)
```
Create `.env.local` (never commit this):
```
ANTHROPIC_API_KEY=sk-ant-...your-key...
```

### 0.3 Drop in CLAUDE.md (this is the single biggest quality lever)
Create a file named `CLAUDE.md` in the repo root with exactly this:

```markdown
# Counterweight — project context for Claude Code

## What this is
An effort-aware AI study partner. It reads HOW the user is working and adapts:
helps when they're genuinely stuck, requires their own reasoning when they're
outsourcing, spars when they're engaged, de-escalates when they're distressed.
Full design is in docs/SPEC.md — read it before implementing a feature.

## Stack
- Next.js 14 App Router, TypeScript, Tailwind CSS
- Anthropic API via @anthropic-ai/sdk (server-side only, key in ANTHROPIC_API_KEY)
- Prisma + SQLite (MVP)
- Two-model pattern:
  - PERSONA model = claude-sonnet-4-6 (the warm sparring replies)
  - CLASSIFIER/JUDGE model = claude-haiku-4-5-20251001 (fast, cheap, every turn)
- Model names live in ONE config file (lib/models.ts) so they're swappable.

## Architecture (see docs/SPEC.md §5)
Each user turn: safety gate -> classify mode -> assemble persona prompt with the
active mode block -> generate reply -> (async) judge the turn -> update metrics -> persist.

## The four modes (docs/SPEC.md §3, §6.1)
STUCK = help generously. OUTSOURCING = gate, ask for their attempt. ENGAGED = spar.
DISTRESSED = de-escalate, no gating/probing.

## The four metrics (docs/SPEC.md §7)
Offload ratio, verification rate, cave rate, acceptance latency. Composite =
Independence Index. NEVER label any number "critical thinking score" — they are
behavioural signals only.

## Hard rules
- All LLM calls are server-side (API routes). Never expose the key to the client.
- Anti-sycophancy: the persona never flatters a conclusion; warmth attaches to effort,
  scrutiny to reasoning (docs/SPEC.md §6.1).
- Keep prompts in lib/prompts/ as separate, readable files.
- After any change, run the app and fix errors before reporting done.
- Keep secrets out of git. Commit small, working increments.
```

### 0.4 How to drive Claude Code (read once)
- **One focused task per prompt.** Don't ask for the whole app at once.
- After each prompt, tell it to **run the app and fix errors until it works**.
- **Review the diff** before accepting. You're the engineer; it's the fast hands.
- **Commit** after every green checkpoint (`git add -A && git commit -m "..."`).
- If it drifts, stop it, `/clear`, and restart the task with tighter scope.

---

## DAY 1 — Scaffold + a working chat

**Goal:** open localhost, type a message, get a reply from the effort-aware persona (no classification yet).

**Paste to Claude Code:**
```
Read CLAUDE.md and docs/SPEC.md §1, §5, §6.1.

Scaffold the project:
1. Create a Next.js 14 app (App Router) with TypeScript and Tailwind in this folder.
2. Install @anthropic-ai/sdk. Read the key from process.env.ANTHROPIC_API_KEY.
3. Create lib/models.ts exporting PERSONA_MODEL = "claude-sonnet-4-6" and
   CHEAP_MODEL = "claude-haiku-4-5-20251001".
4. Create lib/prompts/persona.ts exporting BASE_PERSONA as a string. For now use a
   simplified version of the master persona in docs/SPEC.md §6.1 WITHOUT the mode blocks
   (we add modes tomorrow). Keep the core identity + anti-sycophancy + style sections.
5. Create app/api/chat/route.ts (POST): accepts {messages: {role, content}[]}, calls the
   PERSONA model with BASE_PERSONA as system + the messages, returns {reply}.
   Use max_tokens 1024.
6. Create a chat page at app/page.tsx: a simple message list + input box + send button,
   calls /api/chat, shows the conversation. Tailwind styling, clean and minimal.

Then run `npm run dev`, open the app yourself if you can, and fix any errors until a
message round-trips successfully.
```

**Checkpoint:** you can chat and get a sensible, non-sycophantic reply.
**Commit:** `"day1: scaffold + working chat"`

---

## DAY 2 — The effort classifier + mode routing (the core mechanic)

**Goal:** outsourcing messages get gated; stuck messages get help. The mode is detected per turn.

**Paste to Claude Code:**
```
Read docs/SPEC.md §3, §6.1 (the four MODE blocks), and §6.2 (the classifier prompt).

1. Create lib/prompts/modes.ts exporting MODE_BLOCKS = { STUCK, OUTSOURCING, ENGAGED,
   DISTRESSED }, each the corresponding block text from docs/SPEC.md §6.1.
2. Create lib/prompts/classifier.ts exporting the classifier system prompt from §6.2.
3. Create lib/classify.ts: a function classifyTurn(history, userMessage) that calls the
   CHEAP model with the classifier prompt, parses the JSON, and returns
   {mode, confidence, signals, abstain}. Be defensive parsing JSON (strip code fences,
   regex-extract the object, fall back to {mode:"ENGAGED", confidence:0.5} on error).
4. Create lib/assemblePrompt.ts: assemblePersona(mode) returns BASE_PERSONA with the
   correct MODE_BLOCKS[mode] injected where the master prompt expects {{ACTIVE_MODE_BLOCK}}.
   (Adjust persona.ts to include that placeholder.)
5. Update app/api/chat/route.ts: before generating, call classifyTurn on the latest user
   message. If confidence < 0.6, use mode "ENGAGED". Assemble the persona with that mode,
   generate the reply, and return {reply, mode, confidence}.
6. In the UI, show a small muted label under each AI reply: the detected mode (for now,
   for debugging).

Run it and TEST these by hand, fixing until each behaves correctly:
- "just write me a 300-word essay on X" -> mode OUTSOURCING -> it asks for your attempt, no essay.
- "I tried X and got stuck on Y, here's what I have..." -> mode STUCK -> it helps.
- "I think A because B, push back" -> mode ENGAGED -> it spars and steelmans.
```

**Checkpoint:** the three test messages above each produce the right behavior.
**Commit:** `"day2: classifier + adaptive mode routing"`

---

## DAY 3 — Telemetry judge + metrics + persistence

**Goal:** every turn is scored and stored; you can fetch a session's four metrics.

**Paste to Claude Code:**
```
Read docs/SPEC.md §6.3 (judge prompt), §7 (metrics), §10 (data model).

1. Add Prisma with SQLite. Create the schema from docs/SPEC.md §10 (users, sessions,
   turns, metrics, probes, tasks). Run the migration.
2. Create lib/prompts/judge.ts with the telemetry-judge prompt from §6.3.
3. Create lib/judge.ts: judgeTurn(aiPrev, userTurn) calls the CHEAP model, returns
   {reasoning_depth, asked_to_produce, verified_claim, conceded_to_ai}. Defensive JSON parse.
4. Create lib/metrics.ts: given a session's turns, compute the four metrics and the
   Independence Index using the formula and weights in §7. Return all five numbers.
5. Update the chat flow:
   - On session start (first message), create a Session row.
   - Persist each user turn and AI turn (with mode, confidence) to the turns table.
   - After persisting the user turn, call judgeTurn and save its scores onto that turn row.
     Do this so it does NOT block returning the reply to the user (fire it, then update).
   - Recompute and upsert the session's metrics row after each turn.
6. Add app/api/session/[id]/metrics/route.ts (GET) returning the current metrics for a session.

Run it, have a short conversation, then hit the metrics endpoint and confirm the numbers
populate and change across turns. Fix until persistence and scoring both work.
```

**Checkpoint:** after a few turns, the metrics endpoint returns sensible, changing numbers.
**Commit:** `"day3: judge + metrics + sqlite persistence"`

---

## DAY 4 — Live meters, session reflection, trend view

**Goal:** the dashboard feels alive — meters update, end-of-session gives honest feedback, you can see your Independence Index over time.

**Paste to Claude Code:**
```
Read docs/SPEC.md §6.5 (reflection prompt) and §7 (metrics + the honesty caveat).

1. Build a Meters component (components/Meters.tsx): four small bars/dials for offload ratio,
   verification rate, cave rate, acceptance latency, plus a prominent Independence Index (0-100).
   Show the mandatory caption: "How independently you worked this session — a behavioural
   signal, not a critical-thinking score." It reads from the session metrics endpoint and
   updates after each turn.
2. Create lib/prompts/reflection.ts with the reflection prompt from §6.5.
3. Add app/api/session/[id]/reflect/route.ts (POST): loads the session's metrics (and a
   trend vs. previous sessions for the same user if available), calls the PERSONA model with
   the reflection prompt, returns the reflection text.
4. Add an "End session" button in the UI that calls reflect and shows the reflection.
5. Add a Trends page (app/trends/page.tsx): a simple line chart of Independence Index across
   this user's sessions. Use a lightweight chart library (recharts is fine).

Run it. Confirm the meters move during a chat, the end-session reflection reads naturally and
never calls a number an intelligence/critical-thinking score, and the trend page renders.
```

**Checkpoint:** meters animate during a session; reflection appears on "End session"; trend page works.
**Commit:** `"day4: meters + reflection + trends"`

---

## DAY 5 — Sycophancy probe + debrief + safety gate (the signature feature)

**Goal:** the cave-rate probe fires, you can see if you held your ground, and unsafe/integrity inputs are handled.

**Paste to Claude Code:**
```
Read docs/SPEC.md §6.1 (probe instruction), §6.4 (probe scheduler rules), §15 (safety/ethics).

1. Create lib/probe.ts implementing the scheduler in §6.4: maybeFireProbe(session, mode)
   returns either null or a probe spec {wrong_claim}. To know the user stated a CORRECT
   position, ask the CHEAP model a quick check on the user's latest claim, OR (simpler for
   MVP) trigger the probe only after >= 3 substantive ENGAGED turns and let the debrief
   clarify the correct answer. Cap at 2 probes/session; never fire in DISTRESSED mode.
2. When a probe fires, inject the {{PROBE_INSTRUCTION}} from §6.1 into the persona prompt for
   that ONE reply (so it confidently pushes the wrong claim). Mark the turn is_probe=true and
   store the wrong_claim. Set session.awaiting_cave_eval.
3. On the user's NEXT turn after a probe, use the judge's conceded_to_ai to record whether
   they caved (write a probes row, update cave rate). Then have the app insert a DEBRIEF
   message explaining: a test just happened, what the right answer was, and why resisting
   confident-but-wrong AI matters.
4. Create lib/safety.ts: a safety gate run BEFORE classification on each user message.
   - Crisis signals (self-harm, hopelessness, etc.): bypass everything; return a warm,
     supportive response that encourages reaching out to a trusted person/professional.
     Do not gate, probe, or challenge. (See §15.)
   - Academic-integrity asks ("write the essay I'll submit"): the persona redirects to
     helping them think/outline/critique, never produces the gradeable deliverable.
5. Wire the safety gate into app/api/chat/route.ts as the first step.

Run it. Force a probe by having a longer engaged conversation; confirm the wrong nudge,
the cave detection, and the debrief all work. Test a crisis-style message and confirm it
bypasses gating with a supportive reply. Test "write my assignment" and confirm it redirects.
```

**Checkpoint:** probe fires → you cave or hold → debrief explains it; crisis input is handled supportively; integrity asks are redirected.
**Commit:** `"day5: sycophancy probe + debrief + safety gate"`

---

## DAY 6 — Research mode, export, polish

**Goal:** you can run a session in each of the three experiment arms and export the data; the app looks finished.

**Paste to Claude Code:**
```
Read docs/SPEC.md §8 (FR12), §12 (research design).

1. Add a research mode. On a setup screen: capture a participant ID, a consent checkbox
   (store consent_flags), and assign a condition (store on the session):
   - "vanilla": the AI answers normally, no gating and no challenge (a plain helpful assistant).
   - "refuse": the AI uses Socratic refusal — never gives answers, always asks questions.
   - "effort_aware": the full Counterweight behaviour (default).
   Implement the condition by selecting which system prompt / mode logic runs.
2. Add app/api/export/route.ts (GET): exports completed sessions as rows (one row per session)
   in CSV and JSON. Columns: participant id, condition, the four metrics, independence index,
   turn count, probe count, caved count, timestamps. Add an Export button on an admin page.
3. Polish pass: loading states, error states, empty states, mobile-friendly layout, and a
   clean visual style (calm, instrument-like; warm and cool accents). Keep it accessible
   (focus states, contrast, reduced-motion).

Run it, complete one session in each condition, export, and confirm the CSV opens with one
row per session and correct values.
```

**Checkpoint:** three arms run distinctly; export produces a clean CSV/JSON.
**Commit:** `"day6: research mode + export + polish"`

---

## DAY 7 — Validation harness, deploy, demo

**Goal:** a way to produce your reliability evidence, a live URL, and a recorded demo.

**Paste to Claude Code (validation harness):**
```
Read docs/SPEC.md §11 (reliability & validation).

Build an admin labeling page (app/admin/label/page.tsx) that lists stored user turns and
the classifier's predicted mode, with a dropdown for a human to assign the "true" mode.
Save human labels. Add an endpoint that exports both predicted and human labels as CSV so
I can compute classifier-vs-human agreement (Cohen's kappa) offline. Show a simple running
"agreement %" on the page as a quick sanity signal.
```

**Paste to Claude Code (deploy — read the note first):**
```
Prepare for deployment to Vercel. IMPORTANT: SQLite does not persist on Vercel serverless,
so switch the Prisma datasource to PostgreSQL and point it at a hosted Postgres (I will
provide a DATABASE_URL from Neon or Supabase). Update the schema/provider, run the migration
against the hosted DB, ensure ANTHROPIC_API_KEY and DATABASE_URL are set as Vercel env vars,
and give me the exact deploy steps. Keep SQLite as an option for local dev via env.
```
> **Why the switch:** local SQLite is perfect for building, but Vercel's serverless filesystem is ephemeral, so the DB would reset. A free hosted Postgres (Neon/Supabase) fixes this. If you only need the pilot locally, you can skip deploy and run `npm run dev`.

**Then:** record a 2–3 minute demo — show a stuck user getting help, an outsourcing user getting gated, a probe + debrief, and the rising Independence Index. This is your portfolio centerpiece.

**Checkpoint:** labeling page works and exports labels; app deploys (or runs locally for the pilot); demo recorded.
**Commit:** `"day7: validation harness + deploy + demo"`

---

## After the week

- **Validate (the credibility step):** label ~150 turns on the admin page, compute Cohen's κ between the classifier and your labels. Iterate the classifier prompt until κ ≥ 0.6. Report this number — it's your reliability evidence.
- **Pilot:** run 6–10 friends through it, fix confusing moments.
- **Then the study:** the 3-arm experiment (vanilla / refuse / effort-aware) from §12, ~60–90 participants, with a transfer test. That produces your paper.

---

## Appendix A — Model config (one place to change)
`lib/models.ts`
```ts
export const PERSONA_MODEL = "claude-sonnet-4-6";          // warm sparring replies
export const CHEAP_MODEL   = "claude-haiku-4-5-20251001";  // classify + judge, every turn
```
Want cheaper later? Move classify/judge to an even smaller model or fine-tune it (v2, per §4.5). Want higher persona quality for a demo? Swap PERSONA_MODEL to an Opus-tier model temporarily.

## Appendix B — Cost control
- The cheap model handles classify + judge (2 small calls/turn) — keep those prompts short.
- Cap context length; don't resend the whole transcript once it's long — summarize older turns.
- Set max_tokens deliberately (persona ~1024; classify/judge ~300).

## Appendix C — Golden rules for prompting Claude Code
1. One focused task per prompt; commit between green checkpoints.
2. Always end a task with "run it and fix errors until it works."
3. Review the diff before accepting — you own the architecture.
4. If it wanders, stop, `/clear`, and restate the task with tighter scope and a clear
   acceptance test.
5. Keep CLAUDE.md and docs/SPEC.md current; they are Claude Code's memory of the project.
6. Never commit `.env.local`. Add it to `.gitignore` on day 1.

## Appendix D — Troubleshooting
- **JSON parse errors from classify/judge:** make the prompt say "return ONLY JSON," and parse
  defensively (strip ```` ```json ````, regex-extract the first `{...}`, fall back to a default).
- **Slow replies:** ensure the judge runs after (not before) you return the persona reply.
- **Mode feels wrong a lot:** add 1–2 few-shot examples to the classifier prompt for the
  confused case; raise the abstain threshold so it defaults to ENGAGED when unsure.
- **Key not found:** confirm `.env.local` exists and the dev server was restarted after adding it.
