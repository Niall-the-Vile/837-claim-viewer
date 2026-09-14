import { samplesListEl, welcomeSampleBtn } from '../dom.js';
import { openOverlay, closeOverlay } from '../overlays.js';
import type { SampleClaimDto } from '../../../electron/preload.js';

/**
 * Ease-of-use + accessibility batch, item 4 — bundled sample-claim set
 * (docs/FEATURE_BACKLOG.md #26 / docs/CLAUDE_CODE_NEXT_SESSION.md). The
 * welcome screen's "Open a sample claim…" link and File → "Open Sample
 * Claim…" both open the SAME #samplesOverlay dialog (main.ts's runAction
 * routes the menu action to openSamplesDialog too) — one list, one entry
 * point, backed by main's `src/model/sampleClaims.ts` registry via
 * claimApi.getSampleClaims() so this file never invents its own copy of
 * which samples exist.
 *
 * Actually opening a chosen sample is injected (SamplesDeps), the same
 * dependency-injection pattern as tabs.ts's TabStripDeps / shortcuts.ts's
 * ShortcutDeps — main.ts owns tab creation/loading and this file has no
 * business reaching into it directly.
 */

export interface SamplesDeps {
  openSample: (id: string) => void | Promise<void>;
}

let deps: SamplesDeps | null = null;
let cachedSamples: SampleClaimDto[] | null = null;

async function loadSamples(): Promise<SampleClaimDto[]> {
  if (cachedSamples) return cachedSamples;
  const samples = await window.claimApi.getSampleClaims();
  cachedSamples = samples;
  return samples;
}

function renderSamplesList(samples: SampleClaimDto[]): void {
  samplesListEl.innerHTML = '';
  for (const sample of samples) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sampleItem';
    btn.setAttribute('role', 'listitem');

    const label = document.createElement('span');
    label.className = 'sampleItemLabel';
    label.textContent = sample.label;
    const desc = document.createElement('span');
    desc.className = 'sampleItemDesc';
    desc.textContent = sample.description;
    btn.append(label, desc);

    btn.addEventListener('click', () => {
      closeOverlay('samples');
      if (deps) void deps.openSample(sample.id);
    });
    samplesListEl.append(btn);
  }
}

export async function openSamplesDialog(): Promise<void> {
  openOverlay('samples');
  try {
    const samples = await loadSamples();
    renderSamplesList(samples);
  } catch {
    samplesListEl.innerHTML = '';
    const note = document.createElement('div');
    note.className = 'menuEmptyNote';
    note.textContent = 'Could not load the bundled sample claims.';
    samplesListEl.append(note);
  }
}

export function initSamples(samplesDeps: SamplesDeps): void {
  deps = samplesDeps;
  welcomeSampleBtn.addEventListener('click', () => void openSamplesDialog());
}
