import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

/**
 * Persistence for the "corrected claim" feature (docs/EDITABLE_FIELDS_DESIGN.md).
 * Electron-free, takes its base directory as a plain argument — same shape as
 * sessionStore.ts and the same single mechanism every `userData` writer in
 * this app uses (docs/BUILD_QUEUE.md rule 12). `electron/main.ts` is the ONLY
 * real caller, always passing `app.getPath('userData')`.
 *
 * THE ORIGINAL SOURCE CLAIM FILE IS NEVER OPENED FOR WRITING BY THIS MODULE
 * OR ANY CALLER OF IT — this file only ever reads/writes
 * `corrected-claims.json` under `userData`, a location entirely separate
 * from wherever the user's .837/.json source file lives. `sourceFilePath` is
 * stored here purely as a lookup key (mirroring sessionStore.ts's own
 * `filePath` fields) and staleness-check display value; it is never passed
 * to any `fs` write call in this file.
 *
 * One JSON file, keyed by the resolved source file path (the SAME identity
 * key `electron/main.ts`'s session map already uses for "is this file
 * already open" — see that file's `openClaimAtPath`), holding one artifact
 * per source file. A source .837 can be a BATCH of several claims, so a
 * single artifact's `fieldOverrides` map is keyed
 * `${claimIndex}::${fieldPath}` — the claim index is part of the key
 * precisely so an override on claim 3 of a batch can never collide with the
 * "same" field path on claim 0 (see docs/EDITABLE_FIELDS_DESIGN.md's
 * addressing scheme).
 *
 * Staleness: `sourceFileHash` is the sha256 of the source file's bytes at
 * the time the override was LAST WRITTEN. `electron/main.ts` compares this
 * against a freshly-computed hash every time the file is opened; a mismatch
 * means the on-disk file has changed since these overrides were saved, and
 * main must surface that rather than silently applying them (see this
 * module's `getArtifact` — it returns the stored hash as-is and does no
 * comparison itself; the comparison is main's responsibility, since only
 * main has the freshly-read file's bytes).
 */

export const CORRECTED_CLAIMS_FILE_NAME = 'corrected-claims.json';

export interface CorrectedClaimArtifact {
  schemaVersion: 1;
  sourceFilePath: string;
  /** Hex SHA-256 of the source file's bytes as of the last write to this artifact. */
  sourceFileHash: string;
  createdAt: string;
  updatedAt: string;
  /** `${claimIndex}::${fieldPath}` -> raw string value the user entered (already validated by src/model/editableFields.ts's `setValue` at write time). */
  fieldOverrides: Record<string, string>;
}

export interface CorrectedClaimsFile {
  schemaVersion: 1;
  /** Keyed by resolved source file path. */
  artifacts: Record<string, CorrectedClaimArtifact>;
}

const EMPTY_FILE: CorrectedClaimsFile = { schemaVersion: 1, artifacts: {} };

function isFieldOverridesRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value as Record<string, unknown>).every((v) => typeof v === 'string');
}

function isArtifact(value: unknown): value is CorrectedClaimArtifact {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['sourceFilePath'] === 'string' &&
    typeof v['sourceFileHash'] === 'string' &&
    typeof v['createdAt'] === 'string' &&
    typeof v['updatedAt'] === 'string' &&
    isFieldOverridesRecord(v['fieldOverrides'])
  );
}

/** Defensive parse of whatever is on disk — a hand-edited, corrupted, or future-version file must never crash the app; anything that doesn't look right is dropped (same posture as sessionStore.ts's `sanitize`). */
function sanitize(raw: unknown): CorrectedClaimsFile {
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_FILE, artifacts: {} };
  const r = raw as Record<string, unknown>;
  const rawArtifacts = r['artifacts'];
  const artifacts: Record<string, CorrectedClaimArtifact> = {};
  if (typeof rawArtifacts === 'object' && rawArtifacts !== null) {
    for (const [key, value] of Object.entries(rawArtifacts as Record<string, unknown>)) {
      if (isArtifact(value)) artifacts[key] = value;
    }
  }
  return { schemaVersion: 1, artifacts };
}

function filePath(baseDir: string): string {
  return join(baseDir, CORRECTED_CLAIMS_FILE_NAME);
}

export async function loadCorrectedClaimsFile(baseDir: string): Promise<CorrectedClaimsFile> {
  const target = filePath(baseDir);
  if (!existsSync(target)) return { ...EMPTY_FILE, artifacts: {} };
  try {
    const text = await readFile(target, 'utf8');
    return sanitize(JSON.parse(text));
  } catch {
    return { ...EMPTY_FILE, artifacts: {} };
  }
}

/** Write-then-rename, same discipline as sessionStore.ts's `writeSessionAtomic` / electron/main.ts's export `writeFileAtomic`. */
async function writeAtomic(baseDir: string, data: CorrectedClaimsFile): Promise<void> {
  await mkdir(baseDir, { recursive: true });
  const target = filePath(baseDir);
  const tempPath = join(baseDir, `.${CORRECTED_CLAIMS_FILE_NAME}.${randomUUID()}.tmp`);
  await writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
  try {
    await rename(tempPath, target);
  } catch (err) {
    await unlink(tempPath).catch(() => {});
    throw err;
  }
}

