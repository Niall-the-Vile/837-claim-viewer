import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Claim, FormType } from '../model/claim.js';
import { JsonClaimSource } from '../sources/json/jsonClaimSource.js';
import { X12ClaimSource } from '../sources/x12/x12ClaimSource.js';
import { ClaimParseError } from '../sources/claimSource.js';
import { renderCms1500 } from '../render/cms1500/renderCms1500.js';
import { renderUb04 } from '../render/ub04/renderUb04.js';
import { renderDental } from '../render/dental/renderDental.js';
import { composeName } from '../render/text.js';

/**
 * Pure, Electron-free application core: turns raw file text into normalized
 * Claims (source detection), turns a Claim into rendered PDF bytes (form
 * dispatch), and projects a Claim into the small summary shape the
 * open/stepper UI needs. No fs, no Electron imports — this module is
 * exercised directly by test/claimService.test.ts and wrapped by the IPC
 * handlers in electron/main.ts.
 */

export interface LoadedClaims {
  source: 'json' | 'x12';
  claims: Claim[];
}

const jsonSource = new JsonClaimSource();
const x12Source = new X12ClaimSource();

/**
 * Detects the file's source format (JSON clearinghouse feed vs. X12 837
 * interchange) by trying each source's cheap `canParse` sniff in turn, then
 * parses with the matching source. Throws a friendly ClaimParseError if
 * neither source recognizes the text.
 */
export function loadClaims(text: string): LoadedClaims {
  if (jsonSource.canParse(text)) {
    return { source: 'json', claims: jsonSource.parse(text) };
  }
  if (x12Source.canParse(text)) {
    return { source: 'x12', claims: x12Source.parse(text) };
  }
  throw new ClaimParseError("This file isn't a valid claim JSON or 837 interchange.");
}

/**
 * Renders a Claim to PDF bytes, dispatching on its form type. A claim whose
 * form type has no renderer (`'unsupported'`) still produces a PDF — a
 * calm placeholder page — rather than throwing, so the export/preview flow
 * never dead-ends even when the data itself has no known form (its fields
 * remain visible in the inspector, per UI_REQUIREMENTS_v2_single_claim §4).
 */
export async function renderClaim(claim: Claim): Promise<Uint8Array> {
  switch (claim.formType) {
    case 'cms1500':
      return renderCms1500(claim);
    case 'ub04':
      return renderUb04(claim);
    case 'dental':
      return renderDental(claim);
    case 'unsupported':
      return renderUnsupportedPlaceholder(claim);
  }
}

export interface ClaimSummaryInfo {
  claimId: string;
  formType: FormType;
  patientName: string;
  total: number;
  warningCount: number;
}

/** Projects a Claim into the small shape the open-file result / stepper UI needs — never the full Claim (keeps IPC payloads light and avoids leaking the raw record needlessly). */
export function claimSummary(claim: Claim): ClaimSummaryInfo {
  return {
    claimId: claim.claimId,
    formType: claim.formType,
    patientName: composeName(claim.patient.name),
    total: claim.totals.totalCharge,
    warningCount: claim.warnings.length,
  };
}

// ---------------------------------------------------------------------------
// Placeholder PDF for claims with no form renderer
// ---------------------------------------------------------------------------

const PRODUCER = 'claim-viewer/claimService';
/** Fixed epoch date, matching the form renderers' convention, so the placeholder is byte-reproducible too. */
const FIXED_DATE = new Date(0);
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

async function renderUnsupportedPlaceholder(claim: Claim): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setProducer(PRODUCER);
  doc.setCreator(PRODUCER);
  doc.setTitle(`Unsupported claim form - ${claim.claimId}`);
  doc.setSubject('Claim data has no form renderer');
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  const lines = [
    { text: 'Cannot display this claim as a form.', size: 16 },
    { text: '', size: 12 },
    { text: `Claim ID: ${claim.claimId || '(none)'}`, size: 12 },
    { text: `Source form type: ${claim.claimFormRaw || '(unknown)'}`, size: 12 },
    { text: '', size: 12 },
    { text: 'This claim parsed successfully, but its form type has no', size: 12 },
    { text: 'renderer yet. Its data is still available in the inspector.', size: 12 },
  ];

  let y = PAGE_HEIGHT - 120;
  for (const line of lines) {
    if (line.text !== '') {
      page.drawText(line.text, { x: 72, y, size: line.size, font, color: rgb(0, 0, 0) });
    }
    y -= line.size + 8;
  }

  return doc.save();
}
