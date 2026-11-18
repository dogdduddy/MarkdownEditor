import { loadSettings, saveSettings, onSettingsChanged, FONT_SIZES, FONTS } from '../shared/settings.js';
import { translator } from '../shared/i18n.js';
import { createRenderer, slugify, plantumlUrl } from './markdown.js';
import baseCss from './styles.css';
import hlLight from 'highlight.js/styles/github.css';
import hlDark from 'highlight.js/styles/github-dark.css';

const ICON = {
  folder:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  outline:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 7h14M5 12h9M5 17h12"/></svg>',
  search:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
  sidebar:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/></svg>',
  menu:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 7h14M5 12h14M5 17h14"/></svg>',
  caret: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m9 6 7 6-7 6z"/></svg>',
  file:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg>',
  edit:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.500 6.500 4 4"/></svg>',
  up:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V6M6 11l6-6 6 6"/></svg>',
  open:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 5h5v5M19 5l-8 8M11 6H6v12h12v-5"/></svg>',
};

const MD_EXT = /\.(md|markdown|mdown|mkdn?|mdwn|mdtxt)$/i;

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

function send(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (r) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
        else resolve(r || { ok: false, error: 'no response' });
      });
    } catch (e) {
      resolve({ ok: false, error: String(e) });
    }
  });
}

function decode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const pageUrl = () => location.href.split('#')[0];
const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/;

// File handles survive reloads here, so the file only has to be picked once.
function idb(mode, fn) {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open('mdlens', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('handles');
      open.onerror = () => resolve(undefined);
      open.onsuccess = () => {
        try {
          const req = fn(open.result.transaction('handles', mode).objectStore('handles'));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      };
    } catch {
      resolve(undefined);
    }
  });
}
const clean = (s) => s.replace(/^﻿/, '');

