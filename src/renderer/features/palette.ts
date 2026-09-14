import { paletteInputEl, paletteResultsEl, paletteEmptyEl } from '../dom.js';
import { state, activeTab, currentScreen, findTabById, type TabState } from '../tabs.js';
import { anyOverlayOpen, openOverlay, closeOverlayInstant } from '../overlays.js';
import { normalizeSearchText, matchesSearchQuery } from './searchMatch.js';

/**
 * Ease-of-use + accessibility batch, item 3 — keyboard command palette
 * (Ctrl+K; docs/UI_REQUIREMENTS_v3_queued_features.md §10 /
 * docs/BUILD_QUEUE.md Build 6). Fuzzy-filters over three sources:
 *   1. Every action already reachable from the menus — read LIVE from the
 *      real `.menuPanel [data-action]` buttons in the DOM (see
 *      collectMenuActions below) and activated by literally calling
 *      `.click()` on that same button, which is exactly what a mouse click
 *      on the menu item already does (main.ts's setupMenus wires
 *      `closeAllMenus(); runAction(...)` on that click). This is the
 *      anti-drift guarantee the spec calls for: there is no second,
 *      hand-maintained action list to fall out of sync with the real menus
 *      — the palette reads the menus themselves.
 *   2. A short, explicitly-listed set of toolbar-only actions that have no
 *      menu item at all (page/claim steppers, edit-mode toggle) — same
 *      "invoke the real button's .click()" guarantee for BEHAVIOR; only the
 *      small enumeration of which toolbar ids to include is manually
 *      maintained (see TOOLBAR_ONLY_ACTIONS), a materially safer failure
 *      mode than duplicating any action's logic.
 *   3. Open tabs (jump to one) and, when the active tab holds an 837 batch,
 *      that tab's claims by claim id / patient name (jump to one) — via
 *      PaletteDeps, the same dependency-injection pattern tabs.ts's
 *      TabStripDeps / shortcuts.ts's ShortcutDeps / features/search.ts's
 *      SearchDeps already use, so this file never imports main.ts's
 *      tab-loading machinery directly.
 *
 * Reuses features/searchMatch.ts's normalizeSearchText/matchesSearchQuery —
 * the exact matching machinery Ctrl+F inspector search already built —
 * rather than inventing a new fuzzy-match implementation.
 */

export interface PaletteDeps {
  activateTab: (tabId: string) => void | Promise<void>;
  jumpToClaim: (index: number) => void | Promise<void>;
}

let deps: PaletteDeps | null = null;

interface PaletteItem {
  kind: 'action' | 'tab' | 'claim';
  /** Stable per render (not across renders) — only used to find the DOM element back for the active-item highlight. */
  id: string;
  label: string;
  /** Secondary text shown after the label — a keyboard shortcut for an action, or a claim's total/form type. */
  meta?: string;
  enabled: boolean;
  disabledReason?: string;
  run: () => void;
}

// ---------------------------------------------------------------------------
// Source 1 + 2: menu/toolbar actions, read live from the DOM.
// ---------------------------------------------------------------------------

/**
 * Toolbar controls with real, user-facing behavior but no `[data-action]`
 * menu counterpart (see the module header's anti-drift note on why this
 * list — not the ACTIVATION itself — is the one manually-maintained part of
 * this feature). Every entry still runs by calling `.click()` on the real
 * button element, so a stale/missing id here only ever means "the palette
 * doesn't list it yet", never "the palette does something different from
 * the real control".
 */
const TOOLBAR_ONLY_ACTION_IDS = ['prevPageBtn', 'nextPageBtn', 'prevClaimBtn', 'nextClaimBtn', 'editModeToggleBtn', 'inspectorToggleBtn'];

/** Strips a button's nested `<kbd>` shortcut hint out of its own label text (the palette shows that text separately, as `meta`). */
function labelWithoutKbd(btn: HTMLElement): string {
  const clone = btn.cloneNode(true) as HTMLElement;
  clone.querySelector('kbd')?.remove();
  return (clone.textContent ?? '').replace(/ /g, ' ').trim();
}

function disabledReasonFor(btn: HTMLButtonElement): string {
  // The one reason every disabled menu/toolbar action in this app is
  // disabled today (see main.ts's updateToolbarVisibility) — exportBtn and
  // every `[data-menu-disable="export"]` button are the only ones ever
  // programmatically disabled, and always for this same reason.
  return currentScreen() !== 'workspace' ? 'No file open' : 'Not available right now';
}

