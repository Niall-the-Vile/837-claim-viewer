import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, appendFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Local, append-only, METADATA-ONLY audit log (Build 6 — Notes & audit;
 * docs/BUILD_QUEUE.md's Build 5.2 / docs/CLAUDE_CODE_NEXT_SESSION.md's
 * Build 6, for HIPAA accounting-of-disclosures purposes). Electron-free,
 * base directory as a plain argument — the same `userData`-writer shape as
 * sessionStore.ts/correctedClaimStore.ts (docs/BUILD_QUEUE.md rule 12).
 * `electron/main.ts` is the ONLY real caller, always passing
 * `app.getPath('userData')`.
 *
 * THIS MODULE MUST NEVER RECEIVE CLAIM CONTENT. Every field on
 * `AuditLogEntry` is metadata only: a timestamp, an OS username, a short
 * fixed action label, a file path (already-disclosed information — same
 * posture as sessionStore.ts's own stored paths, never claim CONTENT), a
 * HASHED claim identifier (never the raw claim id/control number), an
 * optional destination path, and the app version. `electron/main.ts`'s
 * `logAudit` helper hashes the claim identifier BEFORE calling
 * `appendEntry` — this module has no idea what a "claim" is, performs no
 * hashing itself, and its one exported interface has no field a `Claim`
 * object could even be assigned to. Session-scoped notes/flags
 * (src/model/annotations.ts) are a COMPLETELY SEPARATE, deliberately
 * never-persisted concern and never touch this module either.
 *
 * Format: JSON Lines (one JSON object per line), unlike session.json/
 * corrected-claims.json's single JSON document. An audit log is written far
 * more often than it's restructured, so every write here is a plain
 * `appendFile` — genuinely O(1) per entry — rather than this app's other
 * two userData writers' read-modify-write-the-whole-document-then-atomic-
 * rename pattern (correct for THEM, since a stray in-flight write racing a
 * rename would otherwise corrupt state that must always be read back as one
 * coherent object; wrong here, since it would mean rewriting a
 * multi-hundred-entry file on every single new entry). A process killed
 * mid-append can leave at most one trailing partial line, which
 * `readEntries` below defensively skips — same "never crash on a
 * corrupt/partial record" posture as sessionStore.ts's `sanitize` — rather
 * than losing or corrupting any earlier entry.
 *
 * Rotation/cap policy (documented per this build's task): the ACTIVE file
 * (`audit-log.jsonl`) is capped at `ROTATE_AFTER_ENTRIES` (200) entries.
 * Once an append would exceed that, the WHOLE active file is renamed to one
 * archived generation (`audit-log.old.jsonl`, overwriting whatever was
 * there before) and a fresh active file starts empty with just the new
 * entry. This bounds total on-disk size to roughly 2 x 200 entries x
 * ~200 bytes/entry ≈ 80 KB — generous for a single reviewer's daily use,
 * deliberately small so the active-file entry count check below (a plain
 * read + line count, not a maintained in-memory counter, so it stays
 * correct even across separate app launches without its own persisted
 * state) stays cheap. Exactly two, STATICALLY NAMED files — never an
 * unbounded or timestamp-named series — so
 * `test/persisted-artifacts.test.ts`'s `ALLOWED_USERDATA_FILES` allowlist
 * (rule 12) can name both literally, the same as every other userData
 * writer in this app. `readEntries` (the About screen's viewer) reads both
 * files, oldest overall entries first.
 */

export const AUDIT_LOG_FILE_NAME = 'audit-log.jsonl';
export const AUDIT_LOG_OLD_FILE_NAME = 'audit-log.old.jsonl';

/** See this file's header for the sizing rationale. */
export const ROTATE_AFTER_ENTRIES = 200;

export interface AuditLogEntry {
  /** ISO-8601 UTC timestamp of the action. */
  timestamp: string;
  /** OS username (`node:os` `userInfo().username`, read in electron/main.ts) — NOT a login to this app; there is no account system. */
  user: string;
  /** Short, fixed action label — e.g. "opened claim", "exported PDF", "exported batch PDF", "exported CSV", "exported JSON", "exported X12". Never free text derived from claim content. */
  action: string;
  /** The source claim file's resolved path — already-disclosed information, same posture as sessionStore.ts's stored file paths. Never claim CONTENT. */
  sourcePath: string;
  /** Hex SHA-256 of a claim-identifying value — NEVER the raw claim id/control number itself. Hashed by the caller (electron/main.ts) before this module ever sees it. */
  hashedClaimId: string;
  /** The export destination path, or `null` for a non-export action (e.g. "opened claim"). */
  destinationPath: string | null;
  appVersion: string;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v !== '';
}

/** Defensive validation of one parsed JSONL line — same "never trust what's on disk" posture as sessionStore.ts's `sanitize`/correctedClaimStore.ts's `isArtifact`. */
function isValidEntry(value: unknown): value is AuditLogEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isNonEmptyString(v['timestamp']) &&
    isNonEmptyString(v['user']) &&
    isNonEmptyString(v['action']) &&
    isNonEmptyString(v['sourcePath']) &&
    isNonEmptyString(v['hashedClaimId']) &&
    (v['destinationPath'] === null || typeof v['destinationPath'] === 'string') &&
    isNonEmptyString(v['appVersion'])
  );
}

function activePath(baseDir: string): string {
  return join(baseDir, AUDIT_LOG_FILE_NAME);
}
function oldPath(baseDir: string): string {
  return join(baseDir, AUDIT_LOG_OLD_FILE_NAME);
}

/** Parses one JSONL file's text into validated entries, silently dropping any blank/malformed/partial trailing line — never throws. */
function parseJsonl(text: string): AuditLogEntry[] {
  const entries: AuditLogEntry[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isValidEntry(parsed)) entries.push(parsed);
    } catch {
      // Partial trailing line from a killed process, or hand-edited
      // corruption — dropped, never fatal (see this file's header).
    }
  }
  return entries;
}

