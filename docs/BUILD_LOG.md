# Build log — the single morning report

This is the **only** morning report for the 2026-07-27 22:00 unattended run. It is
written **only by the main model** (never delegated to a subagent — see
`BUILD_QUEUE.md` rule 2). There is no separate `AUDIT_TABS.md` or per-build audit
file: each build's adversarial-audit synthesis lives inside that build's section
below, as an "Audit findings" subsection.

A `## Build N` section is appended at the **start** of each build, marked
`STATUS: IN PROGRESS`, and updated to `STATUS: GREEN` (or `STATUS: STOPPED` — see
`BUILD_QUEUE.md` rules 1/3/9) at the end. If the chain stops mid-run for any reason
(red repo, wall-clock cutoff, usage exhaustion), the last section written says so
plainly, including the abandoned commit SHA if `git reset --hard` was used.

Baseline: tag `build-0-green` at commit `c1d4316` (pre-queue green: v2 shipped,
104 vitest + 4 E2E, `npm run verify` green).

---

## Per-build section template

Copy this block for each build.

```
## Build N — <name>
STATUS: IN PROGRESS | GREEN | STOPPED

Start: <timestamp>          End: <timestamp>
Commit: <SHA>                Tag: build-N-green

### What shipped
- <bullet list, one line per sub-item, e.g. "3.1(a-g) — extended structural
  warnings, all seven codes documented in the copy file">

### Not done and why
- <sub-item> — <one-line reason> (per BUILD_QUEUE.md rule 9/10)

### Verification
- typecheck: <pass/fail>
- vitest: <count before> -> <count after>, <pass/fail>
- E2E: <count before> -> <count after>, <pass/fail>
- Playwright flake retried? <yes/no — BUILD_QUEUE.md rule 11>
- exe (if this build packed one): <path> · <timestamp> · SHA-256 <hash>

### Preload/IPC surface changes (rule 7b)
- <key added> — <preload / main / global.d.ts / e2e/app.spec.ts all updated? y/n>

### Screenshots added
- <path> — <what it shows>

### Audit findings (if this build ran Phase 3/4 verification)
- <dimension> — CONFIRMED/REFUTED/ALREADY-ACCEPTED — <finding> — <fix status>

### Unverified
- <anything reported UNVERIFIED per BUILD_QUEUE.md Build 0's fixture note, or
  anything that could not be checked without a human/display>

### Deferred / failed
- <item> — <deferred to which future build, or why it failed>

### Golden/goldens regenerated (only if guardrail 8 was in play — Builds 3/4/6)
- <commit titled "goldens: regenerate for <item>"> — <what moved and why>
```

---

## Build 0 — pre-flight

