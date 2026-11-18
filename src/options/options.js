import {
  DEFAULTS, PLUGIN_KEYS, FONTS, FONT_SIZES, loadSettings, saveSettings, resetSettings, onSettingsChanged,
} from '../shared/settings.js';
import { translator } from '../shared/i18n.js';

const ICONS = {
  general:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M10.3 2h3.4l.5 2.6 1.7.7 2.2-1.5 2.4 2.4-1.5 2.2.7 1.7 2.6.5v3.4l-2.6.5-.7 1.7 1.5 2.2-2.4 2.4-2.2-1.5-1.7.7-.5 2.6h-3.4l-.5-2.6-1.7-.7-2.2 1.5-2.4-2.4 1.5-2.2-.7-1.7L2 13.7v-3.4l2.6-.5.7-1.7-1.5-2.2 2.4-2.4 2.2 1.5 1.700-.7zM12 8.500a3.500 3.500 0 1 0 0 7 3.500 3.500 0 0 0 0-7z"/></svg>',
  appearance:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M12 3a9 9 0 0 0 0 18c1.400 0 2.200-1 2.200-2 0-.600-.200-1-.500-1.400-.300-.400-.500-.700-.500-1.200 0-.900.700-1.600 1.600-1.600H17a4 4 0 0 0 4-4c0-4.300-4-7.800-9-7.800zM7 13.500a1.500 1.500 0 1 1 0-3 1.500 1.500 0 0 1 0 3zm2.500-4.500a1.500 1.500 0 1 1 0-3 1.500 1.500 0 0 1 0 3zm5 0a1.500 1.500 0 1 1 0-3 1.500 1.500 0 0 1 0 3zm2.500 4.500a1.500 1.500 0 1 1 0-3 1.500 1.500 0 0 1 0 3z"/></svg>',
  plugins:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 2h2v5H8zM14 2h2v5h-2zM5 8h14v3a7 7 0 0 1-5.500 6.800V22h-3v-4.200A7 7 0 0 1 5 11z"/></svg>',
  about:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.200 5.200a1.300 1.300 0 1 1 2.600 0 1.300 1.300 0 0 1-2.600 0zM10 10.500h3.200v5.300H15v1.700H9.500v-1.700h1.700v-3.600H10z"/></svg>',
};

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

let settings = DEFAULTS;
let t = translator('ko');
let activeTab = 'general';
let fileAccess = true;

const nav = document.getElementById('nav');
const content = document.getElementById('content');

async function set(patch) {
  settings = await saveSettings(patch);
  draw();
}

// ---------- controls ----------
function label(key, extra) {
  const desc = t(`${key}.desc`);
  return h('div', { class: 'label' }, h('b', null, t(key)), desc !== `${key}.desc` ? h('small', null, desc) : null, extra);
}

function switchEl(checked, onChange, disabled) {
  const input = h('input', { type: 'checkbox', disabled });
  input.checked = !!checked;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'switch' }, input, h('span'));
}

function toggleRow(key, labelKey = `opt.${key}`) {
  return h('div', { class: 'row' }, label(labelKey), switchEl(settings[key], (v) => set({ [key]: v })));
}

function segRow(key, options) {
  return h(
    'div',
    { class: 'row' },
    label(`opt.${key}`),
    h(
      'div',
      { class: 'seg' },
      options.map(([value, text]) =>
        h('button', { class: settings[key] === value ? 'active' : '', onclick: () => set({ [key]: value }) }, text),
      ),
    ),
  );
}

function selectEl(value, options, onChange, disabled) {
  const sel = h('select', { disabled }, options.map(([v, text]) => h('option', { value: v }, text)));
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

// ---------- tabs ----------
function general() {
  const interval = h('input', {
    type: 'number', min: 0.5, max: 600, step: 0.5, value: settings.refreshInterval, disabled: !settings.autoRefresh,
  });
  interval.addEventListener('change', () => {
    const n = Math.min(600, Math.max(0.5, Number(interval.value) || DEFAULTS.refreshInterval));
    set({ refreshInterval: n });
  });

  const access = h(
    'div',
    { class: 'label link', onclick: () => chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }) },
    h('b', null, t('opt.fileAccess')),
    h('small', { class: fileAccess ? '' : 'warn' }, t(fileAccess ? 'opt.fileAccess.on' : 'opt.fileAccess.off')),
  );

  return [
    h('h1', null, t('opt.tab.general')),
    toggleRow('enabled'),
    h('div', { class: 'row' }, access, switchEl(fileAccess, () => {}, true)),
    toggleRow('breaks'),
    toggleRow('outlineCollapse'),
    toggleRow('folderRender'),
    toggleRow('renderTxt'),
    toggleRow('autoRefresh'),
    h('div', { class: 'row' }, label('opt.refreshInterval'), h('div', { class: 'control' }, interval, h('span', { class: 'unit' }, t('opt.sec')))),
    toggleRow('charsetCompat'),
    h('div', { class: 'row' }, label('opt.language'), selectEl(settings.language, [['ko', '한국어'], ['en', 'English']], (v) => set({ language: v }))),
    h(
      'div',
      { class: 'actions' },
      h('button', {
        class: 'btn danger',
        onclick: async () => {
          if (!confirm(t('opt.reset.confirm'))) return;
          settings = await resetSettings();
          draw();
        },
      }, t('opt.reset')),
    ),
  ];
}