(async function main() {
  if (window.__mdlViewer) return;
  window.__mdlViewer = true;

  const kind = window.__mdlKind || 'md';
  const isFile = location.protocol === 'file:';
  let settings = await loadSettings();
  const t = translator(settings.language);
  const mq = window.matchMedia('(prefers-color-scheme: dark)');

  let source = '';
  if (kind === 'md') {
    const pre = document.body && document.body.querySelector('pre');
    source = clean(pre ? pre.textContent : document.body ? document.body.innerText : '');
    if (settings.charsetCompat) {
      const r = await send({ type: 'fetchText', url: pageUrl() });
      if (r.ok) source = clean(r.text);
    }
  }

  const fileName = decode(location.pathname.replace(/\/$/, '').split('/').pop() || location.hostname);

  // ---------- document shell ----------
  const hlStyle = h('style');
  const customStyle = h('style');
  document.head.replaceChildren(
    h('meta', { charset: 'utf-8' }),
    h('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
    h('title', null, fileName),
    h('style', null, baseCss),
    hlStyle,
    customStyle,
  );

  const article = h('article', { class: 'markdown-body' });
  const editorHost = h('div', { class: 'mdl-editor', hidden: true });
  const statusText = h('span', { class: 'mdl-status-text' });
  const saveBtn = h('button', { class: 'mdl-save', onclick: () => save(true) }, t('edit.save'));
  const status = h('div', { class: 'mdl-status', hidden: true }, statusText, saveBtn);
  const rawView = h('pre', { class: 'mdl-raw', hidden: true });
  const outlinePanel = h('div', { class: 'mdl-panel mdl-outline' });
  const folderPanel = h('div', { class: 'mdl-panel mdl-folder' });
  const searchInput = h('input', {
    class: 'mdl-search-input',
    type: 'search',
    placeholder: t('search.placeholder'),
    oninput: () => applyFilter(),
  });
  const searchRow = h('div', { class: 'mdl-search', hidden: true }, searchInput);

  const tabFolder = h('button', { class: 'mdl-tab', title: t('tab.folder'), html: ICON.folder, onclick: () => setTab('folder') });
  const tabOutline = h('button', { class: 'mdl-tab', title: t('tab.outline'), html: ICON.outline, onclick: () => setTab('outline') });
  const searchBtn = h('button', {
    class: 'mdl-icon-btn',
    title: t('search'),
    html: ICON.search,
    onclick: () => {
      searchRow.hidden = !searchRow.hidden;
      if (searchRow.hidden) {
        searchInput.value = '';
        applyFilter();
      } else {
        searchInput.focus();
      }
    },
  });

  const resizer = h('div', { class: 'mdl-resizer' });
  const sidebar = h(
    'aside',
    { class: 'mdl-sidebar' },
    h('div', { class: 'mdl-sidebar-head' }, h('div', { class: 'mdl-tabs' }, tabFolder, tabOutline), searchBtn),
    searchRow,
    folderPanel,
    outlinePanel,
    resizer,
  );

  const menu = h('div', { class: 'mdl-menu', hidden: true });
  const menuItem = (label, fn) =>
    h('button', {
      class: 'mdl-menu-item',
      onclick: () => {
        menu.hidden = true;
        fn();
      },
    }, label);
  menu.append(
    kind === 'md' ? menuItem(t('menu.edit'), toggleEdit) : null,
    kind === 'md' ? menuItem(t('menu.raw'), toggleRaw) : null,
    menuItem(t('menu.fullscreen'), toggleFullscreen),
    menuItem(t('menu.zen'), () => update({ zen: !settings.zen })),
    menuItem(t('menu.print'), () => window.print()),
    h('div', { class: 'mdl-menu-sep' }),
    menuItem(t('menu.settings'), () => send({ type: 'openOptions' })),
  );
  const sideBtn = h('button', {
    class: 'mdl-icon-btn mdl-side-btn',
    title: t('sidebar.toggle'),
    html: ICON.sidebar,
    onclick: () => update({ sidebarOpen: !settings.sidebarOpen }),
  });
  const editBtn = h('button', {
    class: 'mdl-icon-btn mdl-edit-btn',
    title: t('menu.edit'),
    html: ICON.edit,
    hidden: kind !== 'md',
    onclick: () => toggleEdit(),
  });
  const menuBtn = h('button', {
    class: 'mdl-icon-btn mdl-menu-btn',
    title: t('menu'),
    html: ICON.menu,
    onclick: (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    },
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true;
  });

  const main = h('main', { class: 'mdl-main' }, sideBtn, editBtn, menuBtn, menu, article, editorHost, rawView, status);
  document.body.replaceChildren(h('div', { class: 'mdl-app' }, sidebar, main));
  document.body.removeAttribute('style');

  // ---------- appearance ----------
  const isDark = () => settings.theme === 'dark' || (settings.theme === 'auto' && mq.matches);

  function applyAppearance() {
    const root = document.documentElement;
    const dark = isDark();
    root.dataset.theme = dark ? 'dark' : 'light';
    const codeDark = (dark ? settings.codeThemeDark : settings.codeThemeLight) === 'dark';
    root.dataset.codeTheme = codeDark ? 'dark' : 'light';
    hlStyle.textContent = codeDark ? hlDark : hlLight;

    root.style.setProperty('--font-size', `${FONT_SIZES[settings.fontSize] || 16}px`);
    const font = FONTS[settings.fontFamily];
    if (font) root.style.setProperty('--font-body', font);
    else root.style.removeProperty('--font-body');

    let width = '860px';
    if (settings.customWidth) {
      const pct = settings.maxWidthUnit === '%';
      const n = Number(settings.maxWidth) || (pct ? 80 : 1000);
      width = pct ? `${Math.min(100, Math.max(20, n))}%` : `${Math.min(3000, Math.max(500, n))}px`;
    }
    root.style.setProperty('--content-width', width);
    root.style.setProperty('--sidebar-width', `${settings.sidebarWidth}px`);

    root.classList.toggle('mdl-code-wrap', !!settings.codeWrap);
    root.classList.toggle('mdl-wide-table', !!settings.wideTable);
    root.classList.toggle('mdl-zen', !!settings.zen);
    root.classList.toggle('mdl-centered', !!settings.centered);
    root.classList.toggle('mdl-sidebar-open', !!settings.sidebarOpen && !settings.zen);

    customStyle.textContent = settings.customCssEnabled ? settings.customCss || '' : '';
  }

  // Apply locally right away, then persist (other tabs follow via storage).
  function update(patch) {
    settings = { ...settings, ...patch };
    applyAppearance();
    saveSettings(patch);
  }

  // ---------- sidebar tabs / search ----------
  let tab = kind === 'dir' ? 'folder' : settings.sidebarTab;
  let folderLoaded = false;

  function setTab(next, persist = true) {
    tab = next;
    tabFolder.classList.toggle('active', tab === 'folder');
    tabOutline.classList.toggle('active', tab === 'outline');
    folderPanel.hidden = tab !== 'folder';
    outlinePanel.hidden = tab !== 'outline';
    if (tab === 'folder' && !folderLoaded) {
      folderLoaded = true;
      renderFolder();
    }
    applyFilter();
    if (persist && kind !== 'dir') saveSettings({ sidebarTab: tab });
  }

  function applyFilter() {
    const q = searchInput.value.trim().toLowerCase();
    for (const el of sidebar.querySelectorAll('[data-filter]')) {
      el.classList.toggle('mdl-filtered', !!q && !el.dataset.filter.includes(q));
    }
    sidebar.classList.toggle('mdl-searching', !!q);
  }

  // ---------- markdown rendering ----------
  let renderId = 0;
  let headings = [];
  let katexCssLoaded = false;

  let plantumlOnce = false;
  let plantumlDismissed = false;

  function plantumlCard() {
    const enable = (always) => {
      if (always) {
        settings = { ...settings, plugins: { ...settings.plugins, plantuml: true } };
        saveSettings({ plugins: { plantuml: true } });
      } else {
        plantumlOnce = true;
      }
      render();
    };
    const card = h(
      'div',
      { class: 'mdl-notice' },
      h('div', { class: 'mdl-notice-text' }, h('b', null, t('puml.title')), h('span', null, t('puml.desc'))),
      h(
        'div',
        { class: 'mdl-notice-actions' },
        h('button', { class: 'primary', onclick: () => enable(true) }, t('puml.always')),
        h('button', { onclick: () => enable(false) }, t('puml.once')),
        h('button', {
          onclick: () => {
            plantumlDismissed = true;
            card.remove();
          },
        }, t('puml.close')),
        h('button', {
          class: 'link',
          onclick: () => {
            card.remove();
            update({ plantumlPrompt: false });
          },
        }, t('puml.never')),
      ),
    );
    return card;
  }

  async function render() {
    const id = ++renderId;
    const y = window.scrollY;
    const plantumlOn = settings.plugins.plantuml || plantumlOnce;
    const toHtml = createRenderer(
      plantumlOn ? { ...settings, plugins: { ...settings.plugins, plantuml: true } } : settings,
    );
    article.innerHTML = toHtml(source);

    // heading anchors
    const used = new Map();
    headings = [...article.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    for (const el of headings) {
      if (!el.id) {
        const base = slugify(el.textContent);
        const n = used.get(base) || 0;
        used.set(base, n + 1);
        el.id = n ? `${base}-${n}` : base;
      }
    }

    // [[TOC]]
    if (settings.plugins.toc) {
      for (const p of article.querySelectorAll('p')) {
        if (/^\[\[toc\]\]$/i.test(p.textContent.trim())) p.replaceWith(buildToc());
      }
    }

    // code blocks
    for (const code of article.querySelectorAll('pre > code')) {
      const pre = code.parentElement;
      code.classList.add('hljs');
      const lang = (code.className.match(/language-([\w+#.-]+)/) || [])[1];
      const btn = h('button', { class: 'mdl-copy' }, t('code.copy'));
      btn.addEventListener('click', async () => {
        const text = code.textContent;
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = h('textarea', null, text);
          document.body.append(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        btn.textContent = t('code.copied');
        setTimeout(() => (btn.textContent = t('code.copy')), 1200);
      });
      const wrap = h('div', { class: 'mdl-code' });
      pre.replaceWith(wrap);
      wrap.append(lang ? h('span', { class: 'mdl-code-lang' }, lang) : null, btn, pre);
    }

    // PlantUML blocks in the document while the plugin is off: offer to turn it on.
    if (!plantumlOn && settings.plantumlPrompt && !plantumlDismissed) {
      const first = article.querySelector('code.language-plantuml, code.language-puml');
      if (first) first.closest('.mdl-code').before(plantumlCard());
    }

    // tables
    for (const table of article.querySelectorAll('table')) {
      if (table.closest('.mdl-table')) continue;
      const wrap = h('div', { class: 'mdl-table' });
      table.replaceWith(wrap);
      wrap.append(table);
    }

    // external links open in a new tab
    for (const a of article.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (/^https?:\/\//i.test(href) && !href.startsWith(location.origin + '/')) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
    }

    const title = (article.querySelector('h1') || {}).textContent;
    document.title = (title && title.trim()) || fileName;

    buildOutline();

    if (!katexCssLoaded && article.querySelector('.katex')) {
      katexCssLoaded = true;
      send({ type: 'insertCss', file: 'katex.css' });
    }

    window.scrollTo(0, y);
    await renderDiagrams(id);
  }

  async function renderDiagrams(id) {
    const blocks = [...article.querySelectorAll('pre.mdl-diagram')];
    if (!blocks.length) return;

    const mermaidBlocks = blocks.filter((b) => b.dataset.kind === 'mermaid');
    if (mermaidBlocks.length) {
      if (!globalThis.__mdlMermaid) await send({ type: 'inject', file: 'mermaid.js' });
      const mermaid = globalThis.__mdlMermaid;
      if (mermaid && id === renderId) {
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: isDark() ? 'dark' : 'default' });
        let n = 0;
        for (const block of mermaidBlocks) {
          try {
            const { svg } = await mermaid.render(`mdl-mermaid-${id}-${n++}`, block.textContent);
            if (id !== renderId) return;
            block.replaceWith(h('div', { class: 'mdl-diagram-out', html: svg }));
          } catch (e) {
            if (id !== renderId) return;
            block.classList.add('mdl-diagram-error');
            block.before(h('div', { class: 'mdl-diagram-msg' }, String((e && e.message) || e)));
            for (const junk of document.querySelectorAll(`body > [id^="dmdl-mermaid-${id}-"]`)) junk.remove();
          }
        }
      }
    }

    for (const block of blocks.filter((b) => b.dataset.kind === 'plantuml')) {
      const url = await plantumlUrl(block.textContent);
      if (id !== renderId) return;
      block.replaceWith(h('div', { class: 'mdl-diagram-out' }, h('img', { src: url, alt: 'PlantUML diagram' })));
    }
  }

  function buildToc() {
    const nav = h('nav', { class: 'mdl-toc' });
    const min = Math.min(...headings.map((el) => +el.tagName[1]), 6);
    for (const el of headings) {
      const level = +el.tagName[1] - min;
      nav.append(
        h('a', { href: `#${encodeURIComponent(el.id)}`, style: `padding-left:${level * 18}px` }, el.textContent),
      );
    }
    return nav;
  }

  // ---------- outline ----------
  let outlineItems = [];
  const collapsed = new Set();

  function buildOutline() {
    outlineItems = [];
    activeRow = null;
    outlinePanel.replaceChildren();
    if (!headings.length) {
      outlinePanel.append(h('div', { class: 'mdl-empty' }, t(kind === 'dir' ? 'folder.empty' : 'outline.empty')));
      return;
    }
    const min = Math.min(...headings.map((el) => +el.tagName[1]));
    headings.forEach((el, i) => {
      const key = el.id || `#${i}`;
      const level = +el.tagName[1] - min;
      const next = headings[i + 1];
      const hasChildren = !!next && +next.tagName[1] - min > level;
      const text = el.textContent.trim();
      const row = h('div', {
        class: `mdl-ol-item${level === 0 ? ' top' : ''}`,
        style: `padding-left:${10 + level * 14}px`,
        title: text,
        'data-filter': text.toLowerCase(),
      });
      if (settings.outlineCollapse) {
        const caret = h('span', { class: `mdl-caret${hasChildren ? '' : ' none'}`, html: ICON.caret });
        if (hasChildren) {
          caret.addEventListener('click', (e) => {
            e.stopPropagation();
            if (collapsed.has(key)) collapsed.delete(key);
            else collapsed.add(key);
            updateCollapse();
          });
        }
        row.append(caret);
      }
      row.append(h('span', { class: 'mdl-ol-text' }, text));
      row.addEventListener('click', () => {
        pinned = outlineItems.find((item) => item.el === el) || null;
        spy();
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (el.id && mode === 'view') history.replaceState(null, '', `#${encodeURIComponent(el.id)}`);
      });
      outlinePanel.append(row);
      outlineItems.push({ el, row, level, key });
    });
    updateCollapse();
    applyFilter();
    spy();
  }

  function updateCollapse() {
    let hideBelow = Infinity;
    for (const item of outlineItems) {
      if (item.level <= hideBelow) hideBelow = Infinity;
      item.row.classList.toggle('mdl-collapsed-child', item.level > hideBelow);
      const isCollapsed = settings.outlineCollapse && collapsed.has(item.key);
      item.row.classList.toggle('collapsed', isCollapsed);
      if (isCollapsed && hideBelow === Infinity) hideBelow = item.level;
    }
  }

  let spyQueued = false;
  let activeRow = null;
  // A clicked heading near the end of the page can't scroll up to the top, so
  // keep it marked active until the user scrolls on their own.
  let pinned = null;
  for (const type of ['wheel', 'touchmove', 'keydown', 'mousedown']) {
    window.addEventListener(type, () => (pinned = null), { passive: true, capture: true });
  }
  function spy() {
    spyQueued = false;
    let current = null;
    for (const item of outlineItems) {
      if (item.el.getBoundingClientRect().top <= 96) current = item;
      else break;
    }
    if (pinned && outlineItems.includes(pinned)) current = pinned;
    const row = current ? current.row : outlineItems[0] && outlineItems[0].row;
    if (row === activeRow) return;
    if (activeRow) activeRow.classList.remove('active');
    activeRow = row || null;
    if (activeRow) {
      activeRow.classList.add('active');
      if (tab === 'outline') {
        const r = activeRow.getBoundingClientRect();
        const p = outlinePanel.getBoundingClientRect();
        if (r.top < p.top + 8 || r.bottom > p.bottom - 8) activeRow.scrollIntoView({ block: 'center' });
      }
    }
  }
  window.addEventListener(
    'scroll',
    () => {
      if (!spyQueued) {
        spyQueued = true;
        requestAnimationFrame(spy);
      }
    },
    { passive: true },
  );

  // ---------- folder browsing ----------
  let rootUrl = kind === 'dir' ? pageUrl() : new URL('.', pageUrl()).href;

  const dirName = (url) => decode(url.replace(/\/$/, '').split('/').pop()) || '/';

  async function listDir(url) {
    const r = await send({ type: 'listDir', url });
    if (!r.ok) return null;
    return r.entries
      .filter((e) => !e.name.startsWith('.'))
      .filter((e) => e.isDir || MD_EXT.test(e.name) || (settings.renderTxt && /\.txt$/i.test(e.name)))
      .sort((a, b) => b.isDir - a.isDir || a.name.localeCompare(b.name, undefined, { numeric: true }));
  }

  async function fillDir(url, container, depth) {
    const entries = await listDir(url);
    container.replaceChildren();
    if (!entries) {
      container.append(h('div', { class: 'mdl-empty' }, t('folder.error')));
      return;
    }
    if (!entries.length) {
      container.append(h('div', { class: 'mdl-empty', style: `padding-left:${12 + depth * 14}px` }, t('folder.empty')));
      return;
    }
    for (const e of entries) {
      const pad = `padding-left:${8 + depth * 14}px`;
      if (e.isDir) {
        const children = h('div', { class: 'mdl-children', hidden: true });
        const row = h(
          'div',
          { class: 'mdl-row dir', style: pad, title: e.name },
          h('span', { class: 'mdl-caret', html: ICON.caret }),
          h('span', { class: 'mdl-row-icon', html: ICON.folder }),
          h('span', { class: 'mdl-row-name' }, e.name),
        );
        let loaded = false;
        row.addEventListener('click', () => {
          children.hidden = !children.hidden;
          row.classList.toggle('open', !children.hidden);
          if (!loaded) {
            loaded = true;
            fillDir(e.url, children, depth + 1).then(applyFilter);
          }
        });
        container.append(row, children);
      } else {
        container.append(
          h(
            'a',
            {
              class: `mdl-row file${e.url === pageUrl() ? ' active' : ''}`,
              href: e.url,
              style: pad,
              title: e.name,
              'data-filter': e.name.toLowerCase(),
            },
            h('span', { class: 'mdl-caret none' }),
            h('span', { class: 'mdl-row-icon', html: ICON.file }),
            h('span', { class: 'mdl-row-name' }, e.name),
          ),
        );
      }
    }
  }

  function renderFolder() {
    if (!isFile) {
      folderPanel.replaceChildren(h('div', { class: 'mdl-empty' }, t('folder.localOnly')));
      return;
    }
    const list = h('div', { class: 'mdl-tree' });
    const parent = new URL('..', rootUrl).href;
    folderPanel.replaceChildren(
      h(
        'div',
        { class: 'mdl-folder-head' },
        h('button', {
          class: 'mdl-icon-btn small',
          title: t('folder.up'),
          html: ICON.up,
          disabled: parent === rootUrl,
          onclick: () => {
            rootUrl = parent;
            renderFolder();
          },
        }),
        h('span', { class: 'mdl-folder-name', title: decode(new URL(rootUrl).pathname) }, dirName(rootUrl)),
        settings.folderRender
          ? h('a', { class: 'mdl-icon-btn small', title: t('folder.open'), href: rootUrl, html: ICON.open })
          : null,
      ),
      list,
    );
    fillDir(rootUrl, list, 0).then(applyFilter);
  }

  // Main area when the page itself is a folder.
  async function renderDirPage() {
    const url = pageUrl();
    const segments = decode(new URL(url).pathname).split('/').filter(Boolean);
    const crumbs = h('div', { class: 'mdl-crumbs' }, h('a', { href: 'file:///' }, '/'));
    segments.forEach((seg, i) => {
      const href = `file:///${segments.slice(0, i + 1).map(encodeURIComponent).join('/')}/`;
      crumbs.append(h('a', { href }, seg));
      if (i < segments.length - 1) crumbs.append(h('span', null, '/'));
    });
    const list = h('div', { class: 'mdl-dir-list' });
    article.replaceChildren(h('h1', null, dirName(url)), crumbs, list);
    document.title = dirName(url);
    headings = [];
    buildOutline();

    const entries = await listDir(url);
    if (!entries || !entries.length) {
      list.append(h('div', { class: 'mdl-empty' }, t(entries ? 'folder.empty' : 'folder.error')));
      return;
    }
    for (const e of entries) {
      list.append(
        h(
          'a',
          { class: `mdl-dir-entry${e.isDir ? ' dir' : ''}`, href: e.url },
          h('span', { class: 'mdl-row-icon', html: e.isDir ? ICON.folder : ICON.file }),
          h('span', { class: 'mdl-row-name' }, e.name),
          e.mtime ? h('span', { class: 'mdl-dir-date' }, new Date(e.mtime * 1000).toLocaleDateString()) : null,
        ),
      );
    }
  }

  // ---------- editing ----------
  let mode = 'view';
  let editor = null;
  let front = '';
  let dirty = false;
  let saving = false;
  let fileHandle = null;
  let outlineTimer = null;
  let saveTimer = null;
  const canPick = typeof window.showSaveFilePicker === 'function';

  function updateStatus(message) {
    status.hidden = mode !== 'edit' && !dirty;
    document.documentElement.classList.toggle('mdl-dirty', dirty);
    let text = message;
    if (!text) {
      if (editor && !editor.lossless) text = t('edit.lossy');
      else if (dirty) text = t('edit.dirty');
      else if (fileHandle) text = `${t('edit.saved')} · ${fileHandle.name}`;
      else text = t(canPick ? 'edit.pickHint' : 'edit.downloadHint');
    }
    statusText.textContent = text;
    saveBtn.disabled = saving;
  }

  const currentText = () => (editor ? front + editor.getMarkdown() : source);

  function editorHeadings() {
    headings = [...editorHost.querySelectorAll('.ProseMirror :is(h1,h2,h3,h4,h5,h6)')];
    buildOutline();
  }

  function onEdit() {
    dirty = true;
    updateStatus();
    clearTimeout(outlineTimer);
    outlineTimer = setTimeout(editorHeadings, 300);
    if (settings.autoSave && fileHandle && editor && editor.lossless) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => save(false), 1000);
    }
  }

  function previewDiagram(language, content, apply) {
    if (language !== 'mermaid' || !settings.plugins.mermaid || !content.trim()) return null;
    (async () => {
      if (!globalThis.__mdlMermaid) await send({ type: 'inject', file: 'mermaid.js' });
      const mermaid = globalThis.__mdlMermaid;
      if (!mermaid) return;
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: isDark() ? 'dark' : 'default' });
      const out = h('div', { class: 'mdl-diagram-out' });
      try {
        const { svg } = await mermaid.render(`mdl-preview-${Date.now()}-${Math.random().toString(36).slice(2)}`, content);
        out.innerHTML = svg;
      } catch (e) {
        out.textContent = String((e && e.message) || e);
        for (const junk of document.querySelectorAll('body > [id^="dmdl-preview-"]')) junk.remove();
      }
      apply(out);
    })();
    return h('div', { class: 'mdl-diagram-out' });
  }

  // Remember roughly where the reader was when switching between modes.
  const headingIndex = () => Math.max(0, outlineItems.findIndex((item) => item.row === activeRow));

  function leaveEditUi() {
    mode = 'view';
    editor = null;
    document.documentElement.classList.remove('mdl-editing');
    editBtn.classList.remove('active');
    editorHost.hidden = true;
    editorHost.replaceChildren();
    article.hidden = false;
  }

  // If the editor cannot start, never leave the reader with an empty page:
  // go back to the rendered view and say what went wrong.
  function editFailed(error) {
    leaveEditUi();
    const detail = String((error && (error.stack || error.message)) || error).split('\n').slice(0, 4).join('\n');
    console.error('[MD Lens] editor failed', error);
    for (const old of article.querySelectorAll('.mdl-notice.error')) old.remove();
    const card = h(
      'div',
      { class: 'mdl-notice error' },
      h('div', { class: 'mdl-notice-text' }, h('b', null, t('edit.loadFailed')), h('code', null, detail)),
      h('div', { class: 'mdl-notice-actions' }, h('button', { onclick: () => card.remove() }, t('puml.close'))),
    );
    article.prepend(card);
    window.scrollTo(0, 0);
    updateStatus();
  }

  let entering = false;
  async function enterEdit() {
    if (mode === 'edit' || kind !== 'md' || entering) return;
    entering = true;
    if (!rawView.hidden) await toggleRaw();
    const at = headingIndex();
    const wasTop = window.scrollY < 40;
    try {
      if (!globalThis.__mdlEditor) {
        const css = await send({ type: 'insertCss', file: 'editor.css' });
        await send({ type: 'insertCss', file: 'katex.css' });
        katexCssLoaded = true;
        const js = await send({ type: 'inject', file: 'editor.js' });
        if (!globalThis.__mdlEditor) throw new Error(js.error || css.error || t('edit.reloadHint'));
      }
      const m = source.match(FRONT_MATTER);
      front = m ? m[0] : '';
      // Built off-screen first, so a failure cannot blank the page.
      const created = await Promise.race([
        globalThis.__mdlEditor.create({
          root: editorHost,
          markdown: source.slice(front.length),
          onChange: onEdit,
          renderPreview: previewDiagram,
          placeholder: t('edit.placeholder'),
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout: editor did not start within 20s')), 20000)),
      ]);
      if (!editorHost.querySelector('.ProseMirror')) throw new Error('editor produced no content');
      editor = created;
      mode = 'edit';
      document.documentElement.classList.add('mdl-editing');
      editBtn.classList.add('active');
      article.hidden = true;
      editorHost.hidden = false;
      editorHeadings();
      if (!wasTop && headings[at]) headings[at].scrollIntoView();
      else window.scrollTo(0, 0);
    } catch (e) {
      editFailed(e);
      entering = false;
      return;
    }
    entering = false;
    try {
      if (!fileHandle) {
        const stored = await idb('readonly', (store) => store.get(pageUrl()));
        if (stored && stored.queryPermission && (await stored.queryPermission({ mode: 'readwrite' })) === 'granted') {
          fileHandle = stored;
        }
      }
    } catch {}
    updateStatus();
  }

  async function exitEdit() {
    if (mode !== 'edit') return;
    const at = headingIndex();
    const wasTop = window.scrollY < 40;
    clearTimeout(outlineTimer);
    const old = editor;
    try {
      source = currentText();
    } catch (e) {
      console.error('[MD Lens] could not read editor content', e);
    }
    leaveEditUi();
    try {
      await old.destroy();
    } catch {}
    await render();
    if (!wasTop && headings[at]) headings[at].scrollIntoView();
    updateStatus();
  }

  function toggleEdit() {
    return mode === 'edit' ? exitEdit() : enterEdit();
  }

  async function acquireHandle() {
    const stored = await idb('readonly', (store) => store.get(pageUrl()));
    if (stored && stored.requestPermission) {
      try {
        if ((await stored.requestPermission({ mode: 'readwrite' })) === 'granted') return stored;
      } catch {}
    }
    const ext = (fileName.match(/\.[^.]+$/) || ['.md'])[0].toLowerCase();
    const handle = await window.showSaveFilePicker({
      id: 'mdlens',
      suggestedName: fileName,
      types: [{ description: 'Markdown', accept: { 'text/markdown': [...new Set([ext, '.md', '.markdown', '.txt'])] } }],
    });
    await idb('readwrite', (store) => store.put(handle, pageUrl()));
    return handle;
  }

  // interactive = started by the user (button / shortcut); may open a picker.
  async function save(interactive) {
    if (saving) return;
    const text = currentText();
    if (!canPick) {
      if (!interactive) return;
      const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/markdown' })), download: fileName });
      a.click();
      URL.revokeObjectURL(a.href);
      source = text;
      dirty = false;
      updateStatus(t('edit.downloaded'));
      return;
    }
    saving = true;
    updateStatus(t('edit.saving'));
    try {
      if (!fileHandle) {
        if (!interactive) return;
        fileHandle = await acquireHandle();
      }
      const writable = await fileHandle.createWritable();
      await writable.write(text);
      await writable.close();
      source = text;
      dirty = currentText() !== text;
      saving = false;
      updateStatus();
    } catch (e) {
      saving = false;
      if (e && e.name === 'AbortError') {
        updateStatus();
      } else {
        if (e && e.name === 'NotAllowedError') fileHandle = null;
        updateStatus(`${t('edit.failed')}: ${(e && e.message) || e}`);
      }
    } finally {
      saving = false;
    }
  }

  window.addEventListener('beforeunload', (e) => {
    if (dirty) e.preventDefault();
  });

  // ---------- menu actions ----------
  async function toggleRaw() {
    if (mode === 'edit') await exitEdit();
    const showRaw = rawView.hidden;
    if (showRaw) rawView.textContent = source;
    rawView.hidden = !showRaw;
    article.hidden = showRaw;
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  document.addEventListener('keydown', (e) => {
    const mod = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
    if (mod && e.key.toLowerCase() === 's' && (mode === 'edit' || dirty)) {
      e.preventDefault();
      save(true);
    } else if (mod && e.key.toLowerCase() === 'e' && kind === 'md') {
      e.preventDefault();
      toggleEdit();
    }
    if (e.key === 'Escape') {
      if (!menu.hidden) menu.hidden = true;
      else if (settings.zen) update({ zen: false });
    }
  });

  // ---------- sidebar resize ----------
  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    document.documentElement.classList.add('mdl-resizing');
    let width = settings.sidebarWidth;
    const move = (ev) => {
      width = Math.min(600, Math.max(200, ev.clientX));
      document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.documentElement.classList.remove('mdl-resizing');
      update({ sidebarWidth: width });
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  // ---------- auto refresh ----------
  let timer = null;
  let busy = false;
  function setupRefresh() {
    clearInterval(timer);
    timer = null;
    if (kind !== 'md' || !settings.autoRefresh) return;
    const sec = Math.min(600, Math.max(0.5, Number(settings.refreshInterval) || 2));
    timer = setInterval(async () => {
      if (busy || document.hidden || mode === 'edit' || dirty) return;
      busy = true;
      const r = await send({ type: 'fetchText', url: pageUrl() });
      busy = false;
      if (r.ok && clean(r.text) !== source) {
        source = clean(r.text);
        if (!rawView.hidden) rawView.textContent = source;
        render();
      }
    }, sec * 1000);
  }

  // ---------- react to setting changes ----------
  const RELOAD_KEYS = ['enabled', 'language', 'charsetCompat', 'folderRender', 'renderTxt'];
  onSettingsChanged((next, prev) => {
    if (RELOAD_KEYS.some((k) => next[k] !== prev[k])) {
      location.reload();
      return;
    }
    const wasDark = isDark();
    // Keep width while the user is dragging the resizer in this tab.
    settings = next;
    applyAppearance();
    if (kind === 'md' && mode === 'view') {
      const pluginsChanged = JSON.stringify(next.plugins) !== JSON.stringify(prev.plugins);
      const themeFlip = wasDark !== isDark() && article.querySelector('.mdl-diagram-out, .mdl-diagram');
      if (next.breaks !== prev.breaks || pluginsChanged || themeFlip) render();
      else if (next.outlineCollapse !== prev.outlineCollapse) buildOutline();
    }
    if (next.autoRefresh !== prev.autoRefresh || next.refreshInterval !== prev.refreshInterval) setupRefresh();
  });
  mq.addEventListener('change', () => {
    applyAppearance();
    if (kind === 'md' && mode === 'view' && article.querySelector('.mdl-diagram-out')) render();
  });

  // ---------- go ----------
  applyAppearance();
  setTab(tab, false);
  if (kind === 'dir') {
    await renderDirPage();
  } else {
    await render();
    if (location.hash) {
      const target = document.getElementById(decode(location.hash.slice(1)));
      if (target) target.scrollIntoView();
    }
    setupRefresh();
    if (settings.editByDefault) await enterEdit();
  }
})();
