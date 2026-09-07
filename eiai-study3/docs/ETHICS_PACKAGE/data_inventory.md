# Data inventory

What this study stores, what it does not, where it goes, and whether anyone
could be identified from it. Every statement below was checked against the
source rather than recalled, and names the file it was checked in.

---

## 1. The short answers

| Question | Answer |
|---|---|
| IP address? | **Not stored by the study.** Held temporarily by two infrastructure providers — see §5. |
| User agent / browser? | **No.** |
| Device or screen fingerprint? | **No.** Viewport width and height in CSS pixels are recorded once, at session start. |
| Browser language, time zone, locale? | **No.** |
| Geolocation? | **No.** Never requested; the permission prompt never appears. |
| Cookies? | **None.** No cookie is set by the study. |
| Exact timestamps? | **Yes** — millisecond precision, twice per event: the browser's clock and the server's arrival clock. See §3. |
| Name, email, phone, date of birth? | **Never asked.** No login, no account, no contact field. |
| Age? | As a **band** (18–24 / 25–34 / 35 or over). Never a date or an exact number. |
| Free text? | **Yes**, at two points. The only place a participant could type something identifying about themselves. See §6. |
| Any identifier linkable to a person? | **No.** The only identifier is a random UUID generated in the browser. See §2. |

---

## 2. How a participant is identified

There is exactly one identifier, and it identifies a *session*, not a person.

`apps/study/src/telemetry.ts` line 50:

```ts
const sessionId = existing?.sessionId ?? crypto.randomUUID();
```

`crypto.randomUUID()` is the browser's cryptographic random generator. The value
is a version-4 UUID: 122 random bits, derived from nothing about the device, the
network, the browser, or the person. Two sessions by the same person on the same
computer produce two unrelated identifiers.

Each individual event additionally carries its own random `event_id`
(`packages/telemetry/src/recorder.ts`), used only so that a message delivered
twice is stored once.

**There is no key of any kind that maps a session to a human being.** No such
key is created, so none can be lost, subpoenaed, or leaked.

## 3. Exactly what is stored, field by field

The ingest service copies six fields and nothing else. From
`services/ingest/src/handler.ts`:

```ts
function toRow(event: StudyEvent): EventRow {
  const { event_id, session_id, seq, client_ts, type, payload } = event;
  return { event_id, session_id, seq, client_ts, type, payload };
}
```

It never reads the HTTP request headers, so the IP address and user agent
available to it are discarded rather than recorded. The database table
(`services/ingest/sql/001_events.sql`) has seven columns and no others:

| Column | What it is |
|---|---|
| `event_id` | random UUID, deduplication key |
| `session_id` | random UUID, the session |
| `seq` | position of the event within the session |
| `client_ts` | timestamp from the participant's own browser clock |
| `type` | which of the 19 event kinds this is |
| `payload` | the event's data, listed below |
| `received_at` | server clock at the moment of arrival (`default now()`) |

### Timestamps: yes, exact, and there are two of them

`client_ts` is the browser's wall clock at the moment of the action, to the
millisecond. `received_at` is the server's clock when the batch arrived. Both
are exact; neither is rounded.

The study needs precise *intervals* — how long someone looked at an answer
before revising an estimate is a dependent measure — and those are computed from
the differences. The absolute wall-clock time is a by-product of storing the
instants. If the committee prefers, `client_ts` could be rounded to the minute
without harming the analysis, because every interval measure is already stored
separately as a duration in milliseconds (`ms_since_reveal`,
`ms_since_present`, `away_duration_ms`).

### Every payload, by event type

Generated from the schemas (`docs/DATA_DICTIONARY.md`, itself generated from
`packages/schema/src` and checked in CI). No field here holds a name, a contact
detail, or an exact age.

| Event | Payload fields |
|---|---|
| `SESSION_STARTED` | app version, stimulus manifest hash, viewport width and height, whether this is a resume, whether this browser already completed a session |
| `SCREENED_OUT` | reason (`age` / `language` / `prior_training`) |
| `CONSENT_GIVEN` | *(nothing — the fact and its timestamp are the record)* |
| `ALLOCATED` | condition, stratum, self-reported CEFR level, position in the randomisation sequence |
| `ITEM_PRESENTED` | item id, position |
| `ESTIMATE_CHANGED` | item id, phase, value, ms since the item appeared |
| `CONFIDENCE_SET` | item id, phase, value |
| `RESPONSE_REVEALED` | item id, which frozen text was shown, register |
| `RESPONSE_SCROLLED` | item id, deepest scroll fraction reached |
| `FOLLOWUP_SELECTED` | item id, which follow-up, ms since the answer appeared |
| `VERIFY_CLICKED` | item id, ms since the answer appeared |
| `WINDOW_BLURRED` | item id, ms since session start |
| `WINDOW_FOCUSED` | item id, ms since session start, how long they were away |
| `ESTIMATE_FINALIZED` | item id, value, how many times they revised, ms since the answer appeared |
| `ARGUMENT_RATED` | item id, perceived strength 1–7 |
| `QUESTIONNAIRE_ANSWERED` | scale, question id, value |
| `FUNNEL_RESPONSE` | stage, **verbatim free text** |
| `SESSION_COMPLETED` | total duration |
| `SESSION_WITHDRAWN` | reason (always null), which screen they left from |

