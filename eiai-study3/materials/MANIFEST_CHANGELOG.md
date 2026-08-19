# Manifest changelog

Every rebuild of `materials/manifest.json` is recorded here with the digests
that moved and why. The manifest is the integrity gate for the frozen stimulus
set, so a digest that changes without a reason on this page is exactly the
event the gate exists to make visible.

`hash_manifest.py --check` fails the build when the committed manifest and the
files disagree, which means a rebuild is always a deliberate act.

---

## Unreleased — days 6-7 plus the quality-assignment extraction

| Digest | Was (at HEAD) | Now |
|---|---|---|
| `items_file_sha256` | `cde7b577ae68420d0b6cef86...` | `93fc1c7a899b79b91c07551d...` |
| `manifest_sha256` | `71e3e893675dfcc800beae6c...` | `b4ccb13b948019dd9b740dad...` |
| the twelve stimulus file digests | unchanged | unchanged |

**Why `items_file_sha256` moved.** Three edits to `materials/items.json`, none
of which touch what a participant sees:

1. A bank-level entry was added to `review_required` (`item_id: null`), which
   required widening that field from `ItemId` to `ItemId | null`.
2. `assigned_justification_quality` and `design_cell` were **removed** from
   every item. They now live in `materials/quality_assignment.json`, which is
   the single source of truth for the allocation; `design_cell` is derived from
   `(is_error, quality, role)` rather than stored, so the two can no longer
   disagree. Reassigning an item is now a config edit plus a regeneration, not
   a bank edit.
3. The `role` distinction (`analysed` vs `filler`) became explicit, replacing
   the implicit encoding inside the `correct_filler` cell name.

**Why `manifest_sha256` moved.** It is a digest over the sorted per-file
digests plus the bank digest, so it follows (1)-(3) mechanically.

**Why the twelve stimulus digests did NOT move.** None of the above changes any
frozen response. The stimuli are still the offline placeholders committed on
day 2, and `launch_ready` is still `false`. A change to the assignment *would*
change the stimuli, because each response embeds the assigned justification —
that regeneration has not happened and is not needed, since the allocation
itself is unchanged.

**Also added, outside the manifest:** `provider` on the manifest and on every
stimulus file's `meta`, and `generator_mode` renamed from `anthropic_api` to
`live_api`. Both correct a provenance record that named the wrong thing;
generation runs against whichever OpenAI-compatible provider is configured.

### Rebuild 2 — filler exclusion, topics, corrected review entry

| Digest | Now |
|---|---|
| `items_file_sha256` | `f43001f91337d0e06430c348...` |
| `manifest_sha256` | `b4ccb13b948019dd9b740dad...` |
| the twelve stimulus file digests | still unchanged |

Three further edits to `materials/items.json`:

1. A `topic` field on every item (seven-value controlled vocabulary). It is a
   classification of the question stems, not something the cited sources
   establish, and it exists so topic diversity within each quality cell is
   machine-checkable — a cell drawn entirely from one sub-domain would confound
   justification quality with subject-matter familiarity.
2. The bank-level `review_required` entry claiming an 8/4 imbalance was
   **wrong** and is replaced by one recording what actually happened: the bank
   was always 4/4 across the analysed items, and the imbalance was
   `pipeline/analysis.py` averaging the four fillers into the strong cell.
3. A second bank-level entry recording that no pilot data exist, so every power
   figure rests on an assumed effect size rather than an observed SD.

Still no stimulus regeneration: none of this changes a frozen response.
