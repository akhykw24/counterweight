# Counterweight — project context for Claude Code

## What this is
An effort-aware AI study partner. It reads HOW the user is working and adapts:
helps when they're genuinely stuck, requires their own reasoning when they're
outsourcing, spars when they're engaged, de-escalates when they're distressed.
Full design is in docs/SPEC.md — read it before implementing a feature.

## Stack
- Next.js 14 App Router, TypeScript, Tailwind CSS
- AI via the OpenAI SDK (`openai` npm package) pointed at free, OpenAI-compatible
  providers (server-side only). Keys: GEMINI_API_KEY, GROQ_API_KEY.
- Prisma + SQLite (MVP)
- Two-model pattern (free tiers, no credit card):
  - PERSONA model = Gemini "gemini-2.5-flash" via base URL
    https://generativelanguage.googleapis.com/v1beta/openai/  (the warm sparring replies)
  - CLASSIFIER/JUDGE model = Groq "llama-3.3-70b-versatile" via base URL
    https://api.groq.com/openai/v1  (fast, free, every turn)
- All model names, base URLs, and which key each uses live in ONE config file
  (lib/models.ts) so they're swappable in one place.

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