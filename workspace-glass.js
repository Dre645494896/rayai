import { isLensSupported, liquidGlass } from './glasswork-lens.js';

const surfaces = {
  '.chat-header, .viewer-toolbar': {rim: 18, edge: 1, dispersion: .055},
  '.composer': {rim: 32, edge: 1.15, dispersion: .08},
  '#quick-params': {rim: 28, edge: 1.1, dispersion: .065},
  '#profile-select, #account-menu, #wallet-popover': {rim: 18, edge: .9, dispersion: .045},
};

if (isLensSupported() && typeof ResizeObserver === 'function') {
  const reduced = ['(prefers-reduced-transparency: reduce)', '(prefers-contrast: more)', '(forced-colors: active)'].map(query => matchMedia(query));
  const targets = new Map();
  for (const [selector, options] of Object.entries(surfaces)) {
    for (const el of document.querySelectorAll(selector)) targets.set(el, options);
  }
  const active = new Map();
  let frame = 0;
  function sync() {
    frame = 0;
    const enabled = !document.hidden && !reduced.some(query => query.matches);
    for (const [el, options] of targets) {
      const visible = enabled && !el.closest('[hidden], [inert], dialog:not([open])') &&
        !el.closest('details:not([open])') && el.offsetWidth >= 32 && el.offsetHeight >= 32;
      if (visible && !active.has(el)) {
        try { active.set(el, liquidGlass(el, options)); } catch { /* CSS material remains available. */ }
      } else if (!visible && active.has(el)) {
        active.get(el).destroy();
        active.delete(el);
      }
    }
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(sync); }
  const observer = new MutationObserver(schedule);
  for (const el of targets.keys()) {
    observer.observe(el, {attributes: true, attributeFilter: ['hidden', 'inert', 'class']});
  }
  for (const el of document.querySelectorAll('.app-shell, #profile-picker, #image-viewer')) {
    observer.observe(el, {attributes: true, attributeFilter: ['open', 'inert', 'hidden']});
  }
  for (const query of reduced) query.addEventListener('change', schedule);
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('pageshow', schedule);
  schedule();
}
