import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { writeFile } from 'node:fs/promises';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="#5468d4"/><path d="M28 90V40h12l14 20 14-20h12v50H68V60L54 79 40 60v30z" fill="#fff"/><path d="M96 40v30h-9l15 20 15-20h-9V40z" fill="#fff" transform="translate(-9 0) scale(.98)"/></svg>`;
await writeFile('src/icons/icon.svg', svg);
const b = await chromium.launch();
const p = await b.newPage();
for (const s of [16, 32, 48, 128]) {
  await p.setViewportSize({ width: s, height: s });
  await p.setContent(`<style>body{margin:0}svg{display:block;width:${s}px;height:${s}px}</style>${svg}`);
  await p.screenshot({ path: `src/icons/${s}.png`, omitBackground: true });
}
await b.close();
