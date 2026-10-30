// Links that leave the site open in a new tab, as they do on the other pages.
for (const link of document.querySelectorAll('#tsd-toolbar-links a')) {
  if (link.origin !== window.location.origin) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
}
