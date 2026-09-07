/**
 * Writes docs/ETHICS_PACKAGE/all_participant_texts.md.
 *
 * Everything a participant sees, in the order they see it, readable by a person
 * rather than by a parser. Generated rather than written: it runs to tens of
 * thousands of words across fifty-odd screens, and a hand-kept copy would be
 * wrong within a week. A committee approves what is in this file, so it has to
 * be what the application actually shows.
 *
 * Where each part comes from, and why
 * -----------------------------------
 * - Interface wording: imported from `apps/study/src/i18n.ts`, the catalogue
 *   the screens read at runtime.
 * - Questions, answers, follow-ups: read from `materials/` on disk, which is
 *   the frozen, hash-manifested material itself.
 * - Consent and debriefing: sliced out of `docs/CONSENT_AND_DEBRIEF.md`. Those
 *   two are written directly in JSX rather than in the catalogue, and
 *   `apps/study/test/ethics-document.test.tsx` renders the real screens and
 *   fails if that document has drifted from them. So quoting it here inherits
 *   the same guarantee.
 *
 * The stimulus loader is deliberately not imported: it uses `import.meta.glob`,
 * a Vite feature, and would only run inside a bundler. Reading the same JSON
 * from disk gets the same bytes with no build step.
 *
 *   pnpm exec tsx scripts/export-participant-texts.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { questionnaireDefinition } from "@eiai/schema";
import { translator } from "../apps/study/src/i18n";

const ROOT = process.cwd();
const OUT = resolve(ROOT, "docs/ETHICS_PACKAGE/all_participant_texts.md");
const t = translator("en");

interface Item {
  id: string;
  question: Record<string, string>;
  unit: Record<string, string>;
  advice_value: number;
  true_value: number;
  is_error: boolean;
  sources: { citation: string }[];
}

interface Response {
  response_id: string;
  item_id: string;
  body: string;
  justification_text: string;
  justification_quality: string;
  followups: Record<string, string>;
}

const read = (relative: string) =>
  JSON.parse(readFileSync(resolve(ROOT, relative), "utf8"));

const items: Item[] = read("materials/items.json").items;
const quality: Record<string, { quality: string; role: string }> =
  read("materials/quality_assignment.json").assignment;

const VARIANTS = [
  { file: "en_warm_low", label: "Warm — shown when the participant reported LOW confidence (under 40)" },
  { file: "en_warm_moderate", label: "Warm — MODERATE confidence (40–70)" },
  { file: "en_warm_high", label: "Warm — HIGH confidence (over 70)" },
  { file: "en_neutral_na", label: "Neutral — one text, whatever the confidence" },
];

const responses = new Map<string, Response[]>();
for (const variant of VARIANTS) {
  responses.set(variant.file, read(`materials/responses/${variant.file}.json`).responses);
}
const responseFor = (file: string, itemId: string): Response =>
  responses.get(file)!.find((r) => r.item_id === itemId)!;

/** A named section of the verified consent/debrief document, without its heading. */
function sectionOf(heading: string): string {
  const document = readFileSync(resolve(ROOT, "docs/CONSENT_AND_DEBRIEF.md"), "utf8");
  const start = document.indexOf(heading);
  if (start === -1) throw new Error(`docs/CONSENT_AND_DEBRIEF.md has no section "${heading}"`);
  const after = document.indexOf("\n## ", start + heading.length);
  const body = document.slice(start + heading.length, after === -1 ? undefined : after);
  return body
    .split("\n")
    .filter((line) => !line.startsWith("The button is disabled"))
    .join("\n")
    .trim();
}

const out: string[] = [];
const push = (s: string) => out.push(s);

push("# Everything a participant sees");
push(
  "Generated from the application and the frozen materials by " +
    "`scripts/export-participant-texts.ts`, in the order the screens appear.\n\n" +
    "Regenerate with `pnpm exec tsx scripts/export-participant-texts.ts`.",
);

push("## 0. Invitation / recruitment text");
push(
  "**Does not exist yet, and is deliberately not invented here.** There is no recruitment " +
    "advertisement, email, or social-media post in the repository. As things stand, the " +
    "first thing a participant sees is the eligibility screen below, reached by opening " +
    "the study link.\n\n" +
    "If the committee expects to review recruitment wording, it must be written and added " +
    "to this package.",
);

push("## 1. Eligibility screen");
push(
  "Shown **before** consent. Anyone under 18, or reporting English below B1, or with " +
    "formal training in marine biology or oceanography, is turned away here. Nothing is " +
    "stored about them except that they were screened out and which criterion applied.",
);
push("> **" + t("eligibility.title") + "**");
push("> \n> " + t("eligibility.age"));
push("> Under 18 · 18–24 · 25–34 · 35 or over");
push("> \n> " + t("eligibility.language"));
push(
  "> A1 — a few words and phrases · A2 — simple everyday language · " +
    "B1 — I can follow most straightforward writing · B2 — I read complex text with some " +
    "effort · C1 — I read complex text comfortably · C2 — near-native or native",
);
push("> \n> Is your study or work mainly in English? Yes · No");
push("> \n> " + t("eligibility.training") + " No · Yes");
push("> \n> [ " + t("common.continue") + " ]");

push("### If they are turned away");
push("> **" + t("ineligible.title") + "**\n> \n> " + t("ineligible.body"));

