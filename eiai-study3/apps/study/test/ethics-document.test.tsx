/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionMachine } from "@eiai/fsm";
import { App } from "../src/App";

/**
 * docs/CONSENT_AND_DEBRIEF.md must quote the screens that actually run.
 *
 * The document goes to an ethics committee. What a committee approves and what
 * a participant reads have to be the same words, and nothing but a test keeps
 * them that way: the texts live in TypeScript, the document is Markdown, and
 * the two drift the first time anyone edits one of them in a hurry.
 *
 * The comparison is per sentence rather than per paragraph. Markdown reflows
 * lines and inserts blockquote markers, so a whole-paragraph match would fail
 * on formatting and teach everyone to ignore this test.
 */

// Resolved from the working directory rather than import.meta.url: under the
// jsdom environment that URL is an http one, and fileURLToPath rejects it.
// vitest runs from the repository root, which is where docs/ lives.
const DOCUMENT = readFileSync(resolve(process.cwd(), "docs/CONSENT_AND_DEBRIEF.md"), "utf8");

const ITEM_IDS = ["item_01"];

/**
 * Typographic punctuation folded to ASCII, whitespace collapsed.
 *
 * The screen renders &rsquo; and &mdash; as curly characters; the document is
 * written with plain ones. That is a difference in how the same sentence is
 * typeset, not in what it says, and a test that failed on it would be a test
 * about apostrophes.
 */
function normalise(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ");
}

/** Markdown as one flat line, so wrapping and blockquote markers cannot matter. */
const flattened = normalise(
  DOCUMENT.replace(/^\s*>\s?/gm, " ").replace(/\*\*/g, "").replace(/\*/g, ""),
);

/** Sentences long enough to be worth pinning, normalised the same way. */
function sentencesOf(text: string): string[] {
  return normalise(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40);
}

afterEach(cleanup);

async function reachConsent() {
  const user = userEvent.setup();
  render(<App machine={createSessionMachine(ITEM_IDS)} />);
  await user.click(screen.getByTestId("age-35+"));
  await user.click(screen.getByTestId("cefr-B2"));
  await user.click(screen.getByTestId("study-language-english"));
  await user.click(screen.getByTestId("training-no"));
  await user.click(screen.getByTestId("submit-eligibility"));
  return user;
}

describe("the ethics document quotes the running screens", () => {
  it("reproduces every sentence of the consent form", async () => {
    await reachConsent();
    // Per block, not the section's textContent: that concatenates paragraphs
    // with no separator, so "...any purpose.Taking part is voluntary." reads as
    // one sentence spanning two <p> elements and matches nothing.
    const onScreen = [...screen.getByTestId("screen-consent").querySelectorAll("p")]
      .map((node) => node.textContent ?? "")
      .join("\n");

    const missing = sentencesOf(onScreen).filter(
      (sentence) => !flattened.includes(sentence),
    );
    expect(
      missing,
      "docs/CONSENT_AND_DEBRIEF.md no longer matches the consent screen",
    ).toEqual([]);
  });

  it("names the researcher, the supervisor and the school in the document", () => {
    for (const required of [
      "Prokopenko Darya Artyomovna",
      "Rakhimbekova Saya Dissembeyevna",
      "Nazarbayev Intellectual School of Science and Mathematics",
      "Kokshetau",
    ]) {
      expect(DOCUMENT, `${required} is missing from the ethics document`).toContain(required);
    }
  });

  it("flags the supervisor's email as outstanding in both places", () => {
    // The one thing that must not ship unnoticed. It appears on the consent
    // screen and in the document, and this fails the moment one is filled in
    // without the other -- which is exactly when it would be forgotten.
    const placeholder = "supervisor email";
    expect(DOCUMENT.toLowerCase()).toContain(placeholder);

    return reachConsent().then(() => {
      const onScreen = (screen.getByTestId("screen-consent").textContent ?? "").toLowerCase();
      expect(
        onScreen.includes(placeholder),
        "the consent screen and the ethics document disagree about whether the " +
          "supervisor's email is still outstanding",
      ).toBe(DOCUMENT.toLowerCase().includes(placeholder));
    });
  });

  it("states what deletion actually does, in the document", () => {
    // The committee is told the log is append-only and what withdrawal means
    // in practice. Promising erasure the design cannot perform would be the
    // one deception the study is not entitled to.
    expect(DOCUMENT).toContain("append-only");
    expect(DOCUMENT.toLowerCase()).toContain("removed from every analysis");
  });
});