function appearance() {
  const size = h('input', { type: 'range', min: 0, max: FONT_SIZES.length - 1, step: 1, value: settings.fontSize });
  size.addEventListener('change', () => set({ fontSize: Number(size.value) }));

  const pct = settings.maxWidthUnit === '%';
  const [min, max] = pct ? [20, 100] : [500, 3000];
  const off = !settings.customWidth;
  const range = h('input', { type: 'range', min, max, step: pct ? 1 : 10, value: settings.maxWidth, disabled: off });
  const number = h('input', { type: 'number', min, max, value: settings.maxWidth, disabled: off });
  const commit = (v) => set({ maxWidth: Math.min(max, Math.max(min, Number(v) || min)) });
  range.addEventListener('input', () => (number.value = range.value));
  range.addEventListener('change', () => commit(range.value));
  number.addEventListener('change', () => commit(number.value));
  const unit = selectEl(settings.maxWidthUnit, [['px', 'px'], ['%', '%']], (v) => set({ maxWidthUnit: v, maxWidth: v === '%' ? 80 : 1000 }), off);

  const css = h('textarea', { placeholder: t('opt.customCss.placeholder'), disabled: !settings.customCssEnabled, spellcheck: 'false' });
  css.value = settings.customCss;

  const sun = '☀︎';
  const moon = '☾';
  return [
    h('h1', null, t('opt.tab.appearance')),
    h(
      'div',
      { class: 'row' },
      label('opt.fontSize'),
      h('div', { class: 'sizer' }, size, h('div', { class: 'ticks' }, FONT_SIZES.map((px, i) => h('span', { style: `font-size:${10 + i * 2}px` }, '가')))),
    ),
    h('div', { class: 'row' }, label('opt.fontFamily'), selectEl(settings.fontFamily, Object.keys(FONTS).map((k) => [k, t(`opt.font.${k}`)]), (v) => set({ fontFamily: v }))),
    segRow('theme', [['auto', t('opt.theme.auto')], ['light', sun], ['dark', moon]]),
    segRow('codeThemeLight', [['light', sun], ['dark', moon]]),
    segRow('codeThemeDark', [['light', sun], ['dark', moon]]),
    toggleRow('codeWrap'),
    toggleRow('wideTable'),
    toggleRow('zen'),
    toggleRow('centered'),
    toggleRow('customWidth'),
    h('div', { class: 'width-row' }, h('span', { class: 'unit' }, min), range, h('span', { class: 'unit' }, max), number, unit),
    toggleRow('customCssEnabled'),
    h(
      'div',
      { class: 'row stack' },
      css,
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn', disabled: !settings.customCssEnabled, onclick: () => (css.value = settings.customCss) }, t('opt.cancel')),
        h('button', { class: 'btn primary', disabled: !settings.customCssEnabled, onclick: () => set({ customCss: css.value }) }, t('opt.applyCss')),
      ),
    ),
  ];
}

function plugins() {
  const all = PLUGIN_KEYS.every((k) => settings.plugins[k]);
  return [
    h('h1', null, t('opt.tab.plugins')),
    h(
      'div',
      { class: 'row' },
      label('opt.plugins.all'),
      switchEl(all, (v) => set({ plugins: Object.fromEntries(PLUGIN_KEYS.map((k) => [k, v])) })),
    ),
    toggleRow('breaks'),
    PLUGIN_KEYS.map((k) =>
      h('div', { class: 'row' }, label(`opt.p.${k}`), switchEl(settings.plugins[k], (v) => set({ plugins: { [k]: v } }))),
    ),
  ];
}

function about() {
  const m = chrome.runtime.getManifest();
  return [
    h('h1', null, m.name),
    h(
      'div',
      { class: 'about' },
      h('p', null, t('opt.about.desc')),
      h('p', { class: 'muted' }, `${t('opt.about.version')} ${m.version}`),
      h('p', { class: 'muted' }, t('opt.about.usage')),
    ),
  ];
}

const TABS = { general, appearance, plugins, about };

function draw() {
  t = translator(settings.language);
  document.documentElement.lang = settings.language;
  const scroll = content.scrollTop;
  nav.replaceChildren(
    ...Object.keys(TABS).map((id) =>
      h('button', {
        class: id === activeTab ? 'active' : '',
        title: t(`opt.tab.${id}`),
        html: ICONS[id],
        onclick: () => {
          activeTab = id;
          content.scrollTop = 0;
          draw();
        },
      }),
    ),
  );
  content.replaceChildren(...TABS[activeTab]().flat());
  content.scrollTop = scroll;
}

(async () => {
  if (new URLSearchParams(location.search).has('popup')) document.body.classList.add('popup');
  settings = await loadSettings();
  fileAccess = await new Promise((r) => chrome.extension.isAllowedFileSchemeAccess(r));
  draw();
  // Stay in sync with changes made from the viewer (zen mode, etc.).
  onSettingsChanged((next) => {
    if (JSON.stringify(next) === JSON.stringify(settings)) return;
    settings = next;
    if (!content.contains(document.activeElement) || document.activeElement.tagName !== 'TEXTAREA') draw();
  });
})();