function collectMenuActions(): PaletteItem[] {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.menuPanel [data-action]'));
  return buttons.map((btn) => {
    const keys = btn.querySelector('kbd')?.textContent?.trim();
    const item: PaletteItem = {
      kind: 'action',
      id: `action:${btn.dataset['action'] ?? ''}`,
      label: labelWithoutKbd(btn),
      enabled: !btn.disabled,
      run: () => btn.click(),
    };
    if (keys) item.meta = keys;
    if (btn.disabled) item.disabledReason = disabledReasonFor(btn);
    return item;
  });
}

function collectToolbarOnlyActions(): PaletteItem[] {
  const items: PaletteItem[] = [];
  for (const id of TOOLBAR_ONLY_ACTION_IDS) {
    const btn = document.getElementById(id) as HTMLButtonElement | null;
    if (!btn || btn.hidden) continue;
    const label = (btn.getAttribute('title') ?? btn.getAttribute('aria-label') ?? btn.textContent ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (label === '') continue;
    const item: PaletteItem = {
      kind: 'action',
      id: `action:${id}`,
      label,
      enabled: !btn.disabled,
      run: () => btn.click(),
    };
    const title = btn.getAttribute('title');
    const shortcutMatch = title ? /\(([^)]+)\)\s*$/.exec(title) : null;
    if (shortcutMatch?.[1]) item.meta = shortcutMatch[1];
    if (btn.disabled) item.disabledReason = disabledReasonFor(btn);
    items.push(item);
  }
  return items;
}

// ---------------------------------------------------------------------------
// Source 3: open tabs + (batch) claims.
// ---------------------------------------------------------------------------

function collectTabItems(): PaletteItem[] {
  return state.tabs.map((tab: TabState) => {
    const isActive = tab.tabId === state.activeTabId;
    const item: PaletteItem = {
      kind: 'tab',
      id: `tab:${tab.tabId}`,
      label: tab.fileName || 'Opening…',
      enabled: true,
      run: () => {
        if (deps) void deps.activateTab(tab.tabId);
      },
    };
    if (isActive) item.meta = 'current tab';
    return item;
  });
}

function collectClaimItems(): PaletteItem[] {
  const tab = activeTab();
  if (!tab || tab.summaries.length <= 1) return [];
  return tab.summaries.map((summary, index) => {
    const isCurrent = index === tab.currentIndex;
    const label = summary.claimId || summary.patientName || `Claim ${index + 1}`;
    const item: PaletteItem = {
      kind: 'claim',
      id: `claim:${index}`,
      label: `Claim ${index + 1} of ${tab.summaries.length} — ${label}`,
      enabled: true,
      run: () => {
        if (deps) void deps.jumpToClaim(index);
      },
    };
    item.meta = isCurrent ? 'current claim' : summary.patientName;
    return item;
  });
}

// ---------------------------------------------------------------------------
// Filtering + rendering
// ---------------------------------------------------------------------------

function allItems(): PaletteItem[] {
  return [...collectMenuActions(), ...collectToolbarOnlyActions(), ...collectTabItems(), ...collectClaimItems()];
}

function filterItems(items: PaletteItem[], query: string): PaletteItem[] {
  const normalized = normalizeSearchText(query);
  if (normalized === '') return items;
  return items.filter((item) => matchesSearchQuery(item.label, normalized) || (item.meta ? matchesSearchQuery(item.meta, normalized) : false));
}

let currentItems: PaletteItem[] = [];
let activeIndex = -1;

function kindLabel(kind: PaletteItem['kind']): string {
  switch (kind) {
    case 'action':
      return 'Action';
    case 'tab':
      return 'Tab';
    case 'claim':
      return 'Claim';
  }
}