/** The saved artifact for `sourceFilePath`, or `null` if none exists. Does NOT compare hashes — see this file's header. */
export async function getArtifact(baseDir: string, sourceFilePath: string): Promise<CorrectedClaimArtifact | null> {
  const file = await loadCorrectedClaimsFile(baseDir);
  return file.artifacts[sourceFilePath] ?? null;
}

/**
 * Sets (creates or updates) one field override. `sourceFileHash` is always
 * the CURRENT hash of the file as main just parsed it — writing an override
 * therefore also re-validates the artifact against the current file
 * (an artifact that was "stale" relative to an old edit becomes current
 * again the moment the user edits against today's file), which is a
 * deliberate, documented simplification (see docs/EDITABLE_FIELDS_DESIGN.md)
 * rather than a staleness bug: a fresh edit can only ever be made against
 * whatever main just parsed.
 */
export async function setFieldOverride(
  baseDir: string,
  sourceFilePath: string,
  sourceFileHash: string,
  fieldKey: string,
  value: string,
): Promise<CorrectedClaimArtifact> {
  const file = await loadCorrectedClaimsFile(baseDir);
  const now = new Date().toISOString();
  const existing = file.artifacts[sourceFilePath];
  const artifact: CorrectedClaimArtifact = {
    schemaVersion: 1,
    sourceFilePath,
    sourceFileHash,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    fieldOverrides: { ...(existing?.fieldOverrides ?? {}), [fieldKey]: value },
  };
  const artifacts = { ...file.artifacts, [sourceFilePath]: artifact };
  await writeAtomic(baseDir, { schemaVersion: 1, artifacts });
  return artifact;
}

/** Removes one field override. Deletes the artifact entirely once it has no overrides left. Returns the (possibly now-deleted) artifact's new state, or `null` if nothing existed for this path or it was just deleted. */
export async function removeFieldOverride(baseDir: string, sourceFilePath: string, fieldKey: string): Promise<CorrectedClaimArtifact | null> {
  const file = await loadCorrectedClaimsFile(baseDir);
  const existing = file.artifacts[sourceFilePath];
  if (!existing) return null;
  const fieldOverrides = { ...existing.fieldOverrides };
  delete fieldOverrides[fieldKey];
  const artifacts = { ...file.artifacts };
  if (Object.keys(fieldOverrides).length === 0) {
    delete artifacts[sourceFilePath];
    await writeAtomic(baseDir, { schemaVersion: 1, artifacts });
    return null;
  }
  const updated: CorrectedClaimArtifact = { ...existing, fieldOverrides, updatedAt: new Date().toISOString() };
  artifacts[sourceFilePath] = updated;
  await writeAtomic(baseDir, { schemaVersion: 1, artifacts });
  return updated;
}

/** Clears every override belonging to ONE claim (by its index within the source file) — "revert all edits" for that claim (invariant 8), leaving any other claim's overrides in the same batch file untouched. */
export async function clearOverridesForClaim(baseDir: string, sourceFilePath: string, claimIndex: number): Promise<CorrectedClaimArtifact | null> {
  const file = await loadCorrectedClaimsFile(baseDir);
  const existing = file.artifacts[sourceFilePath];
  if (!existing) return null;
  const prefix = `${claimIndex}::`;
  const fieldOverrides = Object.fromEntries(Object.entries(existing.fieldOverrides).filter(([k]) => !k.startsWith(prefix)));
  const artifacts = { ...file.artifacts };
  if (Object.keys(fieldOverrides).length === 0) {
    delete artifacts[sourceFilePath];
    await writeAtomic(baseDir, { schemaVersion: 1, artifacts });
    return null;
  }
  const updated: CorrectedClaimArtifact = { ...existing, fieldOverrides, updatedAt: new Date().toISOString() };
  artifacts[sourceFilePath] = updated;
  await writeAtomic(baseDir, { schemaVersion: 1, artifacts });
  return updated;
}

/** Deletes the WHOLE artifact for `sourceFilePath` (every claim in that file) — the "discard saved edits" action offered when a stale artifact is detected (docs/EDITABLE_FIELDS_DESIGN.md's staleness flow). */
export async function clearArtifact(baseDir: string, sourceFilePath: string): Promise<void> {
  const file = await loadCorrectedClaimsFile(baseDir);
  if (!(sourceFilePath in file.artifacts)) return;
  const artifacts = { ...file.artifacts };
  delete artifacts[sourceFilePath];
  await writeAtomic(baseDir, { schemaVersion: 1, artifacts });
}

/** The overrides belonging to one claim index, with the `${claimIndex}::` key prefix already stripped down to plain `fieldPath`s — the shape src/model/editableFields.ts's `applyFieldOverrides` consumes directly. */
export function overridesForClaimIndex(artifact: CorrectedClaimArtifact | null, claimIndex: number): Record<string, string> {
  if (!artifact) return {};
  const prefix = `${claimIndex}::`;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(artifact.fieldOverrides)) {
    if (key.startsWith(prefix)) result[key.slice(prefix.length)] = value;
  }
  return result;
}
