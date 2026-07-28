import { shortcutsGridEl } from './dom.js';
import { toggleInspector } from './inspector.js';
import { zoomBy, zoomToActualSize, fitPage, fitWidth, stepPage } from './preview.js';
import { anyOverlayOpen, openOverlayId, trapTabInOverlay, closeOverlay, openOverlay, openExportDialog, exportCurrentClaimSkipDialog } from './overlays.js';
import { activeTab } from './tabs.js';
import { focusSearch } from './features/search.js';

/**
 * The keyboard shortcuts sheet's content (KEY_GROUPS + rendering it + the
 * F1 open action) and the global keydown dispatcher. Pure-moved out of
 * main.ts — see docs/TABS_BUILD_PLAN.md §2 Item 0 — then extended with the
 * tab shortcuts (§2): Ctrl+Tab / Ctrl+Shift+Tab cycle, Ctrl+W closes the
 * *tab* (previously "close file"), Ctrl+Shift+T reopens the last closed
 * tab, Ctrl+1..7 jump to a tab.
 *
 * Ctrl+8 / Ctrl+9 are already the long-standing fit-width / fit-page
 * shortcuts (below, unchanged) — rather than silently stealing them for
 * "jump to tab 8/9" (which would regress a shortcut users already rely on
 * for a feature this build doesn't touch), tab-jump is scoped to Ctrl+1..7.
 * A tab strip with 8+ tabs still has every tab reachable via Ctrl+Tab
 * cycling or a click; it just has no direct-jump chord past 7.
 *
 * A handful of actions the dispatcher needs (menu-close, F6 region cycling,
 * open/close-tab, theme toggle, claim stepping, tab cycling/jumping/reopen)
 * still live in main.ts and aren't imported directly here — importing them
 * would create a main.ts <-> shortcuts.ts cycle (main.ts must import
 * initShortcuts from this file to wire it up). Instead they're passed into
 * initShortcuts() as callbacks, per the task's circular-import guidance.
 */

// ---------------------------------------------------------------------------
// Keyboard shortcuts dialog (content)
// ---------------------------------------------------------------------------

const KEY_GROUPS: Array<{ title: string; items: Array<{ label: string; keys: string }> }> = [
  {
    title: 'File',
    items: [
      { label: 'Open a claim file', keys: 'Ctrl+O' },
      { label: 'Export this claim…', keys: 'Ctrl+E' },
      { label: 'Export this claim (skip dialog)', keys: 'Ctrl+Shift+E' },
      { label: 'Close tab', keys: 'Ctrl+W' },
      { label: 'Reopen closed tab', keys: 'Ctrl+Shift+T' },
      { label: 'Copy service lines as TSV', keys: 'Ctrl+Shift+C' },
    ],
  },
  {
    title: 'View',
    items: [
      { label: 'Zoom in / out', keys: 'Ctrl+ + / Ctrl+ −' },
      { label: 'Zoom at the pointer', keys: 'Ctrl + scroll' },
      { label: 'Actual size', keys: 'Ctrl+0' },
      { label: 'Fit page', keys: 'Ctrl+9' },
      { label: 'Fit width', keys: 'Ctrl+8' },
      { label: 'Toggle inspector', keys: 'Ctrl+D' },
      { label: 'Find in this claim', keys: 'Ctrl+F' },
      { label: 'Light / dark', keys: 'Ctrl+Shift+L' },
      { label: 'UI text scale — cycle 100/125/150/175%', keys: '—' },
    ],
  },
  {
    title: 'Navigate',
    items: [
      { label: 'Previous / next form page', keys: 'Ctrl+← / Ctrl+→' },
      { label: 'Previous / next claim (837 file)', keys: 'PageUp / PageDown' },
      { label: 'Next / previous tab', keys: 'Ctrl+Tab / Ctrl+Shift+Tab' },
      { label: 'Jump to tab 1–7', keys: 'Ctrl+1 … Ctrl+7' },
    ],
  },
  {
    title: 'Help',
    items: [
      { label: 'Keyboard shortcuts', keys: 'F1' },
      { label: 'About Claim Viewer', keys: '—' },
      { label: 'Dismiss dialog', keys: 'Esc' },
    ],
  },
];

export function renderShortcuts(): void {
  shortcutsGridEl.innerHTML = '';
  for (const group of KEY_GROUPS) {
    const col = document.createElement('div');
    col.className = 'shortcutsCol';
    const title = document.createElement('div');
    title.className = 'shortcutsColTitle';
    title.textContent = group.title;
    col.append(title);
    for (const item of group.items) {
      const row = document.createElement('div');
      row.className = 'shortcutRow';
      const label = document.createElement('span');
      label.className = 'shortcutLabel';
      label.textContent = item.label;
      const keys = document.createElement('kbd');
      keys.textContent = item.keys;
      row.append(label, keys);
      col.append(row);
    }
    shortcutsGridEl.append(col);
  }
}

