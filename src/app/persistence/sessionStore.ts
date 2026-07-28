import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

/**
 * Session restore + recent files (docs/TABS_BUILD_PLAN.md §2e, an APPROVED
 * deliberate policy change) and the single persistence mechanism every
 * `userData` writer in this app uses (docs/BUILD_QUEUE.md rule 12):
 * Electron-free, takes its base directory as a plain argument, so it's
 * fully unit-testable without spinning up Electron (see test/sessionStore.test.ts)
 * and so a vitest run can drive it standalone the way
 * test/persisted-artifacts.test.ts does. `electron/main.ts` is the ONLY
 * caller in the real app — it passes `app.getPath('userData')` — and is the
 * only place a filesystem path from the renderer is ever trusted (every
 * path stored here already passed through main's own open-file validation
 * once, when the tab was first opened; see electron/main.ts's
 * `openClaimAtPath`/`hasAllowedOpenExtension`, and `session:getRestoreState`'s
 * re-validation of stored paths on the way back out).
 *
 * What is stored: file PATHS + tab order + which tab was active, plus a
 * capped recently-opened-files list. Claim CONTENT never passes through
 * this module — every function here takes/returns only `{ filePath,
 * fileName }` pairs, never a Claim or any field parsed from one.
 */

export const SESSION_FILE_NAME = 'session.json';

/** Recent-files list cap (docs/TABS_BUILD_PLAN.md §2e: "a capped list (10)"). */
const RECENT_FILES_CAP = 10;

export interface StoredFileRef {
  filePath: string;
  fileName: string;
}

export interface SessionData {
  /** Open tabs, in left-to-right order, as they should be restored. */
  tabs: StoredFileRef[];
  /** Index into `tabs` of the tab that was active, or -1 if none / no tabs. */
  activeIndex: number;
  /** Most-recently-opened first, capped at RECENT_FILES_CAP. */
  recentFiles: StoredFileRef[];
}

const EMPTY_SESSION: SessionData = { tabs: [], activeIndex: -1, recentFiles: [] };

function isStoredFileRef(value: unknown): value is StoredFileRef {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v['filePath'] === 'string' && v['filePath'] !== '' && typeof v['fileName'] === 'string';
}

/**
 * Defensive parse of whatever is on disk: a hand-edited, corrupted, or
 * future-version session.json must never crash startup (docs/TABS_BUILD_PLAN.md
 * §2e: "never fail startup on it") — anything that doesn't look right for a
 * given field is dropped/defaulted rather than thrown.
 */
function sanitize(raw: unknown): SessionData {
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_SESSION };
  const r = raw as Record<string, unknown>;

  const tabs = Array.isArray(r['tabs']) ? r['tabs'].filter(isStoredFileRef) : [];
  const recentFiles = (Array.isArray(r['recentFiles']) ? r['recentFiles'].filter(isStoredFileRef) : []).slice(0, RECENT_FILES_CAP);

  const rawActiveIndex = r['activeIndex'];
  const activeIndex =
    typeof rawActiveIndex === 'number' && Number.isInteger(rawActiveIndex) && rawActiveIndex >= 0 && rawActiveIndex < tabs.length
      ? rawActiveIndex
      : tabs.length > 0
        ? 0
        : -1;

  return { tabs, activeIndex, recentFiles };
}

function sessionFilePath(baseDir: string): string {
  return join(baseDir, SESSION_FILE_NAME);
}

/** Reads + validates session.json under `baseDir`. Missing file, unreadable file, or malformed JSON all resolve to an empty session rather than throwing. */
export async function loadSession(baseDir: string): Promise<SessionData> {
  const target = sessionFilePath(baseDir);
  if (!existsSync(target)) return { ...EMPTY_SESSION };
  try {
    const text = await readFile(target, 'utf8');
    return sanitize(JSON.parse(text));
  } catch {
    return { ...EMPTY_SESSION };
  }
}

/** Write-then-rename, same discipline as electron/main.ts's `writeFileAtomic` for exports, so a killed process never leaves a half-written session.json that the next launch's `loadSession` would choke on (it wouldn't — JSON.parse would just throw and sanitize's catch would swallow it — but atomicity keeps a partial write from ever landing at all). */
async function writeSessionAtomic(baseDir: string, data: SessionData): Promise<void> {
  await mkdir(baseDir, { recursive: true });
  const target = sessionFilePath(baseDir);
  const tempPath = join(baseDir, `.${SESSION_FILE_NAME}.${randomUUID()}.tmp`);
  await writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
  try {
    await rename(tempPath, target);
  } catch (err) {
    await unlink(tempPath).catch(() => {});
    throw err;
  }
}

/** Persists the current open-tab list + which one is active. Called on every tab open/close/activate (see electron/main.ts's `session:save` handler and src/renderer/main.ts's `persistSession`). Leaves `recentFiles` untouched. */
export async function saveOpenTabs(baseDir: string, tabs: StoredFileRef[], activeIndex: number): Promise<void> {
  const current = await loadSession(baseDir);
  const safeActiveIndex = tabs.length === 0 ? -1 : activeIndex >= 0 && activeIndex < tabs.length ? activeIndex : -1;
  await writeSessionAtomic(baseDir, { ...current, tabs, activeIndex: safeActiveIndex });
}

/** Records `entry` as the most-recently-opened file (moving it to the front if it was already present), capped at RECENT_FILES_CAP. Called once per successful open, whether that open created a brand-new tab or focused an already-open one (docs/TABS_BUILD_PLAN.md §2b dedupe) — both are "this file was just used". Leaves `tabs`/`activeIndex` untouched. */
export async function addRecentFile(baseDir: string, entry: StoredFileRef): Promise<void> {
  const current = await loadSession(baseDir);
  const deduped = current.recentFiles.filter((r) => r.filePath !== entry.filePath);
  const recentFiles = [entry, ...deduped].slice(0, RECENT_FILES_CAP);
  await writeSessionAtomic(baseDir, { ...current, recentFiles });
}

/** The File-menu "Forget open tabs & recent files" action (docs/TABS_BUILD_PLAN.md §2e): wipes both lists back to empty. Does not touch any tab currently open in a live window — only what would be restored/suggested on the NEXT launch. */
export async function forgetAll(baseDir: string): Promise<void> {
  await writeSessionAtomic(baseDir, { ...EMPTY_SESSION });
}