push("## 2. Informed consent");
push(
  "Quoted from `docs/CONSENT_AND_DEBRIEF.md`, which an automated test checks against the " +
    "rendered screen.",
);
push(sectionOf("## 2. Informed consent (exact text)"));

push("## 3. The twelve questions");
push(
  "Each item runs in three steps: an estimate, the assistant's answer, and a revised " +
    "estimate — then one question about how convincing the reason was. The wording is the " +
    "same for every item; only the question and the numbers change.",
);
push("### 3.1 Wording used on every item screen");
push(
  ([
    "item.progress",
    "item.estimate",
    "item.confidence",
    "item.submitInitial",
    "item.finalEstimate",
    "item.finalConfidence",
    "item.finish",
    "followup.prompt",
    "followup.measurement",
    "followup.certainty",
    "followup.challenge",
  ] as const)
    .map((key) => [key, t(key as never)] as const)
    .filter(([, value]) => value && !value.startsWith("??"))
    .map(([key, value]) => `- **${key}** — ${value}`)
    .join("\n"),
);

push("### 3.2 The questions themselves");
// One push, not one per row: sections are joined by blank lines, and a blank
// line between table rows makes Markdown render twelve paragraphs.
push(
  [
    "| # | Question | Unit | Assistant's answer | Wrong on purpose? | Reason quality |",
    "|---|---|---|---|---|---|",
    ...items.map((item) => {
      const wrong = item.is_error ? `**yes** - true value about ${item.true_value}` : "no";
      return (
        `| ${item.id.replace("item_", "")} | ${item.question["en"]} | ${item.unit["en"]} | ` +
        `${item.advice_value} | ${wrong} | ${quality[item.id]?.quality ?? "-"} |`
      );
    }),
  ].join("\n"),
);

push("## 4. The 48 assistant answers");
push(
  "Twelve items in four versions each. Within one item, the four versions state the same " +
    "number and carry the same supporting reason word for word; only the manner of " +
    "speaking differs. That equivalence is checked automatically " +
    "(`pipeline/verify_equivalence.py`, 683 checks) and the whole set is frozen under a " +
    "SHA-256 manifest, so no text can change after approval without the change being " +
    "visible.\n\n" +
    "The supporting reason is printed once per item, because it is identical across the four.",
);
for (const item of items) {
  const first = responseFor("en_warm_low", item.id);
  push(`### Item ${item.id.replace("item_", "")} — ${item.question["en"]}`);
  push(
    `Assistant's answer: **${item.advice_value} ${item.unit["en"]}**. ` +
      (item.is_error
        ? `**Deliberately wrong**; the true value is about ${item.true_value} ` +
          `${item.unit["en"]}. Corrected on the debriefing screen, with its source ` +
          `(${item.sources[0]?.citation ?? "source on file"}).`
        : "This is the correct value.") +
      ` Supporting reason: **${quality[item.id]?.quality ?? "—"}**.`,
  );
  push("**Supporting reason — identical in all four versions:**");
  push("> " + first.justification_text);
  for (const variant of VARIANTS) {
    push(`**${variant.label}**`);
    push("> " + responseFor(variant.file, item.id).body);
  }
  push("**Follow-up questions the participant may click, and the replies:**");
  for (const [id, reply] of Object.entries(first.followups)) {
    push(`- *${id}* — ${reply}`);
  }
}

push("## 5. Questionnaire after the twelve items");
push(
  [
    "| Scale | Question | Reverse-scored |",
    "|---|---|---|",
    ...questionnaireDefinition.map((question) => {
      const q = question as unknown as {
        scale: string;
        text_en?: string;
        reverse_scored?: boolean;
      };
      return `| ${q.scale} | ${q.text_en ?? "-"} | ${q.reverse_scored ? "yes" : "no"} |`;
    }),
  ].join("\n"),
);

push("## 6. Three open questions");
push(
  "Asked one at a time, forward only, before the debriefing. They check whether the " +
    "participant guessed what the study was about.",
);
push(`1. ${t("funnel.purpose")}`);
push(`2. ${t("funnel.anomaly")}`);
push(`3. ${t("funnel.belief")} — Yes · No · ${t("funnel.unsure")}`);
push(`*Shown under each:* ${t("funnel.freeTextHint")}`);

push("## 7. Debriefing");
push(
  "Quoted from `docs/CONSENT_AND_DEBRIEF.md`, checked against the rendered screen by the " +
    "same test as the consent form.",
);
push(sectionOf("## 3. Debriefing (exact text)"));

push("## 8. Final screens");
push("**After finishing**");
push("> **" + t("done.title") + "**\n> \n> " + t("done.body"));
push("**After deleting their answers**");
push("> **" + t("withdrawn.title") + "**\n> \n> " + t("withdrawn.body"));

push("## 9. Available on every screen");
push(
  `A button labelled "${t("app.withdraw")}" is present from the first screen to the last. ` +
    "It ends the session immediately, and nothing recorded up to that point is used.",
);

const document = out.join("\n\n") + "\n";
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, document, { encoding: "utf8" });
console.log(
  `Wrote docs/ETHICS_PACKAGE/all_participant_texts.md ` +
    `(${document.split(/\s+/).length} words, ${items.length} items, ` +
    `${VARIANTS.length * items.length} assistant answers).`,
);