export function openShortcuts(): void {
  openOverlay('shortcuts');
}

// ---------------------------------------------------------------------------
// Global keydown dispatcher
// ---------------------------------------------------------------------------

export interface ShortcutDeps {
  closeAllMenus: () => void;
  cycleRegionFocus: (delta: number) => void;
  openClaimFlow: () => void | Promise<void>;
  closeActiveTab: () => void | Promise<void>;
  toggleTheme: () => void;
  stepClaim: (delta: number) => void | Promise<void>;
  cycleTab: (delta: number) => void;
  jumpToTab: (oneBasedIndex: number) => void;
  reopenLastClosedTab: () => void | Promise<void>;
  copyServiceLinesTsv: () => void;
}

export function initShortcuts(deps: ShortcutDeps): void {
  window.addEventListener('keydown', (event) => {
    if (event.key === 'F1') {
      event.preventDefault();
      openShortcuts();
      return;
    }
    if (event.key === 'Tab' && anyOverlayOpen()) {
      trapTabInOverlay(event);
      return;
    }
    if (event.key === 'Escape') {
      const openId = openOverlayId();
      if (openId) closeOverlay(openId);
      deps.closeAllMenus();
      return;
    }
    if (event.key === 'F6' && !anyOverlayOpen()) {
      event.preventDefault();
      deps.cycleRegionFocus(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === 'PageUp') {
      event.preventDefault();
      void deps.stepClaim(-1);
      return;
    }
    if (event.key === 'PageDown') {
      event.preventDefault();
      void deps.stepClaim(1);
      return;
    }

    const ctrlOrCmd = event.ctrlKey || event.metaKey;
    if (!ctrlOrCmd) return;

    // Tab cycling: Ctrl+Tab / Ctrl+Shift+Tab. Checked ahead of the
    // lowercase-key switch below since 'Tab' isn't a single printable
    // character the same way the rest of the shortcuts are.
    if (event.key === 'Tab') {
      event.preventDefault();
      deps.cycleTab(event.shiftKey ? -1 : 1);
      return;
    }

    if (event.shiftKey && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      deps.toggleTheme();
      return;
    }
    if (event.shiftKey && event.key.toLowerCase() === 'e') {
      event.preventDefault();
      void exportCurrentClaimSkipDialog();
      return;
    }
    if (event.shiftKey && event.key.toLowerCase() === 't') {
      event.preventDefault();
      void deps.reopenLastClosedTab();
      return;
    }
    if (event.shiftKey && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      deps.copyServiceLinesTsv();
      return;
    }

    switch (event.key.toLowerCase()) {
      case 'o':
        event.preventDefault();
        void deps.openClaimFlow();
        break;
      case 'e':
        event.preventDefault();
        openExportDialog();
        break;
      case 'd':
        event.preventDefault();
        toggleInspector();
        break;
      case 'f':
        // focusSearch() itself is the no-op guard (no file open / a modal
        // dialog is open) — docs/UI_REQUIREMENTS_v3_queued_features.md §1's
        // "Ctrl+F is a no-op with no file open (do not steal focus)".
        // preventDefault unconditionally so this never falls through to any
        // OS/Chromium default for Ctrl+F either way.
        event.preventDefault();
        focusSearch();
        break;
      case 'w':
        event.preventDefault();
        void deps.closeActiveTab();
        break;
      case '+':
      case '=': {
        event.preventDefault();
        const tab = activeTab();
        if (tab) void zoomBy(tab, 0.1);
        break;
      }
      case '-': {
        event.preventDefault();
        const tab = activeTab();
        if (tab) void zoomBy(tab, -0.1);
        break;
      }
      case '0': {
        event.preventDefault();
        const tab = activeTab();
        if (tab) void zoomToActualSize(tab);
        break;
      }
      case '9': {
        event.preventDefault();
        const tab = activeTab();
        if (tab) void fitPage(tab);
        break;
      }
      case '8': {
        event.preventDefault();
        const tab = activeTab();
        if (tab) void fitWidth(tab);
        break;
      }
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
      case '6':
      case '7':
        event.preventDefault();
        deps.jumpToTab(Number(event.key));
        break;
      case 'arrowleft': {
        event.preventDefault();
        const tab = activeTab();
        if (tab) void stepPage(tab, -1);
        break;
      }
      case 'arrowright': {
        event.preventDefault();
        const tab = activeTab();
        if (tab) void stepPage(tab, 1);
        break;
      }
    }
  });
}
