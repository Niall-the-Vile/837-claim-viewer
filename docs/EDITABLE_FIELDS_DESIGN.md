# Editable fields & corrected-claim export — design

Niall approved crossing the app's own "view-only" boundary for this one feature
(see `README.md`'s data policy header and `docs/FEATURE_BACKLOG.md`'s
out-of-scope item #1 — that item is about *persistent notes/triage*, a
separate, still-out-of-scope feature; this document is the one place that
boundary is deliberately, narrowly crossed). This is a first-of-its-kind
write capability in an app that has otherwise been strictly
source-file -> immutable parsed `Claim` -> render. Every design choice below
is driven by one rule: **a claims viewer that can silently misrepresent data
is worse than one that can't edit at all.**

Kept tight, house style per `docs/UI_REQUIREMENTS_v3_queued_features.md` /
`docs/TABS_BUILD_PLAN.md` — this is not exhaustive API documentation; read the
code's own doc comments (`src/model/editableFields.ts`,
`src/app/persistence/correctedClaimStore.ts`, `electron/main.ts`'s "Editable
fields" section) for the rest.

## Non-negotiable invariants (restated from the task, kept visible here)

1. The original source file is **never** opened for writing, under any code
   path.
2. Edits live in a separate, versioned JSON artifact under `userData`.
3. A stale artifact (hash mismatch) is surfaced, never silently applied.
4. Warnings/reconciliation are **always** computed against the original
   parsed claim.
5. Every edited value stays visually/structurally distinguishable from the
   original.
6. Any export with active overrides carries a mandatory EDITED stamp.
7. Editing has its own explicit affordance — plain click still means copy.
8. A user can revert one field, or clear all overrides for a claim.

## 1. Artifact format, filename, and location

One file, `corrected-claims.json`, under `app.getPath('userData')` — the
exact same directory `session.json` already lives in, written by the same
"Electron-free module + `ALLOWED_USERDATA_FILES` allowlist" mechanism
(`docs/BUILD_QUEUE.md` rule 12) as every other `userData` writer in this app.
See `src/app/persistence/correctedClaimStore.ts`.

```jsonc
{
  "schemaVersion": 1,
  "artifacts": {
    "<resolved source file path>": {
      "schemaVersion": 1,
      "sourceFilePath": "<same path, duplicated inside for self-description>",
      "sourceFileHash": "<sha256 hex of the source file's bytes as of the last write>",
      "createdAt": "<ISO 8601>",
      "updatedAt": "<ISO 8601>",
      "fieldOverrides": {
        "<claimIndex>::<fieldPath>": "<raw string value>"
      }
    }
  }
}
```

**Why one file with an `artifacts` map, rather than one file per source claim
file** (the task's suggested shape was a single flat object): the existing
persistence convention in this app is "one JSON file per *kind* of userData,
addressed by a stable key inside it" (`session.json` holds every tab, not one
file per tab). Reusing that shape means `ALLOWED_USERDATA_FILES`
(`test/persisted-artifacts.test.ts`) stays a simple exact-filename allowlist
— no filename pattern matching, no risk of an unbounded number of
per-source-file names accumulating in `userData` with no listing/cleanup
story. The inner `artifacts[<path>]` value keeps every field the task asked
for, verbatim.

