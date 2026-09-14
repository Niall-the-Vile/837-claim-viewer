import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendEntry, readEntries, AUDIT_LOG_FILE_NAME, AUDIT_LOG_OLD_FILE_NAME, ROTATE_AFTER_ENTRIES, type AuditLogEntry } from '../src/app/persistence/auditLogStore.js';

/**
 * Unit tests for the Electron-free audit-log persistence module (Build 6 —
 * Notes & audit; docs/BUILD_QUEUE.md rule 12). Every test drives it
 * directly against a throwaway `mkdtemp` directory standing in for
 * `app.getPath('userData')` — no Electron involved, matching the module's
 * own "Electron-free, base dir as an argument" contract (same pattern as
 * test/sessionStore.test.ts / test/correctedClaimStore.test.ts).
 *
 * The specific "no claim content, ever, under any code path" guarantee has
 * its own dedicated, more elaborate test in
 * test/persisted-artifacts.test.ts (mirroring a realistic open/export
 * sequence with a real PHI canary) — this file covers the module's own
 * mechanics: round-tripping, defensive parsing of corrupt/partial content,
 * and the rotation policy's exact boundary behavior.
 */

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'claim-viewer-auditlog-test-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    timestamp: '2026-09-14T12:00:00.000Z',
    user: 'niall',
    action: 'opened claim',
    sourcePath: 'C:\\claims\\a.json',
    hashedClaimId: 'f'.repeat(64),
    destinationPath: null,
    appVersion: '0.0.1',
    ...overrides,
  };
}

describe('auditLogStore: readEntries', () => {
  it('returns an empty array when no audit-log files exist yet', async () => {
    const dir = tempDir();
    expect(await readEntries(dir)).toEqual([]);
  });

  it('round-trips a single appended entry exactly', async () => {
    const dir = tempDir();
    const entry = makeEntry();
    await appendEntry(dir, entry);
    expect(await readEntries(dir)).toEqual([entry]);
  });

  it('preserves append order across multiple entries (oldest first)', async () => {
    const dir = tempDir();
    await appendEntry(dir, makeEntry({ action: 'opened claim' }));
    await appendEntry(dir, makeEntry({ action: 'exported PDF' }));
    await appendEntry(dir, makeEntry({ action: 'exported CSV' }));
    const entries = await readEntries(dir);
    expect(entries.map((e) => e.action)).toEqual(['opened claim', 'exported PDF', 'exported CSV']);
  });

  it('never throws on a corrupt active file — malformed JSON lines are silently dropped', async () => {
    const dir = tempDir();
    await appendEntry(dir, makeEntry({ action: 'opened claim' }));
    // Hand-append a garbage line and a partial (killed-mid-write) trailing
    // line, same "never fail startup on it" posture as sessionStore.ts.
    const target = join(dir, AUDIT_LOG_FILE_NAME);
    const existing = readFileSync(target, 'utf8');
    writeFileSync(target, `${existing}not json at all\n{"timestamp":"2026-01-01T00:00:00Z","user":"x"`, 'utf8');
    const entries = await readEntries(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.action).toBe('opened claim');
  });

  it('rejects a line that parses as JSON but is missing a required field', async () => {
    const dir = tempDir();
    const target = join(dir, AUDIT_LOG_FILE_NAME);
    writeFileSync(target, `${JSON.stringify({ timestamp: 't', user: 'u', action: 'a', sourcePath: 's', appVersion: 'v' })}\n`, 'utf8'); // missing hashedClaimId/destinationPath
    expect(await readEntries(dir)).toEqual([]);
  });

  it('accepts destinationPath: null as valid (a non-export action)', async () => {
    const dir = tempDir();
    await appendEntry(dir, makeEntry({ destinationPath: null }));
    const [entry] = await readEntries(dir);
    expect(entry?.destinationPath).toBeNull();
  });

  it('reads BOTH the archived and active file, archived entries first', async () => {
    const dir = tempDir();
    for (let i = 0; i < ROTATE_AFTER_ENTRIES; i++) {
      await appendEntry(dir, makeEntry({ action: `pre-rotation-${i}` }));
    }
    // One more append rotates the now-full active file into .old and starts fresh.
    await appendEntry(dir, makeEntry({ action: 'post-rotation' }));
    const entries = await readEntries(dir);
    expect(entries).toHaveLength(ROTATE_AFTER_ENTRIES + 1);
    expect(entries[entries.length - 1]!.action).toBe('post-rotation');
    expect(entries[0]!.action).toBe('pre-rotation-0');
  });
});

describe('auditLogStore: rotation policy', () => {
  it('does not rotate before the cap is reached', async () => {
    const dir = tempDir();
    for (let i = 0; i < ROTATE_AFTER_ENTRIES - 1; i++) {
      await appendEntry(dir, makeEntry());
    }
    const active = readFileSync(join(dir, AUDIT_LOG_FILE_NAME), 'utf8');
    expect(active.split('\n').filter((l) => l.trim() !== '')).toHaveLength(ROTATE_AFTER_ENTRIES - 1);
    expect(() => readFileSync(join(dir, AUDIT_LOG_OLD_FILE_NAME), 'utf8')).toThrow();
  });

  it('rotates exactly once the active file already holds ROTATE_AFTER_ENTRIES entries, leaving the active file with just the new one', async () => {
    const dir = tempDir();
    for (let i = 0; i < ROTATE_AFTER_ENTRIES; i++) {
      await appendEntry(dir, makeEntry({ action: `entry-${i}` }));
    }
    await appendEntry(dir, makeEntry({ action: 'after-cap' }));

    const oldContent = readFileSync(join(dir, AUDIT_LOG_OLD_FILE_NAME), 'utf8');
    const oldLines = oldContent.split('\n').filter((l) => l.trim() !== '');
    expect(oldLines).toHaveLength(ROTATE_AFTER_ENTRIES);

    const activeContent = readFileSync(join(dir, AUDIT_LOG_FILE_NAME), 'utf8');
    const activeLines = activeContent.split('\n').filter((l) => l.trim() !== '');
    expect(activeLines).toHaveLength(1);
    expect(JSON.parse(activeLines[0]!).action).toBe('after-cap');
  });

  it('a SECOND rotation overwrites the previous archived generation rather than accumulating a third file', async () => {
    const dir = tempDir();
    for (let i = 0; i < 2 * ROTATE_AFTER_ENTRIES + 1; i++) {
      await appendEntry(dir, makeEntry({ action: `entry-${i}` }));
    }
    const oldContent = readFileSync(join(dir, AUDIT_LOG_OLD_FILE_NAME), 'utf8');
    const oldLines = oldContent.split('\n').filter((l) => l.trim() !== '');
    // The archived generation is the SECOND batch of ROTATE_AFTER_ENTRIES
    // (entries ROTATE_AFTER_ENTRIES..2*ROTATE_AFTER_ENTRIES-1), not the
    // first — proving the old file was overwritten, not appended to.
    expect(oldLines).toHaveLength(ROTATE_AFTER_ENTRIES);
    expect(JSON.parse(oldLines[0]!).action).toBe(`entry-${ROTATE_AFTER_ENTRIES}`);
  });
});
