// Tests for the minor assent branch, removed from the active suite by spec
// v2 (adults only). Preserved rather than deleted so the branch's behaviour
// stays documented.

  it("blocks assent without a parental consent code", () => {
    const actor = start();
    send(
      actor,
      { type: "SET_LANGUAGE", language: "en" },
      { type: "SET_AGE_ANSWER", ageAnswer: "18-24" },
      { type: "SET_PRIOR_TRAINING", priorTraining: false },
      { type: "SUBMIT_ELIGIBILITY" },
      { type: "GIVE_ASSENT" },
    );
    expect(actor.getSnapshot().value).toBe("assent");
  });

  it("blocks assent on a whitespace-only code", () => {
    const actor = start();
    send(
      actor,
      { type: "SET_LANGUAGE", language: "en" },
      { type: "SET_AGE_ANSWER", ageAnswer: "18-24" },
      { type: "SET_PRIOR_TRAINING", priorTraining: false },
      { type: "SUBMIT_ELIGIBILITY" },
      { type: "SET_PARENTAL_CODE", code: "   " },
      { type: "GIVE_ASSENT" },
    );
    expect(actor.getSnapshot().value).toBe("assent");
  });
});

