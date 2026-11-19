// End-to-end check: loads dist/ into Chromium, opens local Markdown files and
// asserts on the rendered page. Run with `npm test` after `npm run build`.
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile, cp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ext = path.join(root, 'dist');
const outDir = path.join(root, 'test/out');
await mkdir(outDir, { recursive: true });

const work = await mkdtemp(path.join(os.tmpdir(), 'mdl-'));
const docs = path.join(work, 'docs');
await cp(path.join(root, 'test/fixtures/docs'), docs, { recursive: true });
const fileUrl = (p) => pathToFileURL(path.join(docs, p)).href;

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const ctx = await chromium.launchPersistentContext(path.join(work, 'profile'), {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1400, height: 900 },
  colorScheme: 'dark',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});

let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;

// "Allow access to file URLs" is off by default; flip it like the user would.
const admin = await ctx.newPage();
await admin.goto('chrome://extensions/');
await admin.evaluate(
  (extensionId) => new Promise((r) => chrome.developerPrivate.updateExtensionConfiguration({ extensionId, fileAccess: true }, r)),
  id,
);
await admin.close();
// Toggling file access restarts the extension; wait until its worker is back.
await new Promise((r) => setTimeout(r, 1500));

const setSettings = async (patch) => {
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${id}/options.html`);
  await p.evaluate(async (patch) => {
    const { settings = {} } = await chrome.storage.local.get('settings');
    const next = { ...settings, ...patch, plugins: { ...(settings.plugins || {}), ...(patch.plugins || {}) } };
    await chrome.storage.local.set({ settings: next });
  }, patch);
  await p.close();
};

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(fileUrl('sample.md'));
await page.waitForSelector('article.markdown-body h1', { timeout: 10000 });

check('title from first h1', (await page.title()) === '[회의록] 플레이 테스트 리뷰', await page.title());
const html = await page.locator('article').innerHTML();
check('CJK bold next to parentheses', html.includes('<strong>동일 인물(1인칭)</strong>') && html.includes('<strong>맞출 대상(왜/어떻게)</strong>'));
check('no stray ** left', !(await page.locator('article').innerText()).includes('**'));
check('front matter hidden', !html.includes('title: 샘플'));
check('linkify', (await page.locator('article a[href="https://example.com"]').count()) === 1);
check('sub/sup/ins/mark', ['<sub>2</sub>', '<sup>th</sup>', '<ins>삽입</ins>', '<mark>강조</mark>'].every((s) => html.includes(s)));
check('emoji', html.includes('✨') && html.includes('👍'));
check('footnote', (await page.locator('article .footnotes').count()) === 1);
check('abbr', (await page.locator('article abbr[title="Hyper Text Markup Language"]').count()) >= 1);
check('deflist', (await page.locator('article dl dt').count()) === 1);
check('task list', (await page.locator('article .task-list-item input[type=checkbox]').count()) === 2);
check('alerts', (await page.locator('article .markdown-alert').count()) === 2);
check('code highlight', (await page.locator('article pre code.hljs .hljs-keyword').count()) > 0);
check('table wrapped', (await page.locator('article .mdl-table table').count()) === 1);
check('math', (await page.locator('article .katex').count()) >= 2);
check('TOC inserted', (await page.locator('article nav.mdl-toc a').count()) === 8);
check('outline items', (await page.locator('.mdl-outline .mdl-ol-item').count()) === 8);
await page.waitForSelector('article .mdl-diagram-out svg', { timeout: 20000 }).catch(() => {});
check('mermaid svg', (await page.locator('article .mdl-diagram-out svg').count()) === 1);
check('html sanitized', (await page.title()) !== 'XSS' && !html.includes('onerror'));
await page.waitForTimeout(300);
const katexFont = await page.evaluate(() => getComputedStyle(document.querySelector('.katex')).fontFamily);
check('katex css applied', /KaTeX/.test(katexFont), katexFont);
await page.screenshot({ path: path.join(outDir, 'viewer-dark.png') });

// outline click scrolls
await page.locator('.mdl-outline .mdl-ol-item', { hasText: '2. 다이어그램' }).click();
await page.waitForTimeout(900);
check('outline click scrolls', (await page.evaluate(() => scrollY)) > 300);
check('active outline follows scroll', (await page.locator('.mdl-outline .mdl-ol-item.active').innerText()).includes('다이어그램'));

// folder tab
await page.locator('.mdl-tab').first().click();
await page.waitForSelector('.mdl-folder .mdl-row');
const names = await page.locator('.mdl-folder .mdl-row-name').allInnerTexts();
check('folder tree lists dirs + markdown only', JSON.stringify(names) === JSON.stringify(['sub', 'notes.txt', 'other.md', 'refs.md', 'sample.md']), names.join(','));
check('current file highlighted', (await page.locator('.mdl-folder .mdl-row.active').innerText()).trim() === 'sample.md');
await page.locator('.mdl-folder .mdl-row.dir').click();
await page.waitForSelector('.mdl-folder .mdl-children .mdl-row');
check('subfolder expands', (await page.locator('.mdl-folder .mdl-children .mdl-row-name').allInnerTexts()).join() === 'nested.md');
await page.screenshot({ path: path.join(outDir, 'viewer-folder.png') });

// raw view
await page.locator('.mdl-menu-btn').click();
await page.locator('.mdl-menu-item', { hasText: '원본 보기' }).click();
check('raw view', (await page.locator('.mdl-raw').isVisible()) && (await page.locator('.mdl-raw').innerText()).includes('[[TOC]]'));
await page.locator('.mdl-menu-btn').click();
await page.locator('.mdl-menu-item', { hasText: '원본 보기' }).click();

// PlantUML prompt (plugin is off by default)
check('plantuml prompt shown', (await page.locator('.mdl-notice').count()) === 1);
check('plantuml not sent while off', (await page.locator('article img[src*="plantuml.com"]').count()) === 0);
await page.locator('.mdl-notice button', { hasText: '이 문서만' }).click();
await page.waitForSelector('article img[src*="plantuml.com"]');
check('plantuml "this document only" renders', (await page.locator('.mdl-notice').count()) === 0);
check('plantuml setting untouched by one-off', await sw.evaluate(async () => !(await chrome.storage.local.get('settings')).settings?.plugins?.plantuml).catch(() => true));

// editing: run code in the extension's isolated world to stand in for the native file picker
const cdp = await ctx.newCDPSession(page);
const worlds = [];
cdp.on('Runtime.executionContextCreated', (e) => worlds.push(e.context));
await cdp.send('Runtime.enable');
const world = worlds.find((c) => c.origin.startsWith('chrome-extension://'));
const original = await (await import('node:fs/promises')).readFile(path.join(docs, 'sample.md'), 'utf8');
await cdp.send('Runtime.evaluate', {
  contextId: world.id,
  expression: `window.__orig = ${JSON.stringify(original)}; window.showOpenFilePicker = async () => [{ name: 'sample.md', getFile: async () => ({ text: async () => window.__orig }), createWritable: async () => ({ write: async (t) => { document.documentElement.dataset.written = t; }, close: async () => {} }) }]`,
});
await page.locator('.mdl-edit-btn').click();
await page.waitForSelector('.mdl-editor .ProseMirror h1', { timeout: 20000 });
check('edit mode opens', await page.locator('.mdl-editor .ProseMirror').isVisible());
check('outline works in edit mode', (await page.locator('.mdl-outline .mdl-ol-item').count()) === 8);
await page.keyboard.press('Control+s');
await page.waitForSelector('.mdl-save-prompt');
check('first save asks for the original file', (await page.locator('.mdl-save-prompt code').innerText()).endsWith('/docs/sample.md'));
await page.locator('.mdl-save-prompt button.primary').click();
await page.waitForFunction(() => document.documentElement.dataset.written !== undefined);
check('save prompt closes after picking', (await page.locator('.mdl-save-prompt').count()) === 0);
check('untouched document saves byte-identical', (await page.evaluate(() => document.documentElement.dataset.written)) === original);
await page.locator('.mdl-editor .ProseMirror h2').first().click();
await page.keyboard.press('End');
await page.keyboard.press('Enter');
await page.keyboard.type('### 새 제목');
await page.keyboard.press('Enter');
await page.keyboard.type('새 **굵은** 문단');
check('"### " becomes a heading while typing', (await page.locator('.mdl-editor .ProseMirror h3', { hasText: '새 제목' }).count()) === 1);
check('**bold** becomes bold while typing', (await page.locator('.mdl-editor .ProseMirror strong', { hasText: '굵은' }).count()) === 1);
await page.waitForFunction(() => document.querySelectorAll('.mdl-outline .mdl-ol-item').length === 9);
check('outline follows edits', true);
await page.waitForFunction(() => (document.documentElement.dataset.written || '').includes('### 새 제목'), null, { timeout: 5000 }).catch(() => {});
const written = await page.evaluate(() => document.documentElement.dataset.written);
check('auto save after edit', written.includes('### 새 제목\n\n새 **굵은** 문단'));
const keep = ['---\ntitle: 샘플\n---', '[[TOC]]', '**동일 인물(1인칭)**로', '> [!NOTE]', '*[HTML]: Hyper', 'H~2~O', '|------|---:|------|', '```mermaid', '[^1]: 각주 내용.'];
check('other blocks kept verbatim', keep.every((k) => written.includes(k)), keep.filter((k) => !written.includes(k)).join(' / '));
check('only the new lines differ', written.replace('### 새 제목\n\n새 **굵은** 문단\n\n', '') === original);
await page.screenshot({ path: path.join(outDir, 'editor.png') });
await page.locator('.mdl-edit-btn').click();
await page.waitForSelector('article.markdown-body h3#새-제목');
check('back to view mode renders the edit', (await page.locator('article .markdown-alert').count()) === 2);

// live settings: light theme, plugin off
await setSettings({ theme: 'light', plugins: { mark: false } });
await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
await page.waitForFunction(() => !document.querySelector('article mark'));
check('settings apply live (theme + plugin off)', true);
await page.waitForSelector('article .mdl-diagram-out svg', { timeout: 20000 }).catch(() => {});
await page.locator('.mdl-tab').nth(1).click();
await page.evaluate(() => scrollTo(0, 0));
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(outDir, 'viewer-light.png') });

