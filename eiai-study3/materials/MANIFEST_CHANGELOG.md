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

### Rebuild 3 — offline becomes a provider like any other

| Digest | Now |
|---|---|
| `manifest_sha256` | `471cef6f8cc11faa4348f6b4...` |
| all twelve stimulus file digests | **changed** |

The twelve digests moved for the first time, and it is worth being precise that
**no stimulus text changed**. The diff is thirteen lines per file, all metadata:

- `meta.provider` is now `offline` rather than `none (offline placeholder)`.
  The field names the provider; `generator_mode: offline_placeholder` and
  `placeholder: true` already say the material is not fieldable, so repeating it
  inside the provider name was redundant and inconsistent with `groq`/`manual`.
- `attempts_used` is `1` rather than `0` on placeholder records, because the
  offline path is now a provider call rather than a branch that skipped the
  provider entirely.

Both follow from removing the `if args.offline:` short-circuit in the generation
loop. That branch meant `OfflineProvider` was never exercised for bodies, so the
placeholder path was untested by everything below the branch -- the same shape of
defect as the hard-coded allocation literal.

`launch_ready` is still `false`.

### Rebuild 4 — English only (spec v2 item 2)

| Digest | Now |
|---|---|
| `manifest_sha256` | `32f4cc2488ee9edb521b14f8...` |
| files covered | **4**, was 12 |
| responses covered | **48**, was 144 |

The Russian and Kazakh stimulus sets moved to `archive/responses/` and are no
longer manifested. They are retained rather than deleted: they are provenance
for a design decision and the texts took real work. Nothing archived can reach a
participant, because the manifest is what the golden test verifies and what the
loader serves from.

`items_file_sha256` moved too: `design.languages` in the bank is now `["en"]`.
The Russian and Kazakh question stems are still in the bank and were **not**
edited — they are inert once the active language set is English only.