**Why keyed by source file *path*, not by its hash:** staleness detection
(invariant 3) requires being able to find "there ARE saved edits for this
file" even when the file's current hash no longer matches what was saved —
if the lookup key were the hash itself, a changed file would simply produce
zero matches, and the user would never be told edits existed at all. Path is
already an accepted, precedented identity key in this app (`session.json`'s
tabs and recents are also keyed/deduped by resolved path; see
`electron/main.ts`'s `openClaimAtPath`), and paths are already disclosed
PHI-adjacent data under the existing `README.md` policy.

**Claim content is now written to disk.** This is new: every previous
`userData` writer stored only file paths (`docs/BUILD_QUEUE.md` rule 12's
entire premise). `fieldOverrides` values ARE claim content — a corrected NPI,
DOB, charge, or diagnosis code. This is the deliberate, narrow, Niall-approved
exception; `README.md`'s data policy is updated in the same change to say so
plainly, the same way Build 4.3/5.1 were always slated to when they landed.

## 2. Field-key addressing scheme

A **fixed, curated registry** (`src/model/editableFields.ts`), not a generic
object-path evaluator. Every editable field is one explicit entry with its
own typed `getValue`/`setValue` (validating) pair — there is no way to write
into a field (e.g. `warnings`, `raw`) that isn't on this list, including from
a hand-edited or corrupted `corrected-claims.json`: an unrecognized or
invalid key is silently skipped when re-hydrating (never thrown — a bad
stored value must not break rendering) and rejected with a clear error when
first being saved.

A field path is a plain string identifying one field **within one claim**:

- Claim-level: `patient.dob`, `patient.phone`, `patient.accountNumber`,
  `insured.memberId`, `insured.group`, `billingProvider.npi`,
  `billingProvider.taxId`, `renderingProvider.npi`.
- Per service line (`i` is the 0-based line index):
  `` serviceLines[${i}].procCode ``, `` serviceLines[${i}].modifiers ``,
  `` serviceLines[${i}].units ``, `` serviceLines[${i}].charge ``.
- Per diagnosis: `` diagnoses[${i}].code ``.

The **stable identifier the task asked for** (claim index + field path,
"never anything that could collide across claims in a batch file") is this
field path PREFIXED with the claim's index within the source file:
`` `${claimIndex}::${fieldPath}` ``, e.g. `"2::serviceLines[0].charge"` means
"the 3rd claim in this file, its first line's charge." This is the literal
key stored in `fieldOverrides`. The claim index is a position in the
interchange (or `0` for a single-claim JSON file) — not patient data, so it
carries no additional PHI exposure of its own (same reasoning
`docs/BUILD_QUEUE.md` 4.1 already uses for the batch-export filename
ordinal).

**Deliberately NOT editable** (deferred — see §7): patient/insured/dentist
*names* and any *address* — every one of those is a **composed** display
string (`composeName`/`composeAddressLine` in `src/render/text.ts`) built
from several underlying fields. Editing the composed string and reliably
decomposing it back is a materially harder, higher-risk problem (ambiguous
splitting of "Last, First Middle") than this build's time budget allows
safely. Institutional/dental claim-level fields (type of bill, discharge
status, occurrence/value codes, etc.) and payer fields are likewise deferred.
The registry is intentionally small and can grow later without changing the
addressing scheme, the artifact format, or the IPC surface.

## 3. Interaction model — entering edit mode

**Chosen: an explicit toolbar toggle ("Edit fields", pencil icon), not a
hover-pencil on every row.** While Edit mode is OFF (the default, and the
state on every fresh file open), every inspector row behaves **exactly** as
before this feature — the existing hover/focus copy icon and Ctrl+C
click-to-copy path is completely untouched code. While Edit mode is ON, rows
whose field is in the editable registry (`detail.editableFieldPaths`, see
§4) additionally show a small pencil button next to the copy button; clicking
it swaps that row's value into an inline `<input>` with Save/Cancel. Rows not
in the registry are simply not editable in either mode — no pencil ever
appears on them.

Why a mode toggle rather than "pencil always visible on eligible rows": a
per-row pencil visible at all times competes for the same hover-affordance
space as the existing copy icon and adds a second small icon-button to every
patient/provider/service-line row permanently, even for the overwhelming
majority of sessions that never edit anything. A single, discoverable,
labeled toolbar toggle (with its own keyboard-focusable state, `aria-pressed`)
makes "this app can now be put into a different mode" an explicit, visible
decision, and keeps the at-rest inspector visually identical to Build 3.

**Plain click never becomes "start editing."** Editing is only ever entered
through the pencil button (mouse) — never through clicking anywhere else on
the row, so the existing "click-to-copy" click-and-Ctrl+C-on-focused-row
behavior (`docs/TABS_BUILD_PLAN.md` §2f item 2) is preserved byte-for-byte,
in every mode, satisfying invariant 7 and keeping the existing copy-on-click
e2e coverage green with zero changes.

## 4. Data flow: renderer -> IPC -> persistence -> render pipeline

```
inspector.ts (pencil click)
  -> window.claimApi.setFieldOverride(sessionId, index, fieldPath, value)
  -> electron/main.ts 'claim:setFieldOverride' handler
       - validates fieldPath against src/model/editableFields.ts's registry
       - validates+normalizes `value` on a disposable clone (rejects with a
         user-facing message before persisting anything invalid)
       - correctedClaimStore.setFieldOverride(userData, sourceFilePath,
         sourceFileHash=CURRENT hash, "${index}::${fieldPath}", value)
       - session.correctedClaimStatus = 'applied'
       - returns a freshly-recomputed ClaimDetailDto (see below)
  <- inspector.ts repaints from the returned DTO (no separate re-fetch)
```

`ClaimDetailDto` (`electron/preload.ts` / `electron/main.ts`) is extended
with four fields, all computed by a new `buildEffectiveClaimDetail` in main:

- `editableFieldPaths: string[]` — every field this CLAIM could have an
  override for (from the registry), regardless of whether it currently does;
  lets the inspector show a pencil on an un-edited row too.
- `edits: Array<{ fieldPath, label, originalValue, currentValue }>` — one
  entry per field that currently HAS an override; carries the original value
  forward so it's never lost (invariant 5).
- `editedFieldCount: number` — `edits.length`, duplicated for convenience.
- `correctedClaimStatus: 'none' | 'applied' | 'stale'` — session-level (not
  per-claim), surfaced once per tab as a banner when `'stale'`.

Every scalar VALUE elsewhere in the DTO (`patient.accountNumber`,
`serviceLines[i].charge`, etc.) is built from the **effective claim** —
`src/model/editableFields.ts`'s `applyFieldOverrides(original, overrides)`
applied to a **fresh clone** of the original parsed `Claim` (a plain
JSON-round-trip deep clone, `cloneClaim` — not `structuredClone`, whose type
declarations live only in DOM/webworker `lib`s this package's Node-only
`tsconfig.json` doesn't include). **`original.warnings` is never read by
`applyFieldOverrides`'s mutation step**, so the effective claim's `warnings`
array is always byte-identical, in content, to what the original parse
produced — this is *why* invariant 4 holds structurally rather than by
convention: there is no code path that recomputes warnings from edited
values, because nothing in the override-apply step ever touches that array.

This same `buildEffectiveClaimDetail`/`getEffectiveClaim` pair backs
`claim:getDetail` (inspector), `claim:getPdf` (on-screen preview — rendered
from the effective claim too, so the preview is WYSIWYG with what an export
would currently produce, though **without** the mandatory stamp, since a
preview is not an export), and `dialog:exportPdf` (which additionally
supplies `provenance.edited`/`editedFieldCount`, see §5). The ORIGINAL
`Claim[]` array held in the in-memory `ClaimSession` is never mutated by any
of these — `applyFieldOverrides` always works on a clone.

## 5. Staleness detection

On every `openClaimAtPath` (fresh open, not the "already open, reuse
session" path), main hashes the just-read file (as it already did for Build
3.3's provenance) and looks up `corrected-claims.json` by the resolved path:

- No artifact -> `correctedClaimStatus: 'none'`.
- Artifact found, `artifact.sourceFileHash === freshHash` -> `'applied'`:
  its overrides are read and applied on every subsequent
  getDetail/getPdf/export for this session, automatically. This is not
  "blind" auto-apply — the hash match IS the proof this is the exact file
  version the edits were made against.
- Artifact found, hashes differ -> `'stale'`: overrides are **not** read into
  any effective claim (`getOverridesForSession` returns `{}` whenever status
  isn't `'applied'`) until the user acts. The renderer shows a dismissible
  banner: *"Saved edits exist for a different version of this file."* with a
  **Discard saved edits** button (`claimApi.discardStaleOverrides`, which
  deletes the whole artifact for that path) and a **Dismiss** button that
  just hides the banner for this session — the artifact is left alone,
  investigable later (by re-opening the same stale file, or by inspecting
  `corrected-claims.json` directly) rather than being force-deleted.

Writing a fresh override always re-stamps `sourceFileHash` to the CURRENT
file's hash (`correctedClaimStore.setFieldOverride`), so continuing to edit
against today's file naturally un-stales an artifact — there is no separate
"resolve staleness" action needed for that path.

## 6. Mandatory export indicator — wired through the provenance-footer plumbing

`RenderProvenance` (`src/render/provenance.ts`) gains two REQUIRED fields:
`edited: boolean` and `editedFieldCount: number`. Required, not optional, so
every call site is forced to decide them explicitly — there is exactly one
call site, `electron/main.ts`'s `dialog:exportPdf` handler, which sets them
from `applyFieldOverrides`'s own return value (`applied.length`). The two
pre-existing test fixtures (`test/provenance.test.ts`,
`test/golden/render.test.ts`) were updated to pass `edited: false,
editedFieldCount: 0`, which changes **nothing** about their rendered bytes —
see below.

`provenanceFooterLines` (still pure, string-only) PREPENDS one extra line —
`"EDITED — N field(s) modified by user, see below"` — only when
`editedFieldCount > 0`; with `0` it returns exactly the same two lines, in
the same order, as before this feature. The shared drawing helper
(`drawProvenanceFooterLines`, new in `src/render/text.ts`, called identically
by all three renderers' `drawFooter`) draws that first line larger and in a
distinct color from the routine source/hash/timestamp lines, so it reads as
a stamp rather than metadata. It is **never** the only sentence in the
footer: the "UNVERIFIED FACSIMILE — NOT AN OFFICIAL FORM" /
"UNVERIFIED — NOT AN OFFICIAL ADA FORM" disclaimer is drawn unconditionally
by every renderer's footer regardless of `provenance` at all, so an edited
export always carries BOTH — see `test/provenance.test.ts`'s "EDITED stamp —
rendered output" describe block, which asserts both strings are present
together.

Because the stamp is additive-only and gated on `editedFieldCount > 0`, every
existing golden/determinism test (which never sets an override) renders
BYTE-IDENTICAL output — confirmed by `test/golden/render.test.ts` staying
green with no `UPDATE_GOLDENS=1` regeneration.

**Deferred (explicitly, per the task's own "if feasible" wording):**
per-box/per-field visual flagging on the rendered form itself (e.g. a
bordered box around an edited value). The page-level EDITED stamp is the
non-negotiable minimum and is fully implemented; individual box highlighting
would need per-box geometry plumbing this build doesn't have time to add
safely (it would also overlap with the still-droppable Build 3.4 "per-box
geometry" item, which was itself deferred in Build 3).

## 7. Undo / revert (invariant 8)

- **Revert one field**: the pencil-mode row for an edited field shows a
  "revert" icon instead of (or alongside) the edit pencil;
  `claimApi.revertFieldOverride(sessionId, index, fieldPath)` removes just
  that key from the artifact and returns the fresh DTO.
- **Clear all overrides for a claim**: a single "Revert all edits to this
  claim" action in the inspector (visible only when `editedFieldCount > 0`)
  calls `claimApi.clearOverridesForClaim(sessionId, index)`, which removes
  every `` `${index}::*` `` key for this claim only — other claims in the
  same batch file are untouched.

Neither action requires the user to know the artifact's file format, path,
or JSON shape — both are plain inspector buttons.

## 8. What shipped vs. deferred

**Shipped:** the full artifact/persistence layer with the allowlist test,
the curated editable-field registry (8 claim-level + 4 per-line + 1
per-diagnosis fields), staleness detection with a discard action, edit-mode
toggle preserving click-to-copy, per-field edited badge + revert + clear-all,
the mandatory EDITED export stamp on all three renderers, and e2e coverage
for entering edit mode, editing, reverting, exporting with the stamp, and
reopening to reload/detect staleness.

**Deferred, and why:** composed-field editing (name/address); institutional-
and dental-specific claim-level field edits (type of bill, discharge status,
condition/occurrence/value codes, dental transaction fields); per-box visual
flagging on the rendered form; adding/removing service lines or diagnoses
(only existing lines' fields are editable — the registry has nothing to
address a line that doesn't exist yet, which is itself a safety property:
you can correct what's there, not fabricate a new billed line). All of these
extend the SAME registry/artifact/IPC shape without requiring a redesign.