### Tab switching is recorded, and is disclosed

`WINDOW_BLURRED` and `WINDOW_FOCUSED` record when the participant leaves the tab
and for how long, as an indication of whether they looked something up. This is
behavioural monitoring, so it is named explicitly in the consent form rather
than covered by a general phrase: *"…and when you switch away from this tab."*

## 4. The questions that ask about the participant

Five, all optional in the sense that none asks for anything identifying
(`packages/schema/src/questionnaire.ts`):

| Question | Form of answer |
|---|---|
| Which age group are you in? | band: 18–24 / 25–34 / 35 or over |
| How do you describe your gender? | choice, including *prefer not to say* |
| What is your primary language? | choice |
| How often do you use AI assistants? | five-point scale |
| How would you rate your prior knowledge of marine biology? | seven-point scale |

Plus, on the eligibility screen before consent: age band, self-rated English
reading level (CEFR), whether their study or work is mainly in English, and
whether they have formal training in marine biology or oceanography.

## 5. Where the data physically are

**On the participant's own device, during the session.**
`localStorage` holds three keys (`packages/telemetry/src/resume.ts`):
`eiai.session_id`, `eiai.session_snapshot` (where they had got to),
`eiai.session_completed`. An IndexedDB database, `eiai-telemetry`, holds events
that have not yet been delivered. Delivered events are removed from it. The
participant can clear all of this by clearing site data in their browser.

**On the server.** One PostgreSQL table, `public.events`, in a Supabase project
hosted in the region chosen at setup. The table is append-only, enforced three
ways: the service has no update or delete code path; those rights are revoked
from every client role; and a database trigger raises an exception on any UPDATE
or DELETE regardless of who attempts it.

**Who can read it.** Only the researcher, through the Supabase project. The
browser never talks to the database: row-level security denies the anonymous
role everything, and the writing credential lives only in a server-side
environment variable and never reaches the participant's browser (verified: the
built JavaScript bundle contains no credential).

### The honest caveat about infrastructure

The study is served by **Vercel** and the database is hosted by **Supabase**.
Both are ordinary commercial providers, and like any web host they process the
connection itself: their access and security logs contain IP addresses and user
agents for a limited retention period set by them, not by this study. The study
neither reads nor stores those values, and they are not joined to any session.
This is the same exposure as visiting any website, and it is stated here because
"we do not collect IP addresses" would otherwise be a half-truth.

## 6. Could a participant be re-identified?

**From the stored data alone: no.** There is no name, contact detail, account,
cookie, device fingerprint, or exact age, and the session identifier is random.
Nothing in the table can be joined to a person.

Two honest qualifications:

**The free-text answers.** Two of the three closing questions accept free text
("What do you think this study was about?", "Did anything seem unusual?"). A
participant could in principle type something self-identifying. The text is
stored verbatim, because the point of the probe is to see what they actually
suspected. Before publication these responses are read and quoted only in
paraphrase or not at all.

**Combinations, in a small sample.** With around 126 participants, the
combination of age band, gender, primary language and English level narrows the
field but does not name anyone. No demographic cross-tabulation is published;
only totals and averages by experimental condition.

**Withdrawal, and what it does.** The debriefing screen offers a button that
removes the participant's answers from the study. The event rows themselves are
not deleted — the table is append-only, which is what lets every published
number be traced to what was recorded — but the session is marked withdrawn and
removed before any statistic is computed, including the sensitivity analyses
that otherwise include excluded participants
(`pipeline/exclusions.py`, `remove_withdrawn`). Nothing derived from that
session is counted, analysed, or reported. The consent form describes it in
exactly those terms rather than promising erasure the design cannot perform.

## 7. What the study deliberately does not do

- No account, no login, no password.
- No cookies, no advertising or analytics scripts of any kind, no third-party
  trackers. The page loads its own code and makes exactly one kind of network
  request: its own `/api/events` on the same origin. (The built bundle does
  contain a dozen external web addresses — NOAA, the Natural History Museum,
  Smithsonian Ocean and similar. Those are the citations shown to the
  participant on the debriefing screen. They are text; nothing is fetched from
  them, and no request is made to any of them.)
- No contact with participants after the session, because there is no way to
  contact them.
- No sharing of raw data with anyone; publication is of totals and averages.
