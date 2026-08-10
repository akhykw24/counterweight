# Component coding instructions

You are coding 144 AI responses for the presence or absence of five
emotional-intelligence components. Work through `rater_A.csv` or `rater_B.csv`
(whichever you were given) and do not compare notes with the other rater until
both sheets are complete.

## What to enter

For each of the five component columns, enter **1** if the component is present
in the response text and **0** if it is not. Leave nothing blank. Use the
`notes` column for anything ambiguous.

- **`c1_perception`** — Names the affective state the participant signalled
- **`c2_facilitation`** — Reframes their state as epistemically useful, not a deficit
- **`c3_understanding`** — Attributes a cause to their state (model of their mind)
- **`c4_regulation`** — Actively modulates their affective state
- **`c5_convergence`** — Mirrors their register and hedging density

## Important

- The sheets are **blinded**. Rows are shuffled and the experimental condition
  is not shown. Many responses will have none of the five components — that is
  expected, and coding them all 0 is the correct answer for those.
- Code what is actually in the text, not what you think the study wants. A
  component that is *almost* there is a 0.
- Do not code the justification sentence; it is not shown here, and it is
  identical across conditions by construction.

## What happens next

`pipeline/verify_components.py score` computes Cohen's kappa per component
across the two sheets. Any component below 0.60 gets rewritten and
regenerated before launch, per STUDY3_SPEC_v2.md section 4.
