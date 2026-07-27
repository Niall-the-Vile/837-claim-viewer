# Claim Viewer

Offline, single-machine Windows desktop app (Electron) that opens **one claim at a time** — a
clearinghouse **JSON** claim (primary) or an **X12 837** file (secondary) — renders it as a faithful
facsimile of its paper form (**CMS-1500** / UB-04 / ADA dental), and exports that form to **PDF**.
View-only. No pricing, no network.

See `docs/` for the plan:
- `PLAN_REVISION_v2_JSON.md` — current build plan (JSON input, single-claim). **Start here.**
- `UI_REQUIREMENTS_v2_single_claim.md` — current UI/design spec (design handoff).
- `BUILD_PLAN.md`, `UI_REQUIREMENTS.md` — earlier hardened X12/batch versions (historical).

## Status
- **Core engine (design-independent): working + tested.**
  - `src/model/claim.ts` — normalized, source-agnostic claim model.
  - `src/sources/claimSource.ts` — `ClaimSource` interface (JSON now, X12 later).
  - `src/sources/json/jsonClaimSource.ts` — flat clearinghouse JSON → model + non-blocking validation
    (charge/total reconciliation, dangling diagnosis pointers, NPI Luhn, diagnosis overflow).
  - Verified against the 5 real sample claims (locally) and a synthetic fixture (`test/`).
- **Next:** CMS-1500 self-authored template + coordinate map → pdf-lib render → pdf.js preview;
  Electron shell; then the UI (pending the design), then the X12 837 source (M3) and UB-04/dental (M4).

## Develop
```
npm install
npm run typecheck
npm test
```

## PHI / data policy
Real claim files are **PHI** and must never be committed. Only **synthetic** fixtures live in
`test/fixtures/`. `.gitignore` also excludes `/private-samples/` and `*.phi.json`.
