// Runs in <head> before paint so the page never flashes the wrong theme.
// Same rule as the rest of j4den.com: a saved choice wins, otherwise follow
// the device's light/dark setting. Dark is the default and has no attribute.
(function () {
  var light = false;
  try {
    var saved = localStorage.getItem('theme');
    light = saved === 'light' || (!saved && window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: light)').matches);
  } catch (e) { /* private mode refuses localStorage; stay dark */ }
  if (light) document.documentElement.setAttribute('data-theme', 'light');
  // Browser chrome matches the top bar
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', light ? '#e9ebed' : '#1a1a1a');
})();
