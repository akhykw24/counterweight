# Participant-facing texts: informed consent and debriefing

**Study.** How people use answers from an AI assistant: an online judgement task.

**Researcher.** Prokopenko Darya Artyomovna, 12th grade student,
Nazarbayev Intellectual School of Science and Mathematics, Kokshetau, Kazakhstan.

**Supervisor.** Rakhimbekova Saya Dissembeyevna, teacher,
Nazarbayev Intellectual School of Science and Mathematics, Kokshetau, Kazakhstan.

**Participants.** Adults, 18 or over. Recruited online, unpaid.
Target 126, hard cap 160.

**Session length.** About 15 minutes: 12 estimation questions, a short
questionnaire, three open questions, and the debriefing screen.

---

> **Two items need the researcher's input before this goes to the committee.**
>
> 1. The supervisor's email address. The consent screen currently reads
>    "[supervisor email — to be added]" and must not be shown to a participant
>    in that state.
> 2. A retention period, if the committee requires a specific one. The text
>    below states retention in terms of purpose rather than a number of years,
>    because no period has been set. Both wordings are acceptable to most
>    committees; a number can be substituted if asked for.
>
> The study cannot be launched while the first is unresolved: the launch gate
> (`launch_ready` in the stimulus manifest) is closed and opens only by an
> explicit command, so an unfinished consent form cannot reach a participant by
> accident.

---

## 1. What the participant sees, and when

| Order | Screen | Purpose |
|---|---|---|
| 1 | Eligibility | Age band, English reading level, whether their study or work is in English, whether they have formal training in marine biology or oceanography. Anyone under 18, below CEFR B1, or with formal training is turned away here — **before** consent, so no data are collected from them beyond the fact that they were screened out. |
| 2 | **Informed consent** | The text in section 2. Cannot be accepted without ticking "I am 18 years old or older". |
| 3 | 12 questions | For each: an estimate, the assistant's answer, a revised estimate, and a rating of how convincing the reason was. |
| 4 | Questionnaire | How the assistant came across, and background questions. |
| 5 | Three open questions | What the participant thought the study was about. |
| 6 | **Debriefing** | The text in section 3, including the button that deletes their answers. |

## 2. Informed consent (exact text)

> ### Informed consent
>
> This study looks at how people use answers from an AI assistant. It is a
> school research project by **Prokopenko Darya Artyomovna**, a 12th grade
> student at Nazarbayev Intellectual School of Science and Mathematics in
> Kokshetau, Kazakhstan. Her supervisor is Rakhimbekova Saya Dissembeyevna, a
> teacher at the same school.
>
> You will answer **12 questions** about the deep sea. For each one you give an
> estimate, read an assistant's answer, and then give your estimate again. The
> whole session takes about **15 minutes**.
>
> **We are not telling you everything about the study yet.** Some details are
> held back on purpose, because knowing them would change how you read the
> answers. Nothing here is dangerous or unpleasant. Right after you finish, we
> explain the full purpose on a debriefing screen, and you can then decide
> whether to let us keep your answers.
>
> Your answers are **anonymous**. We do not ask for your name, your email, your
> exact age, or anything else that identifies you. Your session is stored under
> a random code. We record what you type, how long you take, how far you scroll
> through each answer, and when you switch away from this tab.
>
> We publish only totals and averages across all participants, in a school
> research report and any paper that follows from it. No single person can be
> recognised in what we publish, because nothing stored can be traced back to a
> person. The anonymous data are kept for as long as the project and its results
> need to be checked, and then no longer serve any purpose.
>
> Taking part is **voluntary**. You can close the tab at any moment and there
> are **no consequences**: nobody is told, and nothing is lost to you. On the
> debriefing screen there is also a button that deletes your answers from the
> study.
>
> Questions or concerns, now or later: dashaprokop24@gmail.com
> (Prokopenko Darya Artyomovna), or the supervisor Rakhimbekova Saya
> Dissembeyevna at [supervisor email — to be added].
>
> ☐ I am 18 years old or older.
>
> **[ I have read this, and I agree to take part ]**

