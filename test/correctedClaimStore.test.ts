import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getArtifact,
  setFieldOverride,
  removeFieldOverride,
  clearOverridesForClaim,
  clearArtifact,
  overridesForClaimIndex,
  loadCorrectedClaimsFile,
} from '../src/app/persistence/correctedClaimStore.js';

/** Unit tests for the corrected-claim persistence module — Electron-free, same style as test/sessionStore.test.ts. */

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'claim-viewer-corrected-claims-test-'));
}

describe('correctedClaimStore', () => {
  it('getArtifact returns null when nothing has been saved yet', async () => {
    const dir = tempDir();
    try {
      expect(await getArtifact(dir, join(dir, 'some-claim.json'))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('setFieldOverride creates an artifact, and a second call to a different key merges rather than overwrites', async () => {
    const dir = tempDir();
    try {
      const sourcePath = join(dir, '..', 'src', 'claim.json');
      const hash = 'a'.repeat(64);
      await setFieldOverride(dir, sourcePath, hash, '0::patient.accountNumber', 'ACCT-9');
      const artifact = await setFieldOverride(dir, sourcePath, hash, '0::billingProvider.npi', '1234567893');

      expect(artifact.sourceFilePath).toBe(sourcePath);
      expect(artifact.sourceFileHash).toBe(hash);
      expect(artifact.fieldOverrides).toEqual({
        '0::patient.accountNumber': 'ACCT-9',
        '0::billingProvider.npi': '1234567893',
      });
      expect(new Date(artifact.createdAt).getTime()).toBeLessThanOrEqual(new Date(artifact.updatedAt).getTime());

      const reloaded = await getArtifact(dir, sourcePath);
      expect(reloaded).toEqual(artifact);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('overwriting an existing key replaces just that value', async () => {
    const dir = tempDir();
    try {
      const sourcePath = join(dir, 'claim.json');
      await setFieldOverride(dir, sourcePath, 'h1', '0::patient.accountNumber', 'FIRST');
      const artifact = await setFieldOverride(dir, sourcePath, 'h1', '0::patient.accountNumber', 'SECOND');
      expect(artifact.fieldOverrides['0::patient.accountNumber']).toBe('SECOND');
      expect(Object.keys(artifact.fieldOverrides)).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('removeFieldOverride removes one key and deletes the artifact once empty', async () => {
    const dir = tempDir();
    try {
      const sourcePath = join(dir, 'claim.json');
      await setFieldOverride(dir, sourcePath, 'h1', '0::patient.accountNumber', 'A');
      await setFieldOverride(dir, sourcePath, 'h1', '0::insured.memberId', 'B');

      const afterOne = await removeFieldOverride(dir, sourcePath, '0::patient.accountNumber');
      expect(afterOne?.fieldOverrides).toEqual({ '0::insured.memberId': 'B' });

      const afterAll = await removeFieldOverride(dir, sourcePath, '0::insured.memberId');
      expect(afterAll).toBeNull();
      expect(await getArtifact(dir, sourcePath)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('clearOverridesForClaim only removes the given claim index, leaving other claims in a batch file untouched', async () => {
    const dir = tempDir();
    try {
      const sourcePath = join(dir, 'batch.dat');
      await setFieldOverride(dir, sourcePath, 'h1', '0::patient.accountNumber', 'CLAIM0');
      await setFieldOverride(dir, sourcePath, 'h1', '1::patient.accountNumber', 'CLAIM1');

      const afterClear = await clearOverridesForClaim(dir, sourcePath, 0);
      expect(afterClear?.fieldOverrides).toEqual({ '1::patient.accountNumber': 'CLAIM1' });

      const gone = await clearOverridesForClaim(dir, sourcePath, 1);
      expect(gone).toBeNull();
      expect(await getArtifact(dir, sourcePath)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('clearArtifact deletes everything for one source file, leaving other files alone', async () => {
    const dir = tempDir();
    try {
      const pathA = join(dir, 'a.json');
      const pathB = join(dir, 'b.json');
      await setFieldOverride(dir, pathA, 'h1', '0::patient.accountNumber', 'A');
      await setFieldOverride(dir, pathB, 'h1', '0::patient.accountNumber', 'B');

      await clearArtifact(dir, pathA);
      expect(await getArtifact(dir, pathA)).toBeNull();
      expect(await getArtifact(dir, pathB)).not.toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('overridesForClaimIndex strips the claim-index prefix and only returns that claim\'s entries', async () => {
    const dir = tempDir();
    try {
      const sourcePath = join(dir, 'batch.dat');
      await setFieldOverride(dir, sourcePath, 'h1', '0::patient.accountNumber', 'CLAIM0');
      await setFieldOverride(dir, sourcePath, 'h1', '1::patient.accountNumber', 'CLAIM1');
      const artifact = await getArtifact(dir, sourcePath);

      expect(overridesForClaimIndex(artifact, 0)).toEqual({ 'patient.accountNumber': 'CLAIM0' });
      expect(overridesForClaimIndex(artifact, 1)).toEqual({ 'patient.accountNumber': 'CLAIM1' });
      expect(overridesForClaimIndex(artifact, 2)).toEqual({});
      expect(overridesForClaimIndex(null, 0)).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a malformed corrected-claims.json never throws — it resolves to an empty file', async () => {
    const dir = tempDir();
    try {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(join(dir, 'corrected-claims.json'), '{ not valid json', 'utf8');
      const file = await loadCorrectedClaimsFile(dir);
      expect(file).toEqual({ schemaVersion: 1, artifacts: {} });
      expect(await getArtifact(dir, join(dir, 'anything.json'))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('drops a malformed individual artifact entry rather than crashing the whole file', async () => {
    const dir = tempDir();
    try {
      const { writeFileSync, mkdirSync } = await import('node:fs');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'corrected-claims.json'),
        JSON.stringify({ schemaVersion: 1, artifacts: { '/some/path.json': { garbage: true } } }),
        'utf8',
      );
      const file = await loadCorrectedClaimsFile(dir);
      expect(file.artifacts).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
