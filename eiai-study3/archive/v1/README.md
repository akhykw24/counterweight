# v1 artifacts (superseded)

Kept for provenance only. **Nothing here is current.** The live item bank is
`../../materials/items.json`; the live spec is `../../docs/STUDY3_SPEC_v3.md`.

| File | Superseded by | Why |
|---|---|---|
| `STUDY3_SPEC_v1.md` | `docs/STUDY3_SPEC_v2.md`, then `v3` | v1 tested *whether* warmth reduces vigilance. v2 replaced that with the ELM mechanism test (style × justification-quality interaction), v3 added the architecture. |
| `items.v1.json` | `materials/items.json` | 8 items, 3 planted errors, no justification pairs. v3 uses 12 items, 4 errors, crossed with justification quality. |
| `generate_v1.py` | `pipeline/generate.py` (day 2) | Generated 48 responses (8 items × 2 conditions × 3 languages). v3 needs 144 plus 432 follow-up branches, with the three-register FSM and the five EI components. Kept as reference for the locale-aware numeric validator and the resume/fingerprint logic, both of which carry over. |

## What v1's source verification contributed

Three item-bank corrections found while compiling `items.v1.json` were folded
into the v2/v3 bank:

- **Tube worm lifespan.** v1 flagged that "giant tube worm" names *Riftia
  pachyptila*, which is short-lived, while the 250-year figure belongs to
  cold-seep vestimentiferans. v3's item 9 now names *Lamellibrachia luymesi* in
  the stem, which resolves it.
- **Seafloor mapped.** v1 found the spec's 26% was the mid-2024 figure and
  updated it to 28.7%. v3 carries 28.7% with a re-verify-at-launch note.
- **Sperm whale dive duration.** v1 flagged that "longest recorded" is 117–138
  minutes, not 90. v3 keeps 90 but makes the item an error item, which defuses
  the scoring consequence.