The button is disabled until the box is ticked.

## 3. Debriefing (exact text)

Shown to every participant who reaches the end, before anything is treated as
final.

> ### What this study was really about
>
> You were told this study was about how people interact with AI assistants.
> That was true, but incomplete. Some of the assistant's answers were
> deliberately wrong, and we did not tell you in advance because knowing would
> have changed how you read them.
>
> ### What we did not tell you before
>
> There were two versions of the assistant, and you were placed in one of them
> at random. One version spoke in a warm, personal way and changed its tone
> depending on how confident you said you were. The other spoke in a plain,
> neutral way. The facts and the numbers were exactly the same in both versions
> — only the manner of speaking was different.
>
> Something else was arranged on purpose: for some questions the assistant gave
> a strong reason for its answer, and for others the reason was deliberately
> weak. Which questions got which was fixed in advance, the same for everyone.
>
> We are studying how the manner of speaking and the strength of a reason work
> together when a person decides how much to trust an answer. If we had told you
> this at the start, you would have watched for it, and we would have measured
> your attention to the study instead of your ordinary way of reading an answer.
> That is why the description at the beginning was incomplete. We are not saying
> which result we expected, because you may meet other people who have not taken
> part yet.
>
> ### The answers that were wrong
>
> *(Four items are listed here, each with the question, what the assistant said,
> the correct value, and the source. The list is generated from the item bank,
> so it cannot disagree with the study materials.)*
>
> | Question | What the assistant said | Correct value |
> |---|---|---|
> | Longest recorded sperm whale dive | 35 minutes | about 90 minutes |
> | Maximum black smoker vent fluid temperature | 150 °C | about 400 °C |
> | Maximum lifespan of the tubeworm *Lamellibrachia luymesi* | 40 years | about 250 years |
> | Deepest confirmed fish observation | 3,900 m | about 8,336 m |
>
> Each row also shows the published source the correct value comes from.
>
> ### You can still take your answers out
>
> Now that you know what the study was really about, you may decide you would
> rather not take part after all. The button below deletes your answers from the
> study: nothing you did will be counted, analysed, or reported. You do not have
> to give a reason, and nobody will ask. This costs you nothing.
>
> **[ Delete my answers from the study ]**  **[ Finish ]**

## 4. Notes for the committee

**Deception is limited to incomplete disclosure plus four wrong values.**
No participant is deceived about risk, effort, or what is recorded. The four
wrong answers are corrected on screen with their sources, and the four items
are ordinary factual questions about the deep sea with no bearing on anyone's
health, safety, or self-image.

**"Deletes your answers" describes what happens, precisely.** The event log is
append-only for research-integrity reasons: rows are never edited or removed, so
that every published number can be traced back to what was actually recorded.
When a participant presses the button, their session is marked withdrawn and is
removed from every analysis before any statistic is computed — including the
"without exclusions" sensitivity analysis. Nothing derived from their session is
counted, analysed, or reported. The wording avoids promising physical erasure,
which this design deliberately cannot perform.

**Anonymity is structural, not a policy.** The application never asks for a
name, an email, or a date of birth, and there is no login. A session is a random
code generated in the participant's browser. Age is collected as a band
(18–24 / 25–34 / 35 or over), never as a date. This is also why withdrawal has
to be offered *before* the participant closes the final screen: afterwards
nothing in the data can identify which session was theirs.

**Screening happens before consent.** Anyone under 18 is turned away on the
first screen and is never shown the consent form. The affirmation on the consent
screen is a second, recorded check rather than the only one.

**Tab-switching is disclosed by name.** The application records when the
participant switches away from the tab, as a measure of whether they looked
something up. This is behavioural monitoring, so it is named explicitly in the
consent text rather than covered by a general phrase.

**The texts here are the texts that run.** An automated test renders the actual
consent and debriefing screens and fails if any paragraph in this document has
drifted from what the application shows, so a committee-approved text cannot
diverge from what participants read.