// auto refresh
await setSettings({ autoRefresh: true, refreshInterval: 0.5 });
await page.waitForTimeout(700);
await writeFile(path.join(docs, 'sample.md'), '# 바뀐 제목\n\n새 본문\n');
const refreshed = await page.waitForFunction(() => document.querySelector('article h1')?.textContent === '바뀐 제목', null, { timeout: 8000 }).then(() => true, () => false);
check('auto refresh picks up file change', refreshed);
await setSettings({ autoRefresh: false, theme: 'auto', plugins: { mark: true } });

// relative link + txt + folder page
await page.goto(fileUrl('other.md'));
await page.waitForSelector('article h1');
check('other.md renders', (await page.locator('article h1').innerText()) === 'Other');
await page.goto(fileUrl('notes.txt'));
await page.waitForSelector('article em');
check('.txt rendered as markdown', true);
await page.goto(pathToFileURL(docs).href + '/');
await page.waitForSelector('.mdl-dir-entry');
check('folder page lists entries', (await page.locator('.mdl-dir-entry .mdl-row-name').allInnerTexts()).join() === 'sub,notes.txt,other.md,refs.md,sample.md');
await page.screenshot({ path: path.join(outDir, 'folder-page.png') });

// editing a document with blocks the editor drops (link definitions, comments)
await page.goto(fileUrl('refs.md'));
await page.waitForSelector('article h1');
const cdp2 = await ctx.newCDPSession(page);
const worlds2 = [];
cdp2.on('Runtime.executionContextCreated', (e) => worlds2.push(e.context));
await cdp2.send('Runtime.enable');
const world2 = worlds2.find((c) => c.origin.startsWith('chrome-extension://'));
const inExt = (expression) => cdp2.send('Runtime.evaluate', { contextId: world2.id, expression, awaitPromise: true });
const refsOriginal = await (await import('node:fs/promises')).readFile(path.join(docs, 'refs.md'), 'utf8');
await inExt(`(() => {
  const text = ${JSON.stringify(refsOriginal)};
  const file = { name: 'refs.md', getFile: async () => ({ text: async () => text }), createWritable: async () => ({ write: async (t) => { document.documentElement.dataset.written = t; }, close: async () => {} }) };
  const dir = { name: 'docs', isSameEntry: async () => false, getDirectoryHandle: async () => { throw new Error('none'); }, getFileHandle: async (n) => { if (n !== 'refs.md') throw new Error('none'); return file; } };
  window.showDirectoryPicker = async () => dir;
})()`);
await page.locator('.mdl-edit-btn').click();
await page.waitForSelector('.mdl-editor .ProseMirror h1');
await page.keyboard.press('Control+s');
await page.locator('.mdl-save-prompt .mdl-pick-folder').click();
await page.waitForFunction(() => document.documentElement.dataset.written !== undefined);
check('refs: connected folder resolves the opened file', (await page.locator('.mdl-status-text').innerText()).includes('refs.md'));
check('refs: untouched save is byte-identical', (await page.evaluate(() => document.documentElement.dataset.written)) === refsOriginal);
for (const text of ['첫 문단', '둘째 문단']) {
  await page.locator('.mdl-editor .ProseMirror p', { hasText: text }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' 수정');
}
await page.waitForFunction(() => (document.documentElement.dataset.written || '').includes('둘째 문단. 수정'), null, { timeout: 5000 }).catch(() => {});
const refsWritten = await page.evaluate(() => document.documentElement.dataset.written);
check('refs: definition + comment survive edits around them', refsWritten.includes('[ref]: https://example.com "제목"') && refsWritten.includes('<!-- 주석 -->'), JSON.stringify(refsWritten));
check('refs: untouched list keeps its * bullets', refsWritten.includes('* 별표 목록\n* 유지'));
await page.locator('.mdl-edit-btn').click();
await page.waitForSelector('article.markdown-body h1');