STATUS: PARTIAL (human task, not part of the unattended chain — see
`BUILD_QUEUE.md`'s Build 0 section for the live checklist)

- [DONE] `git init`
- [DONE] Baseline commit `c1d4316`, tag `build-0-green`
- [DONE] `docs/BUILD_LOG.md` created (this file)
- [ ] Remaining Build 0 items (script split, large fixtures, font pre-staging,
  final `npm run verify` gate) — see `docs/BUILD_QUEUE.md` for the live checklist;
  this section gets updated when they're done, before the 22:00 run starts.

---

<!-- Build 1's "## Build 1 — Tabs + polish" section starts here when the run begins. -->

---

## Build 1 — Tabs + polish + fonts + version stamp + clipboard/copy suite
STATUS: GREEN

Start: 2026-07-28 07:30 EDT        End: 2026-07-28 11:15 EDT
Commit: 7a38745                    Tag: build-1-green

**Note on scheduling:** the 2026-07-27 22:00 unattended run **never executed**. The
task fired on time (`lastRunAt` 22:00:47) but the Claude Code process exited straight
after, so nothing landed — no commits past `build-0-preflight-green`, no tags, no
screenshots. The repo was verified clean and green before restarting, and Build 1 was
run in the foreground with Niall present instead, with screenshots reviewed as they
appeared rather than in a morning report.

### What shipped
- **E2E profile isolation** (`4760d65`) — per-launch `--user-data-dir`; the hard
  prerequisite for any userData writer.
- **Module split** (`a97fe15`) — `src/renderer/main.ts` 1,604 → 577 lines across
  dom/tabs/preview/inspector/overlays/shortcuts. Pure move; two circular imports
  resolved by dependency injection rather than mutual imports.
- **Multi-file tabs** (`735834e`) — main-process session Map keyed by sessionId,
  sessionId on every claim IPC, per-tab `TabState`, tab strip, Ctrl+Tab / Ctrl+W /
  Ctrl+1-7, same-file dedupe, background-tab release, shared-canvas render
  serialization with tab-stamped requests.
- **Clipboard/copy suite** (`73ac6d1`) — TSV service-line copy (Ctrl+Shift+C),
  click-to-copy inspector fields via a roving-tabindex composite, copy summary /
  warnings, severity glyph + word, reconciliation verdict, and seven plain-English
  warning explanations. *This is the item 38 of 50 reviewers asked for.*
- **Session restore + recent files + version stamp** (`4c1ec92`) — `session.json` in
  userData, lazy restore via `TabState.status`, About screen, and honest README/About
  data-policy wording.
- **Screenshot suite** (`dad6886`) — 15 images, excluded from the verify gate so a
  screenshot failure can never break the build.
- **About version fix** (`4a2ac7f`) — was displaying Electron's 43.2.0.
- **Bundled design fonts** (`e798776`) — Source Serif 4 / Open Sans / IBM Plex Mono,
  all confirmed inside the packaged asar.
- **Audit fixes** (`7a38745`) — all 10 MUST FIX items from `docs/AUDIT_BUILD1.md`.

### Audit findings
Six-dimension adversarial audit → `docs/AUDIT_BUILD1.md`: **33 CONFIRMED of 38**
verified. All eight §1 guardrails held. The verdict was **do not ship**, correctly:

- **BLOCKING** — background-tab pdf.js release was bypassed on every
  open-into-a-background-tab (`createTab` set `activeTabId` itself, so the release
  path saw no previous tab). The leak this build set out to fix was still leaking.
- **MAJOR** — a failed `claim:getPdf` left the tab describing one claim while the
  canvas showed another, and **export followed the wrong one**.
- **MAJOR** — restored-but-unloaded tabs escaped the same-file dedupe, producing two
  tabs sharing one sessionId; closing either broke the other.
- **MAJOR** — `role="tablist"` shipped with no keyboard handler at all.
- Plus focus loss on tab re-render, a Ctrl+Shift+C double-fire, modal stacking, and
  two test-integrity findings (a spec header claiming coverage that did not exist).

All fixed in `7a38745`, each with a test **confirmed to fail against the pre-fix
code**. The two verifications the plan mandated but that had never been built — a
pdf.js lifecycle test (via a new injectable `getDocument` seam in
`src/renderer/tabState.ts`) and `e2e/a11y.spec.ts` — landed with the fixes. Their
absence is precisely why the top two defects shipped.

### Not done and why
- The 13 SHOULD FIX items and remaining coverage gaps (F6 region cycling, dialog
  invoker focus restore, warning-explanation unit tests) — deferred to a later pass,
  all recorded in `docs/AUDIT_BUILD1.md`.
- Builds 2-6 not started; Build 1 was the stated deliverable.

### Verification
- typecheck: **pass** (3 configs)
- vitest: 104 → **134**, pass
- Playwright E2E: 4 → **28**, pass
- screenshots: 7 specs / 15 images, regenerated after the font swap
- exe: `release/837 Claim Viewer 0.0.1.exe` · 88.5 MB · unsigned (intended) ·
  2026-07-28 11:12 · SHA-256 `52F981CA80A178B05AEC0EB240B577A0`
- fonts verified inside the asar: 8 `.ttf` (5 UI + 3 DejaVu PDF)

### Preload/IPC surface changes (rule 7b)
- `closeSession`, `getInfo`, `getRestoreState`, `saveSession`, `forgetSession` —
  preload + main handler + types + `e2e/app.spec.ts`'s exact key-list assertion all
  updated together; the assertion was extended, never loosened.

### Needs Niall's eye
- The seven **warning explanations** (`src/renderer/warningExplanations.ts`) are
  first-draft copy, never reviewed — kept in one file so they can be reworded in one
  place. This is compliance-adjacent text the team will read.
- The **status-bar copy icon** is subtle; easy to make more prominent.
- **"Forget open tabs & recent files"** is a *clear now*, not a *stop remembering*
  toggle — normal tab activity re-persists afterwards. Matches the spec as written;
  confirm that is what was wanted.
