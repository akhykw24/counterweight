import type { Language } from "@eiai/schema";

/**
 * i18n scaffold, English first (STUDY3_SPEC_v3.md section 10, day 5).
 *
 * Russian and Kazakh are deliberately EMPTY, not machine-filled. Section 11
 * requires cultural adaptation with back-translation and native-speaker
 * verification; dropping in a machine translation would produce something that
 * looks finished and silently fails the manipulation check in two of three
 * language groups.
 *
 * `t()` therefore falls back to English and reports the gap, so a missing
 * string is visible during the pilot rather than invisible in the data.
 */

const en = {
  "app.title": "Deep-sea estimation study",
  "app.withdraw": "Stop and leave",
  "app.withdraw.confirm": "Yes, stop now",
  "app.withdraw.cancel": "Keep going",

  "eligibility.title": "Before we start",
  "eligibility.language": "Which language would you like to use?",
  "eligibility.age": "Which age group are you in?",
  "eligibility.training": "Have you had formal training in marine biology or oceanography?",
  "common.yes": "Yes",
  "common.no": "No",
  "common.continue": "Continue",

  "item.progress": "Question {position} of {total}",
  "item.unit": "Answer in {unit}.",
  "item.estimate": "Your estimate",
  "item.confidence": "How confident are you? (0-100)",
  "item.finalEstimate": "Your final estimate",
  "item.finalConfidence": "How confident are you now? (0-100)",
  "item.submitInitial": "Submit and see the assistant's answer",
  "item.next": "Next question",
  "item.finish": "Finish the questions",
  "item.sliderHint":
    "Move the slider to set your answer. If the current position is right, click it to confirm.",

  "followup.prompt": "Would you like to ask anything about that?",
  "followup.measurement": "Can you explain how that's measured?",
  "followup.certainty": "How certain are you about that?",
  "followup.challenge": "I think that might be wrong.",
  "verify.button": "Check this claim",
  "verify.noted": "Noted.",

  "questionnaire.title": "A few questions about the assistant",
  "questionnaire.warmth": "How did the assistant come across?",
  "questionnaire.competence": "How would you rate the assistant's knowledge?",
  "questionnaire.trust": "Would you rely on this assistant?",
  "questionnaire.covariates": "A little about you",
  "questionnaire.scaleLow": "Strongly disagree",
  "questionnaire.scaleHigh": "Strongly agree",
  "questionnaire.incomplete": "Please answer every question before continuing.",

  "funnel.purpose": "What do you think this study was about?",
  "funnel.anomaly": "Did anything about the assistant's answers seem unusual?",
  "funnel.belief": "Did you believe all of the assistant's answers were accurate?",
  "funnel.unsure": "Unsure",
  "funnel.freeTextHint": "There is no right answer here. Whatever you thought is useful.",

  "debrief.title": "What this study was really about",
  "debrief.body":
    "You were told this study was about how people interact with AI assistants. That was true, but incomplete. Some of the assistant's answers were deliberately wrong, and we did not tell you in advance because knowing would have changed how you read them.",
  "debrief.designTitle": "What we did not tell you before",
  "debrief.designBody":
    "There were two versions of the assistant, and you were placed in one of them at random. One version spoke in a warm, personal way and changed its tone depending on how confident you said you were. The other spoke in a plain, neutral way. The facts and the numbers were exactly the same in both versions — only the manner of speaking was different.\n\nSomething else was arranged on purpose: for some questions the assistant gave a strong reason for its answer, and for others the reason was deliberately weak. Which questions got which was fixed in advance, the same for everyone.\n\nWe are studying how the manner of speaking and the strength of a reason work together when a person decides how much to trust an answer. If we had told you this at the start, you would have watched for it, and we would have measured your attention to the study instead of your ordinary way of reading an answer. That is why the description at the beginning was incomplete. We are not saying which result we expected, because you may meet other people who have not taken part yet.",
  "debrief.errorsTitle": "The answers that were wrong",
  "debrief.correct": "Correct value",
  "debrief.told": "What the assistant said",
  "debrief.source": "Source",
  "debrief.withdrawTitle": "You can still take your answers out",
  "debrief.withdrawBody":
    "Now that you know what the study was really about, you may decide you would rather not take part after all. The button below deletes your answers from the study: nothing you did will be counted, analysed, or reported. You do not have to give a reason, and nobody will ask. This costs you nothing.",
  "debrief.withdraw": "Delete my answers from the study",
  "debrief.finish": "Finish",

  "done.title": "Thank you",
  "done.body": "Your responses have been recorded. You can close this tab.",
  "withdrawn.title": "You have stopped",
  "withdrawn.body": "Nothing further will be recorded. Thank you for your time.",
  "ineligible.title": "Thank you for your interest",
  "ineligible.body":
    "This study needs participants without formal training in marine biology or oceanography, so it is not a fit this time.",
} as const;

export type StringKey = keyof typeof en;
export type Strings = Record<StringKey, string>;

/**
 * Spec v2 is English only, so there is one catalogue. The Russian and Kazakh
 * catalogues were empty placeholders awaiting human translation; they are gone
 * with the languages rather than left as permanently unfilled slots.
 */
const catalogues: Record<Language, Partial<Strings>> = { en };

export function isTranslated(language: Language): boolean {
  return Object.keys(catalogues[language]).length === Object.keys(en).length;
}

export function missingKeys(language: Language): StringKey[] {
  const catalogue = catalogues[language];
  return (Object.keys(en) as StringKey[]).filter((key) => catalogue[key] === undefined);
}

export function translator(language: Language) {
  const catalogue = catalogues[language];

  return function t(key: StringKey, vars?: Record<string, string | number>): string {
    const template = catalogue[key] ?? en[key];
    if (!vars) return template;
    return Object.entries(vars).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
      template,
    );
  };
}

export type Translate = ReturnType<typeof translator>;
