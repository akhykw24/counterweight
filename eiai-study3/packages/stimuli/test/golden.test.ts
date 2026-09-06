import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ItemBank,
  QualityAssignment,
  StimulusFile,
  type Condition,
  type Language,
  type RegisterState,
} from "@eiai/schema";
import { registerFor, stimulusFileFor } from "@eiai/fsm";
import {
  StimulusIntegrityError,
  assertLaunchReady,
  hashFileLF,
  loadStimuli,
  manifestDigest,
  resolveResponse,
} from "@eiai/stimuli";

/**
 * Golden-file test (STUDY3_SPEC_v3.md section 5).
 *
 * Recompute the SHA-256 of every frozen response file and diff against the
 * committed manifest. CI fails if a single byte of stimulus changed after
 * pre-registration.
 */

const MATERIALS = fileURLToPath(new URL("../../../materials/", import.meta.url));
const LANGUAGES: Language[] = ["en"];
const VARIANTS: [Condition, RegisterState | null][] = [
  ["warm", "LOW"],
  ["warm", "MODERATE"],
  ["warm", "HIGH"],
  ["neutral", null],
];

const stimuli = loadStimuli(MATERIALS);

describe("golden file: stimulus integrity", () => {
  it("loads without an integrity error, which is the hash check itself", () => {
    // loadStimuli throws on any digest mismatch, so reaching here means all 12
    // files match the committed manifest byte for byte.
    expect(stimuli.byResponseId.size).toBe(48);
  });

  it("matches every per-file digest recorded in the manifest", () => {
    for (const entry of stimuli.manifest.files) {
      const absolute = fileURLToPath(new URL(`../../../${entry.path}`, import.meta.url));
      expect(hashFileLF(absolute), `${entry.path}`).toBe(entry.sha256);
    }
  });

  it("has a manifest digest consistent with its own file list", () => {
    expect(manifestDigest(stimuli.manifest.files)).toBe(stimuli.manifest.manifest_sha256);
  });

  it("detects a single changed byte", () => {
    // Proves the gate is not vacuous. Hash a real file, then hash the same
    // content with one character altered.
    const entry = stimuli.manifest.files[0]!;
    const absolute = fileURLToPath(new URL(`../../../${entry.path}`, import.meta.url));
    const original = readFileSync(absolute, "utf8");
    // Flip one character at a fixed offset rather than substituting a word.
    // This used to replace "PLACEHOLDER", which vanished the day the stimuli
    // became real -- the tamper then equalled the original and the test failed
    // for a reason that had nothing to do with hashing.
    const at = Math.floor(original.length / 2);
    const tampered =
      original.slice(0, at) + (original[at] === "a" ? "b" : "a") + original.slice(at + 1);
    expect(tampered).not.toBe(original);

    const tamperedHash = createHash("sha256")
      .update(Buffer.from(tampered.replace(/\r\n/g, "\n"), "utf8"))
      .digest("hex");
    expect(tamperedHash).not.toBe(entry.sha256);
  });

  it("pins the items.json digest, so the bank cannot move under the stimuli", () => {
    const itemsPath = fileURLToPath(new URL("../../../materials/items.json", import.meta.url));
    expect(hashFileLF(itemsPath)).toBe(stimuli.manifest.items_file_sha256);
  });
});

describe("stimulus space", () => {
  it("covers 12 items x 1 language x 4 variants = 48 responses", () => {
    expect(stimuli.manifest.files).toHaveLength(4);
    const total = stimuli.manifest.files.reduce((sum, f) => sum + f.response_count, 0);
    expect(total).toBe(48);
  });

  it("carries 144 follow-up branches", () => {
    let branches = 0;
    for (const response of stimuli.byResponseId.values()) {
      branches += Object.keys(response.followups).length;
    }
    expect(branches).toBe(144);
  });

  it("names every file the register function would ask for", () => {
    const expected = new Set(
      LANGUAGES.flatMap((lang) => VARIANTS.map(([c, s]) => stimulusFileFor(lang, c, s))),
    );
    const actual = new Set(stimuli.manifest.files.map((f) => f.path.split("/").pop()!));
    expect(actual).toEqual(expected);
  });

  it("validates every file against the StimulusFile schema", () => {
    for (const entry of stimuli.manifest.files) {
      const absolute = fileURLToPath(new URL(`../../../${entry.path}`, import.meta.url));
      const parsed = StimulusFile.safeParse(JSON.parse(readFileSync(absolute, "utf8")));
      if (!parsed.success) {
        throw new Error(`${entry.path}: ${JSON.stringify(parsed.error.issues, null, 2)}`);
      }
      expect(parsed.success).toBe(true);
    }
  });

  it("gives the neutral condition a null register on every response", () => {
    for (const response of stimuli.byResponseId.values()) {
      if (response.condition === "neutral") {
        expect(response.register_state, response.response_id).toBeNull();
      } else {
        expect(response.register_state, response.response_id).not.toBeNull();
      }
    }
  });
});

