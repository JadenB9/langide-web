// Runs in <head> before paint so the page never flashes the wrong theme.
// Same rule as the rest of j4den.com: a saved choice wins, otherwise follow
// the device's light/dark setting. Dark is the default and has no attribute.
(function () {
  try {
    var saved = localStorage.getItem('theme');
    if (saved === 'light' || (!saved && window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: light)').matches)) {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  } catch (e) { /* private mode refuses localStorage; stay dark */ }
})();
