// Apply the stored theme before first paint to avoid a flash. Default is light.
// External file (not inline) so the CSP can stay at script-src 'self'.
try {
  if (localStorage.getItem('demoledger-theme') === 'dark') document.documentElement.classList.add('dark');
} catch {}