describe("content equivalence, checked from the TypeScript side too", () => {
  const itemsPath = fileURLToPath(new URL("../../../materials/items.json", import.meta.url));
  const bank = ItemBank.parse(JSON.parse(readFileSync(itemsPath, "utf8")));
  const assignmentPath = fileURLToPath(
    new URL("../../../materials/quality_assignment.json", import.meta.url),
  );
  // Which justification each response should carry now lives in its own file,
  // so this reads the assignment rather than the bank.
  const assignment = QualityAssignment.parse(
    JSON.parse(readFileSync(assignmentPath, "utf8")),
  );

  it("keeps the justification byte-identical across all four condition variants", () => {
    // The load-bearing equivalence claim. If this drifts, warm and neutral
    // differ in content and not only in emotional style.
    for (const language of LANGUAGES) {
      for (const item of bank.items) {
        const texts = new Set(
          VARIANTS.map(
            ([condition, state]) =>
              resolveResponse(stimuli, language, condition, state, item.id).justification_text,
          ),
        );
        expect(texts.size, `${language}/${item.id} justification variants`).toBe(1);
      }
    }
  });

  it("keeps justification_quality equal to the item bank's assignment", () => {
    for (const language of LANGUAGES) {
      for (const item of bank.items) {
        for (const [condition, state] of VARIANTS) {
          const response = resolveResponse(stimuli, language, condition, state, item.id);
          expect(response.justification_quality, response.response_id).toBe(
            assignment.assignment[item.id]!.quality,
          );
        }
      }
    }
  });
});

describe("resolution by register", () => {
  it("routes a confidence to the stimulus the FSM selects", () => {
    const cases: [number, string][] = [
      [10, "en_warm_low_item_01"],
      [55, "en_warm_moderate_item_01"],
      [95, "en_warm_high_item_01"],
    ];
    for (const [confidence, expected] of cases) {
      const state = registerFor("warm", confidence);
      expect(resolveResponse(stimuli, "en", "warm", state, "item_01").response_id).toBe(expected);
    }
  });

  it("routes every neutral confidence to the same single stimulus", () => {
    for (const confidence of [0, 39, 40, 70, 71, 100]) {
      const state = registerFor("neutral", confidence);
      expect(resolveResponse(stimuli, "en", "neutral", state, "item_01").response_id).toBe(
        "en_neutral_na_item_01",
      );
    }
  });

  it("throws rather than improvising when a stimulus is absent", () => {
    expect(() => resolveResponse(stimuli, "en", "warm", "LOW", "item_99")).toThrow(
      StimulusIntegrityError,
    );
  });
});

describe("launch-readiness gate", () => {
  // The committed set is now real: generated 2026-09-05 through Groq's
  // gpt-oss-120b, equivalence-checked, hash-manifested. The gate did not open
  // with it, and that is the point of this block.
  it("the stimuli are real, so nothing is marked placeholder any more", () => {
    expect(stimuli.manifest.generator_mode).toBe("live_api");
    for (const response of stimuli.byResponseId.values()) {
      expect(response.placeholder, response.response_id).toBe(false);
    }
  });

  it("still refuses, because being real is not the same as being read", () => {
    // Written as an assertion rather than a skip so that opening the gate has
    // to be a deliberate act. Previously the flag was computed from the
    // placeholder field alone, so this would have flipped to true on its own
    // the moment generation finished -- with nobody having read a sentence.
    expect(stimuli.manifest.hand_verified).toBe(false);
    expect(stimuli.launchReady).toBe(false);
    expect(() => assertLaunchReady(stimuli)).toThrow(StimulusIntegrityError);
  });

  it("keeps readiness tied to hand verification, not merely to being live", () => {
    // The two conditions are separable, and the conjunction is what the
    // specification's "hand-verified" means. If this ever reads as "live
    // implies ready" again, the last barrier before a participant sees
    // unreviewed text is gone.
    expect(stimuli.launchReady).toBe(
      stimuli.manifest.generator_mode !== "offline_placeholder" &&
        stimuli.manifest.hand_verified,
    );
  });
});
