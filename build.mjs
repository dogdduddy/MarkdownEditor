import { build, context } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const watch = process.argv.includes('--watch');
const out = 'dist';

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// KaTeX CSS with woff2 fonts inlined, so it can be injected into any page.
async function katexCss() {
  const dir = 'node_modules/katex/dist';
  let css = await readFile(path.join(dir, 'katex.min.css'), 'utf8');
  const fonts = new Map();
  for (const m of css.matchAll(/url\((fonts\/[^)]+\.woff2)\)/g)) fonts.set(m[1], null);
  for (const f of fonts.keys()) {
    fonts.set(f, (await readFile(path.join(dir, f))).toString('base64'));
  }
  css = css.replace(/src:([^;}]+)/g, (all, list) => {
    const woff2 = list.split(',').find((s) => s.includes('.woff2'));
    if (!woff2) return all;
    const file = woff2.match(/url\(([^)]+)\)/)[1];
    return `src:url(data:font/woff2;base64,${fonts.get(file)}) format("woff2")`;
  });
  await writeFile(path.join(out, 'katex.css'), css);
}

async function statics() {
  await cp('src/manifest.json', path.join(out, 'manifest.json'));
  await cp('src/options/options.html', path.join(out, 'options.html'));
  await cp('src/options/options.css', path.join(out, 'options.css'));
  await cp('src/icons', path.join(out, 'icons'), { recursive: true });
  await katexCss();
}

const options = {
  entryPoints: {
    background: 'src/background.js',
    loader: 'src/loader.js',
    viewer: 'src/viewer/index.js',
    mermaid: 'src/viewer/mermaid-entry.js',
    options: 'src/options/options.js',
  },
  outdir: out,
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  minify: !watch,
  legalComments: 'none',
  loader: { '.css': 'text' },
  logLevel: 'info',
};

await statics();
if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
