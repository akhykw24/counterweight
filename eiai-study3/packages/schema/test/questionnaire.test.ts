import { describe, expect, it } from "vitest";
import {
  Covariates,
  PerceivedCompetenceScale,
  PerceivedWarmthScale,
  TrustScale,
  questionnaireDefinition,
} from "@eiai/schema";

describe("questionnaire instrument", () => {
  it("has the scale lengths the spec requires", () => {
    const count = (scale: string) =>
      questionnaireDefinition.filter((q) => q.scale === scale).length;
    expect(count("warmth"), "manipulation check").toBe(5);
    expect(count("competence"), "control check").toBe(4);
    expect(count("trust")).toBe(4);
  });

  it("uses unique, stable question ids", () => {
    const ids = questionnaireDefinition.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes reverse-scored items on each Likert scale, to catch straight-lining", () => {
    for (const scale of ["warmth", "competence", "trust"] as const) {
      const reversed = questionnaireDefinition.filter(
        (q) => q.scale === scale && q.reverse_scored,
      );
      expect(reversed.length, `${scale} has no reverse-scored item`).toBeGreaterThanOrEqual(1);
    }
  });

  it("collects every covariate the ANCOVA model needs", () => {
    const ids = questionnaireDefinition.filter((q) => q.scale === "covariates").map((q) => q.id);
    expect(ids).toEqual([
      "cov_age_band",
      "cov_gender",
      "cov_primary_language",
      "cov_ai_usage",
      "cov_prior_knowledge",
    ]);
  });
});

describe("scale bounds", () => {
  const warmth = { warmth_01: 7, warmth_02: 1, warmth_03: 4, warmth_04: 5, warmth_05: 6 };

  it("accepts in-range seven-point responses", () => {
    expect(PerceivedWarmthScale.safeParse(warmth).success).toBe(true);
  });

  it("rejects out-of-range and non-integer responses", () => {
    expect(PerceivedWarmthScale.safeParse({ ...warmth, warmth_01: 8 }).success).toBe(false);
    expect(PerceivedWarmthScale.safeParse({ ...warmth, warmth_01: 0 }).success).toBe(false);
    expect(PerceivedWarmthScale.safeParse({ ...warmth, warmth_01: 4.5 }).success).toBe(false);
  });

  it("requires every item of a scale, so partial scales cannot be scored by accident", () => {
    const { warmth_05: _omitted, ...incomplete } = warmth;
    expect(PerceivedWarmthScale.safeParse(incomplete).success).toBe(false);
  });

  it("validates the competence and trust scales the same way", () => {
    expect(
      PerceivedCompetenceScale.safeParse({
        competence_01: 5,
        competence_02: 5,
        competence_03: 6,
        competence_04: 2,
      }).success,
    ).toBe(true);
    expect(
      TrustScale.safeParse({ trust_01: 5, trust_02: 4, trust_03: 3, trust_04: 6 }).success,
    ).toBe(true);
  });
});

describe("covariates", () => {
  const valid = {
    age_band: "25-34",
    gender: "prefer_not_to_say",
    primary_language: "kk",
    ai_usage_frequency: 3,
    prior_knowledge_marine_biology: 2,
  };

  it("accepts a complete covariate set", () => {
    expect(Covariates.safeParse(valid).success).toBe(true);
  });

  it("refuses an exact age in place of a band", () => {
    expect(Covariates.safeParse({ ...valid, age_band: 16 }).success).toBe(false);
    expect(Covariates.safeParse({ ...valid, age_band: "16" }).success).toBe(false);
  });
});
