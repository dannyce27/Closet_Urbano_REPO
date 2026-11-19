(() => {
  const storageKey = 'cu-theme';
  const root = document.documentElement;

  function applyTheme(theme, save = false) {
    const light = theme === 'light';
    root.dataset.theme = light ? 'light' : 'dark';
    const label = light ? 'Modo oscuro' : 'Modo claro';
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.setAttribute('aria-label', 'Activar ' + label.toLowerCase());
      button.title = 'Activar ' + label.toLowerCase();
      button.querySelector('[data-theme-label]').textContent = label;
    });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = light ? '#ffffff' : '#101010';
    if (save) {
      try { localStorage.setItem(storageKey, root.dataset.theme); } catch {}
    }
  }

  let initial = 'dark';
  try { initial = localStorage.getItem(storageKey) || initial; } catch {}
  applyTheme(initial);
  document.addEventListener('DOMContentLoaded', () => applyTheme(root.dataset.theme));
  document.addEventListener('click', event => {
    if (event.target.closest('[data-theme-toggle]')) {
      applyTheme(root.dataset.theme === 'light' ? 'dark' : 'light', true);
    }
  });
  window.addEventListener('storage', event => {
    if (event.key === storageKey || event.key === null) applyTheme(event.newValue);
  });
})();
