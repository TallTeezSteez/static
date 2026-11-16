// Dialog keys and focus for any app that uses the theme's .scrim / .dialog. Call installDialogKeys() once at startup.
// - A dialog that opens while the cursor is in the page behind takes the cursor, so typing can't land behind it.
// - Escape closes the top dialog (same as clicking outside it), even when the page behind would grab Escape first,
//   and the cursor goes back where it was.
// - Tab moves into the dialog instead of walking the page behind it.
// Costs nothing while typing: dialogs are found by the theme's "theme-scrim" opening animation.
// Drift's own copy is src/lib/dialogs.ts; keep the two in step.
const FOCUSABLE = 'input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

let before = null;
let lastOutside = null;

const topScrim = () => {
  const all = document.querySelectorAll('.scrim');
  return all[all.length - 1] || null;
};

function enter(scrim) {
  before = lastOutside;
  if (scrim.contains(document.activeElement)) return;
  const box = scrim.querySelector('.dialog') || scrim;
  if (!box.hasAttribute('tabindex')) box.setAttribute('tabindex', '-1');
  box.focus({ preventScroll: true });
}

function restoreSoon() {
  const back = before;
  requestAnimationFrame(() => {
    if (topScrim()) return;
    if (back && back.isConnected && (document.activeElement === document.body || !document.activeElement)) back.focus({ preventScroll: true });
    before = null;
  });
}

export function installDialogKeys() {
  document.addEventListener('focusin', (e) => {
    if (e.target instanceof HTMLElement && !e.target.closest('.scrim')) lastOutside = e.target;
  });
  document.addEventListener('animationstart', (e) => {
    if (e.animationName !== 'theme-scrim') return;
    if (e.target.classList && e.target.classList.contains('scrim')) enter(e.target);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' && e.key !== 'Tab') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const top = topScrim();
    if (!top) return;
    if (top.contains(document.activeElement)) { if (e.key === 'Escape') restoreSoon(); return; }
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Tab') { const first = top.querySelector(FOCUSABLE); if (first) first.focus(); return; }
    top.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    restoreSoon();
  }, true);
}
