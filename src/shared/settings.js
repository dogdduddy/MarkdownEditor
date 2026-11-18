export const PLUGIN_KEYS = [
  'linkify', 'typographer', 'emoji', 'sup', 'sub', 'toc', 'ins', 'mark', 'math',
  'mermaid', 'plantuml', 'abbr', 'deflist', 'footnote', 'frontMatter', 'mmdTable',
  'taskList', 'alerts',
];

export const DEFAULTS = {
  // general
  enabled: true,
  breaks: false,
  outlineCollapse: false,
  folderRender: true,
  renderTxt: true,
  autoRefresh: false,
  refreshInterval: 2,
  charsetCompat: false,
  language: 'ko',
  editByDefault: false,
  autoSave: true,
  plantumlPrompt: true,
  // appearance
  fontSize: 2,
  fontFamily: 'default',
  theme: 'auto',
  codeThemeLight: 'light',
  codeThemeDark: 'dark',
  codeWrap: false,
  wideTable: false,
  zen: false,
  centered: true,
  customWidth: false,
  maxWidth: 1000,
  maxWidthUnit: 'px',
  customCssEnabled: false,
  customCss: '',
  // viewer state
  sidebarOpen: true,
  sidebarTab: 'outline',
  sidebarWidth: 300,
  // plugins
  plugins: {
    linkify: true,
    typographer: false,
    emoji: true,
    sup: true,
    sub: true,
    toc: true,
    ins: true,
    mark: true,
    math: true,
    mermaid: true,
    // PlantUML is rendered by the public plantuml.com server, so the diagram
    // source leaves the machine. Off unless the user opts in.
    plantuml: false,
    abbr: true,
    deflist: true,
    footnote: true,
    frontMatter: true,
    mmdTable: true,
    taskList: true,
    alerts: true,
  },
};

export const FONT_SIZES = [13, 14, 16, 17, 19, 22];

export const FONTS = {
  default: '',
  system: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  gothic: '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif',
  pretendard: 'Pretendard, "Apple SD Gothic Neo", sans-serif',
  serif: '"Noto Serif KR", "Nanum Myeongjo", AppleMyungjo, Georgia, serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

function merge(stored) {
  const s = { ...DEFAULTS, ...(stored || {}) };
  s.plugins = { ...DEFAULTS.plugins, ...((stored && stored.plugins) || {}) };
  return s;
}

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return merge(settings);
}

export async function saveSettings(patch) {
  const cur = await loadSettings();
  const next = { ...cur, ...patch };
  if (patch.plugins) next.plugins = { ...cur.plugins, ...patch.plugins };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export async function resetSettings() {
  await chrome.storage.local.set({ settings: merge(null) });
  return merge(null);
}

export function onSettingsChanged(cb) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    cb(merge(changes.settings.newValue), merge(changes.settings.oldValue));
  });
}
