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
  "debrief.errorsTitle": "The answers that were wrong",
  "debrief.correct": "Correct value",
  "debrief.told": "What the assistant said",
  "debrief.source": "Source",
  "debrief.withdrawTitle": "You can still withdraw",
  "debrief.withdrawBody":
    "Now that you know what the study involved, you may withdraw your responses. Nothing you did will be used. This costs you nothing and needs no explanation.",
  "debrief.withdraw": "Withdraw my responses",
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
