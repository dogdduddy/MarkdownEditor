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
check('folder tree lists dirs + markdown only', JSON.stringify(names) === JSON.stringify(['sub', 'notes.txt', 'other.md', 'sample.md']), names.join(','));
check('current file highlighted', (await page.locator('.mdl-folder .mdl-row.active').innerText()).trim() === 'sample.md');
await page.locator('.mdl-folder .mdl-row.dir').click();
await page.waitForSelector('.mdl-folder .mdl-children .mdl-row');
check('subfolder expands', (await page.locator('.mdl-folder .mdl-children .mdl-row-name').allInnerTexts()).join() === 'nested.md');
await page.screenshot({ path: path.join(outDir, 'viewer-folder.png') });

// raw view
await page.locator('.mdl-menu-btn').click();
await page.locator('.mdl-menu-item').first().click();
check('raw view', (await page.locator('.mdl-raw').isVisible()) && (await page.locator('.mdl-raw').innerText()).includes('[[TOC]]'));
await page.locator('.mdl-menu-btn').click();
await page.locator('.mdl-menu-item').first().click();

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
check('folder page lists entries', (await page.locator('.mdl-dir-entry .mdl-row-name').allInnerTexts()).join() === 'sub,notes.txt,other.md,sample.md');
await page.screenshot({ path: path.join(outDir, 'folder-page.png') });

// zen + disabled
await setSettings({ zen: true });
await page.waitForFunction(() => document.documentElement.classList.contains('mdl-zen'));
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

// options UI
const opt = await ctx.newPage();
await opt.setViewportSize({ width: 540, height: 580 });
for (const [i, name] of ['general', 'appearance', 'plugins'].entries()) {
  await opt.goto(`chrome-extension://${id}/options.html?popup=1`);
  await opt.locator('#nav button').nth(i).click();
  await opt.screenshot({ path: path.join(outDir, `options-${name}.png`) });
}
await opt.locator('#nav button').nth(0).click();
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