function renderResults(): void {
  paletteResultsEl.innerHTML = '';
  paletteEmptyEl.hidden = currentItems.length > 0;

  currentItems.forEach((item, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'paletteItem' + (i === activeIndex ? ' isActive' : '');
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', i === activeIndex ? 'true' : 'false');
    btn.disabled = !item.enabled;
    btn.id = `paletteItem-${i}`;

    const kindEl = document.createElement('span');
    kindEl.className = 'paletteItemKind';
    kindEl.textContent = kindLabel(item.kind);

    const labelEl = document.createElement('span');
    labelEl.className = 'paletteItemLabel';
    labelEl.textContent = item.label;

    btn.append(kindEl, labelEl);

    if (!item.enabled && item.disabledReason) {
      const reasonEl = document.createElement('span');
      reasonEl.className = 'paletteItemReason';
      reasonEl.textContent = item.disabledReason;
      btn.append(reasonEl);
    } else if (item.meta) {
      const metaEl = document.createElement('span');
      metaEl.className = 'paletteItemMeta';
      metaEl.textContent = item.meta;
      btn.append(metaEl);
    }

    btn.addEventListener('click', () => {
      if (!item.enabled) return;
      closeOverlayInstant('palette');
      item.run();
    });
    // Highlight-only update (never a full renderResults() rebuild) — a real
    // mouse click is mousemove -> mouseenter -> mousedown -> mouseup ->
    // click as separate events on the SAME element; rebuilding the list's
    // DOM mid-gesture (tearing down and recreating every button, including
    // the one under the cursor) raced the click itself, so `item.run()`
    // sometimes fired on a button that had already been replaced and never
    // actually received the click event that was meant to activate it.
    btn.addEventListener('mouseenter', () => {
      if (activeIndex === i) return;
      setActiveIndex(i);
    });

    paletteResultsEl.append(btn);
  });

  paletteInputEl.setAttribute('aria-activedescendant', activeIndex >= 0 ? `paletteItem-${activeIndex}` : '');
  if (activeIndex >= 0) {
    paletteResultsEl.querySelector(`#paletteItem-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }
}

function applyQuery(): void {
  const query = paletteInputEl.value;
  currentItems = filterItems(allItems(), query);
  // First ENABLED item, if any (stays -1 when every row is disabled — an
  // all-disabled result set, e.g. every action needs a file open, still
  // shows the list with reasons, but there's nothing sensible for Enter to
  // activate yet).
  activeIndex = currentItems.findIndex((it) => it.enabled);
  renderResults();
}

/** Moves the active-item highlight WITHOUT rebuilding the results list's DOM — see the mouseenter listener's comment above for why a full renderResults() during an in-progress pointer/keyboard interaction is the wrong tool here. */
function setActiveIndex(next: number): void {
  const prevBtn = activeIndex >= 0 ? paletteResultsEl.querySelector<HTMLElement>(`#paletteItem-${activeIndex}`) : null;
  prevBtn?.classList.remove('isActive');
  prevBtn?.setAttribute('aria-selected', 'false');

  activeIndex = next;

  const nextBtn = activeIndex >= 0 ? paletteResultsEl.querySelector<HTMLElement>(`#paletteItem-${activeIndex}`) : null;
  nextBtn?.classList.add('isActive');
  nextBtn?.setAttribute('aria-selected', 'true');
  nextBtn?.scrollIntoView({ block: 'nearest' });
  paletteInputEl.setAttribute('aria-activedescendant', activeIndex >= 0 ? `paletteItem-${activeIndex}` : '');
}

function moveActive(delta: number): void {
  if (currentItems.length === 0) return;
  const enabledIndices = currentItems.map((it, i) => i).filter((i) => currentItems[i]!.enabled);
  if (enabledIndices.length === 0) return;
  const currentPos = enabledIndices.indexOf(activeIndex);
  const fromPos = currentPos === -1 ? (delta > 0 ? -1 : 0) : currentPos;
  const nextPos = (((fromPos + delta) % enabledIndices.length) + enabledIndices.length) % enabledIndices.length;
  setActiveIndex(enabledIndices[nextPos]!);
}

function activateCurrent(): void {
  const item = currentItems[activeIndex];
  if (!item || !item.enabled) return;
  closeOverlayInstant('palette');
  item.run();
}

// ---------------------------------------------------------------------------
// Open / init
// ---------------------------------------------------------------------------

export function openCommandPalette(): void {
  if (anyOverlayOpen()) return;
  paletteInputEl.value = '';
  openOverlay('palette');
  applyQuery();
  paletteInputEl.focus();
}

export function initPalette(paletteDeps: PaletteDeps): void {
  deps = paletteDeps;

  paletteInputEl.addEventListener('input', applyQuery);

  paletteInputEl.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      activateCurrent();
    }
    // Escape is handled by the generic overlay dispatcher (shortcuts.ts) —
    // no special-casing needed here, same as every other overlay's dialog.
  });
}
