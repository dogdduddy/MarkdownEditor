const INJECTABLE_JS = new Set(['viewer.js', 'mermaid.js', 'editor.js']);
const NATIVE_HOST = 'com.mdlens.saver';
const INJECTABLE_CSS = new Set(['katex.css', 'editor.css']);

function stripHash(url) {
  const i = url.indexOf('#');
  return i < 0 ? url : url.slice(0, i);
}

// Chrome's built-in file:// directory listing is an HTML page that fills
// itself in with addRow(name, url, isDir, size, sizeStr, mtime, dateStr) calls.
function parseListing(html, dirUrl) {
  const entries = [];
  for (const m of html.matchAll(/addRow\((.*?)\);<\/script>/g)) {
    let a;
    try {
      a = JSON.parse(`[${m[1]}]`);
    } catch {
      continue;
    }
    const [name, href, isDir, , , mtime] = a;
    if (name === '..' || name === '.') continue;
    let url;
    try {
      url = new URL(href + (isDir ? '/' : ''), dirUrl).href;
    } catch {
      continue;
    }
    entries.push({ name, url, isDir: !!isDir, mtime: mtime || 0 });
  }
  return entries;
}

async function handle(msg, sender) {
  const tabId = sender.tab && sender.tab.id;
  switch (msg.type) {
    case 'inject': {
      if (!INJECTABLE_JS.has(msg.file)) throw new Error('not allowed');
      await chrome.scripting.executeScript({ target: { tabId }, files: [msg.file] });
      return {};
    }
    case 'insertCss': {
      if (!INJECTABLE_CSS.has(msg.file)) throw new Error('not allowed');
      await chrome.scripting.insertCSS({ target: { tabId }, files: [msg.file] });
      return {};
    }
    case 'fetchText': {
      // A page may only re-read itself.
      const own = stripHash((sender.tab && sender.tab.url) || '');
      if (!own || stripHash(msg.url) !== own) throw new Error('not allowed');
      const res = await fetch(own, { cache: 'no-store' });
      if (!res.ok && res.status !== 0) throw new Error(`HTTP ${res.status}`);
      return { text: await res.text() };
    }
    case 'listDir': {
      const own = (sender.tab && sender.tab.url) || '';
      if (!own.startsWith('file://') || !msg.url.startsWith('file://') || !msg.url.endsWith('/')) {
        throw new Error('not allowed');
      }
      const res = await fetch(msg.url, { cache: 'no-store' });
      return { entries: parseListing(await res.text(), msg.url) };
    }
    case 'nativePing': {
      const r = await chrome.runtime.sendNativeMessage(NATIVE_HOST, { op: 'ping' });
      if (!r || !r.ok) throw new Error('helper not available');
      return { version: r.version };
    }
    case 'nativeWrite': {
      // A page may only save itself: the path comes from the tab, not the message.
      const own = stripHash((sender.tab && sender.tab.url) || '');
      if (!own.startsWith('file://')) throw new Error('not allowed');
      const path = decodeURIComponent(new URL(own).pathname);
      const r = await chrome.runtime.sendNativeMessage(NATIVE_HOST, {
        op: 'write',
        path,
        text: msg.text,
        base: msg.base,
        force: !!msg.force,
      });
      return { written: !!(r && r.ok), conflict: !!r && r.error === 'conflict', reason: (r && r.message) || '' };
    }
    case 'openOptions': {
      await chrome.runtime.openOptionsPage();
      return {};
    }
    default:
      throw new Error('unknown message');
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(
    (r) => sendResponse({ ok: true, ...r }),
    (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }),
  );
  return true;
});
