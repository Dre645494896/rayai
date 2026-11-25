// Run before style sheets so a saved override is already in place at first paint.
(() => {
  const key = 'rayai-appearance-v1';
  const normalize = value => value === 'light' || value === 'dark' ? value : 'system';
  const apply = value => {
    if (value === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = value;
  };
  let preference = 'system';
  try { preference = normalize(localStorage.getItem(key)); } catch { /* Follow the system if storage is blocked. */ }
  apply(preference);

  document.addEventListener('DOMContentLoaded', () => {
    const picker = document.querySelector('.appearance-picker');
    if (!picker) return;
    const radios = [...picker.querySelectorAll('input[type="radio"][name="rayai-appearance"]')];
    const updateControls = () => {
      for (const radio of radios) radio.checked = radio.value === preference;
    };
    updateControls();
    let updateHighlight = () => {};
    picker.addEventListener('change', event => {
      if (!radios.includes(event.target) || !event.target.checked) return;
      preference = normalize(event.target.value);
      apply(preference);
      updateHighlight();
      try { localStorage.setItem(key, preference); } catch { /* Keep this tab usable without storage. */ }
    });
    window.addEventListener('storage', event => {
      if (event.key !== key && event.key !== null) return;
      preference = normalize(event.newValue);
      apply(preference);
      updateControls();
      updateHighlight();
    });
    const track = picker.querySelector('.appearance-options');
    if (track) import('./workspace-selection.js').then(({selectionPill}) => {
      const pill = selectionPill(track);
      updateHighlight = () => pill.set(radios.find(radio => radio.checked)?.nextElementSibling ?? null);
      updateHighlight();
      picker.addEventListener('focusin', updateHighlight);
    }).catch(() => { /* Keep the native checked styling if the optional decoration fails. */ });
  }, {once: true});
})();
