// Tiny content script: decides whether this page is a Markdown document (or a
// local folder) and only then asks the background to inject the real viewer.
(async () => {
  if (window.top !== window || window.__mdlLoader) return;
  window.__mdlLoader = true;

  const { settings = {} } = await chrome.storage.local.get('settings');
  if (settings.enabled === false) return;

  const isFile = location.protocol === 'file:';
  let path = location.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {}
  path = path.toLowerCase();

  let kind = null;
  if (isFile && path.endsWith('/')) {
    if (settings.folderRender !== false && document.getElementById('tbody')) kind = 'dir';
  } else if (/\.(md|markdown|mdown|mkdn?|mdwn|mdtxt)$/.test(path)) {
    kind = 'md';
  } else if (isFile && /\.txt$/.test(path) && settings.renderTxt !== false) {
    kind = 'md';
  }
  if (!kind) return;

  if (kind === 'md') {
    // Only take over raw text documents, never real HTML pages (e.g. GitHub).
    const type = document.contentType || '';
    if (!/^text\/(plain|markdown|x-markdown)$/.test(type)) return;
  }

  window.__mdlKind = kind;
  chrome.runtime.sendMessage({ type: 'inject', file: 'viewer.js' });
})();