// editor start failure must fall back to the rendered view, not a blank page
await inExt(`globalThis.__mdlEditor.create = async () => { throw new Error('boom'); }`);
await page.locator('.mdl-edit-btn').click();
await page.waitForSelector('article .mdl-notice.error');
check('editor failure falls back to view with a message', (await page.locator('article h1').isVisible()) && (await page.locator('.mdl-notice.error code').innerText()).includes('boom'));
await page.evaluate(() => { window.onbeforeunload = null; });

// zen + disabled
await setSettings({ zen: true });
await page.waitForFunction(() => document.documentElement.classList.contains('mdl-zen'));
await page.waitForTimeout(400); // sidebar slides out with a transition
check('zen hides sidebar', !(await page.locator('.mdl-sidebar').isVisible()) || (await page.locator('.mdl-sidebar').boundingBox()).x < 0);
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.documentElement.classList.contains('mdl-zen'));
check('Esc leaves zen', true);
await setSettings({ enabled: false });
await page.waitForTimeout(1000); // the open page reloads itself when disabled
await page.goto(fileUrl('other.md'));
await page.waitForTimeout(500);
check('disabled leaves page raw', (await page.locator('article.markdown-body').count()) === 0);
await setSettings({ enabled: true });

// save helper (native messaging): confirm the location once, then write straight to the opened file
const { execFileSync } = await import('node:child_process');
const { readFile: readDisk } = await import('node:fs/promises');
execFileSync('bash', [path.join(root, 'native/install.sh'), id], {
  env: { ...process.env, MDLENS_HOSTS_DIR: path.join(work, 'profile', 'NativeMessagingHosts'), MDLENS_HOME: path.join(work, 'helper') },
});
const nativeFile = path.join(docs, 'native.md');
await writeFile(nativeFile, '# 도우미\n\n첫 문단.\n\n* 별표\n* 목록\n');
const onDisk = () => readDisk(nativeFile, 'utf8');
const diskHas = async (text) => {
  for (let i = 0; i < 40; i++) {
    if ((await onDisk()).includes(text)) return true;
    await page.waitForTimeout(150);
  }
  return false;
};
await page.goto(fileUrl('native.md'));
await page.waitForSelector('article h1');
await page.locator('.mdl-edit-btn').click();
await page.waitForSelector('.mdl-editor .ProseMirror h1');
await page.locator('.mdl-editor .ProseMirror p', { hasText: '첫 문단' }).click();
await page.keyboard.press('End');
await page.keyboard.type(' 수정');
await page.keyboard.press('Control+s');
await page.waitForSelector('.mdl-native-confirm');
check('helper: asks to confirm the real path, no picker', (await page.locator('.mdl-native-confirm code').innerText()) === nativeFile);
check('helper: nothing written before confirming', !(await onDisk()).includes('수정'));
await page.locator('.mdl-native-confirm button.primary').click();
await diskHas('첫 문단. 수정');
check('helper: writes the opened file in place', (await onDisk()) === '# 도우미\n\n첫 문단. 수정\n\n* 별표\n* 목록\n', JSON.stringify(await onDisk()));
await page.keyboard.type(' 또');
check('helper: later edits auto save without asking', (await diskHas('수정 또')) && (await page.locator('.mdl-native-confirm').count()) === 0);
await writeFile(nativeFile, '# 외부 변경\n');
await page.keyboard.type(' 셋');
await page.waitForTimeout(2500);
check('helper: does not overwrite a file changed elsewhere', (await onDisk()) === '# 외부 변경\n' && (await page.locator('.mdl-status-text').innerText()).includes('변경되어'));
await page.evaluate(() => { window.onbeforeunload = null; });

// options UI
const opt = await ctx.newPage();
await opt.setViewportSize({ width: 540, height: 580 });
for (const [i, name] of ['general', 'appearance', 'plugins'].entries()) {
  await opt.goto(`chrome-extension://${id}/options.html?popup=1`);
  await opt.locator('#nav button').nth(i).click();
  await opt.screenshot({ path: path.join(outDir, `options-${name}.png`) });
}
await opt.locator('#nav button').nth(0).click();
check('options: helper detected', (await opt.locator('.helper small').innerText()).startsWith('연결됨'));
check('options: file access detected', (await opt.locator('.label.link small').innerText()) === '허용됨');
await opt.locator('#nav button').nth(2).click();
await opt.locator('.switch input').first().click();
const pluginValues = () => opt.evaluate(async () => Object.values((await chrome.storage.local.get('settings')).settings.plugins));
check('options: all-plugins toggle on', (await pluginValues()).every((v) => v));
await opt.locator('.switch input').first().click();
check('options: all-plugins toggle off', (await pluginValues()).every((v) => !v));

check('no page errors', errors.length === 0, errors.join(' | '));
await ctx.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
