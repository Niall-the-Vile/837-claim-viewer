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
