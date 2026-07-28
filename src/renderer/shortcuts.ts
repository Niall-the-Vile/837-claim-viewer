import { shortcutsGridEl } from './dom.js';
import { toggleInspector } from './inspector.js';
import { zoomBy, zoomToActualSize, fitPage, fitWidth, stepPage } from './preview.js';
import { anyOverlayOpen, trapTabInOverlay, closeOverlay, openOverlay, openExportDialog, exportCurrentClaimSkipDialog } from './overlays.js';

/**
 * The keyboard shortcuts sheet's content (KEY_GROUPS + rendering it + the
 * F1 open action) and the global keydown dispatcher. Pure-moved out of
 * main.ts — see docs/TABS_BUILD_PLAN.md §2 Item 0.
 *
 * A handful of actions the dispatcher needs (menu-close, F6 region cycling,
 * open/close-file, theme toggle, claim stepping) still live in main.ts and
 * aren't imported directly here — importing them would create a main.ts <->
 * shortcuts.ts cycle (main.ts must import initShortcuts from this file to
 * wire it up). Instead they're passed into initShortcuts() as callbacks,
 * per the task's circular-import guidance.
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
      { label: 'Close file', keys: 'Ctrl+W' },
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
      { label: 'Light / dark', keys: 'Ctrl+Shift+L' },
    ],
  },
  {
    title: 'Navigate',
    items: [
      { label: 'Previous / next form page', keys: 'Ctrl+← / Ctrl+→' },
      { label: 'Previous / next claim (837 file)', keys: 'PageUp / PageDown' },
    ],
  },
  {
    title: 'Help',
    items: [
      { label: 'Keyboard shortcuts', keys: 'F1' },
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
  closeFile: () => void;
  toggleTheme: () => void;
  stepClaim: (delta: number) => void | Promise<void>;
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
      if (anyOverlayOpen()) {
        closeOverlay('export');
        closeOverlay('shortcuts');
      }
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
      case 'w':
        event.preventDefault();
        deps.closeFile();
        break;
      case '+':
      case '=':
        event.preventDefault();
        void zoomBy(0.1);
        break;
      case '-':
        event.preventDefault();
        void zoomBy(-0.1);
        break;
      case '0':
        event.preventDefault();
        void zoomToActualSize();
        break;
      case '9':
        event.preventDefault();
        void fitPage();
        break;
      case '8':
        event.preventDefault();
        void fitWidth();
        break;
      case 'arrowleft':
        event.preventDefault();
        void stepPage(-1);
        break;
      case 'arrowright':
        event.preventDefault();
        void stepPage(1);
        break;
    }
  });
}