async function readJsonlFile(target: string): Promise<AuditLogEntry[]> {
  if (!existsSync(target)) return [];
  try {
    return parseJsonl(await readFile(target, 'utf8'));
  } catch {
    return [];
  }
}

async function countActiveLines(baseDir: string): Promise<number> {
  const target = activePath(baseDir);
  if (!existsSync(target)) return 0;
  try {
    const text = await readFile(target, 'utf8');
    return text.split('\n').filter((l) => l.trim() !== '').length;
  } catch {
    return 0;
  }
}

/**
 * Appends one entry, rotating the active file first if it has already
 * reached `ROTATE_AFTER_ENTRIES` (see this file's header). Every real call
 * site (electron/main.ts's `logAudit`) wraps this in its own try/catch — an
 * audit-log write failure must never block the user-visible action it's
 * recording — but this function itself still surfaces a genuine filesystem
 * error rather than swallowing it, so a test can tell "wrote fine" apart
 * from "silently did nothing".
 */
export async function appendEntry(baseDir: string, entry: AuditLogEntry): Promise<void> {
  await mkdir(baseDir, { recursive: true });
  const target = activePath(baseDir);
  if ((await countActiveLines(baseDir)) >= ROTATE_AFTER_ENTRIES) {
    // Rotate: the whole active file becomes the one archived generation,
    // overwriting any previous one — see this file's header for why this
    // (rather than a growing series of timestamped files) is the chosen cap.
    if (existsSync(target)) {
      await unlink(oldPath(baseDir)).catch(() => {});
      await rename(target, oldPath(baseDir));
    }
  }
  await appendFile(target, `${JSON.stringify(entry)}\n`, 'utf8');
}

/** Every entry from both the active and (if present) archived file, oldest overall entries first — the About screen's audit-log viewer (and this app's only other reader) uses this directly. */
export async function readEntries(baseDir: string): Promise<AuditLogEntry[]> {
  const old = await readJsonlFile(oldPath(baseDir));
  const active = await readJsonlFile(activePath(baseDir));
  return [...old, ...active];
}
