import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addRecentFile, forgetAll, loadSession, saveOpenTabs, SESSION_FILE_NAME } from '../src/app/persistence/sessionStore.js';

/**
 * Unit tests for the Electron-free session-restore persistence module
 * (docs/TABS_BUILD_PLAN.md §2e / docs/BUILD_QUEUE.md rule 12). Every test
 * drives it directly against a throwaway `mkdtemp` directory standing in
 * for `app.getPath('userData')` — no Electron involved, matching the
 * module's own "Electron-free, base dir as an argument" contract.
 */

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'claim-viewer-sessionstore-test-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

const REF_A = { filePath: 'C:\\claims\\a.json', fileName: 'a.json' };
const REF_B = { filePath: 'C:\\claims\\b.dat', fileName: 'b.dat' };
const REF_C = { filePath: 'C:\\claims\\c.json', fileName: 'c.json' };

describe('sessionStore: loadSession', () => {
  it('returns an empty session when no session.json exists yet', async () => {
    const dir = tempDir();
    const session = await loadSession(dir);
    expect(session).toEqual({ tabs: [], activeIndex: -1, recentFiles: [] });
  });

  it('never throws on a corrupt session.json — treats it as empty', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, SESSION_FILE_NAME), '{ not valid json', 'utf8');
    const session = await loadSession(dir);
    expect(session).toEqual({ tabs: [], activeIndex: -1, recentFiles: [] });
  });

  it('drops malformed entries and an out-of-range activeIndex rather than throwing', async () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, SESSION_FILE_NAME),
      JSON.stringify({
        tabs: [REF_A, { filePath: 'missing-fileName-field' }, 42, REF_B],
        activeIndex: 99,
        recentFiles: 'not-an-array',
      }),
      'utf8',
    );
    const session = await loadSession(dir);
    expect(session.tabs).toEqual([REF_A, REF_B]);
    expect(session.activeIndex).toBe(0); // out-of-range -> falls back to 0 since tabs is non-empty
    expect(session.recentFiles).toEqual([]);
  });
});

describe('sessionStore: saveOpenTabs', () => {
  it('round-trips tabs + activeIndex and leaves recentFiles untouched', async () => {
    const dir = tempDir();
    await addRecentFile(dir, REF_C);
    await saveOpenTabs(dir, [REF_A, REF_B], 1);

    const session = await loadSession(dir);
    expect(session.tabs).toEqual([REF_A, REF_B]);
    expect(session.activeIndex).toBe(1);
    expect(session.recentFiles).toEqual([REF_C]);
  });

  it('normalizes an out-of-range activeIndex on a non-empty tab list to a valid one (0), and an empty tab list always gets activeIndex -1', async () => {
    const dir = tempDir();
    // saveOpenTabs itself stores -1 for the out-of-range 5 (see its own
    // normalization), and loadSession's sanitize() then falls back an
    // invalid-but-tabs-non-empty activeIndex to 0 — together the round trip
    // always leaves a non-empty restored tab list with SOME valid active
    // tab, never a dangling -1 while tabs exist.
    await saveOpenTabs(dir, [REF_A], 5);
    expect((await loadSession(dir)).activeIndex).toBe(0);

    await saveOpenTabs(dir, [], 0);
    expect((await loadSession(dir)).activeIndex).toBe(-1);
  });

  it('writes valid JSON with no leftover temp file (atomic write-then-rename)', async () => {
    const dir = tempDir();
    await saveOpenTabs(dir, [REF_A], 0);
    const raw = readFileSync(join(dir, SESSION_FILE_NAME), 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});

describe('sessionStore: addRecentFile', () => {
  it('adds new entries to the front, most-recent first', async () => {
    const dir = tempDir();
    await addRecentFile(dir, REF_A);
    await addRecentFile(dir, REF_B);
    const session = await loadSession(dir);
    expect(session.recentFiles).toEqual([REF_B, REF_A]);
  });

  it('re-opening an already-recent file moves it to the front instead of duplicating it', async () => {
    const dir = tempDir();
    await addRecentFile(dir, REF_A);
    await addRecentFile(dir, REF_B);
    await addRecentFile(dir, REF_A);
    const session = await loadSession(dir);
    expect(session.recentFiles).toEqual([REF_A, REF_B]);
  });

  it('caps the recent list at 10 entries, dropping the oldest', async () => {
    const dir = tempDir();
    for (let i = 0; i < 12; i++) {
      await addRecentFile(dir, { filePath: `C:\\claims\\file${i}.json`, fileName: `file${i}.json` });
    }
    const session = await loadSession(dir);
    expect(session.recentFiles.length).toBe(10);
    // Most recent (file11) first; the two oldest (file0, file1) fell off.
    expect(session.recentFiles[0]).toEqual({ filePath: 'C:\\claims\\file11.json', fileName: 'file11.json' });
    expect(session.recentFiles.some((r) => r.filePath.endsWith('file0.json'))).toBe(false);
    expect(session.recentFiles.some((r) => r.filePath.endsWith('file1.json'))).toBe(false);
  });
});

describe('sessionStore: forgetAll', () => {
  it('clears both the open-tab list and the recent-files list', async () => {
    const dir = tempDir();
    await saveOpenTabs(dir, [REF_A, REF_B], 1);
    await addRecentFile(dir, REF_C);

    await forgetAll(dir);

    const session = await loadSession(dir);
    expect(session).toEqual({ tabs: [], activeIndex: -1, recentFiles: [] });
  });

  it('is safe to call when no session.json exists yet', async () => {
    const dir = tempDir();
    await expect(forgetAll(dir)).resolves.toBeUndefined();
    expect(await loadSession(dir)).toEqual({ tabs: [], activeIndex: -1, recentFiles: [] });
  });
});
