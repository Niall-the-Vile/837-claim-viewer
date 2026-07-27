/**
 * Tiny manual-inspection CLI: reads a clearinghouse JSON claim file, renders
 * it to a CMS-1500 PDF via the same code path the app will use, and writes
 * `<claimid>.pdf` next to the chosen output directory.
 *
 * Usage: npm run render -- <path-to-claim.json> [output-dir]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { JsonClaimSource } from '../src/sources/json/jsonClaimSource.js';
import { renderCms1500 } from '../src/render/cms1500/renderCms1500.js';

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: npm run render -- <path-to-claim.json> [output-dir]');
    process.exitCode = 1;
    return;
  }
  const outDir = process.argv[3] ?? '.';

  const text = readFileSync(resolve(inputPath), 'utf8');
  const source = new JsonClaimSource();
  const [claim] = source.parse(text);
  if (!claim) {
    console.error('No claim found in the input file.');
    process.exitCode = 1;
    return;
  }

  const bytes = await renderCms1500(claim);

  mkdirSync(resolve(outDir), { recursive: true });
  const outPath = join(resolve(outDir), `${claim.claimId || 'claim'}.pdf`);
  writeFileSync(outPath, bytes);
  console.log(`Wrote ${outPath} (${bytes.length} bytes).`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
