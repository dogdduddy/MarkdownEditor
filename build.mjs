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
    editor: 'src/viewer/editor-entry.js',
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

// Editor stylesheet (Crepe theme), bundled to a single injectable file.
const cssOptions = {
  entryPoints: { editor: 'src/viewer/editor.css' },
  outdir: out,
  bundle: true,
  minify: !watch,
  loader: { '.css': 'css', '.woff2': 'dataurl', '.woff': 'empty', '.ttf': 'empty' },
  logLevel: 'info',
};

await statics();
await build(cssOptions);
// The editor is built separately: KaTeX (used for its math blocks) refuses to
// run in quirks mode, which is what Chrome uses for raw text documents.
// mdast-util-to-markdown-cjk-friendly reads parent.children without the
// `|| []` guard the stock serialiser has, so an empty table cell or heading
// (which the editor emits without a children array) crashed the editor.
const patchCjkPhrasing = {
  name: 'patch-cjk-phrasing',
  setup(b) {
    b.onLoad({ filter: /mdast-util-to-markdown-cjk-friendly[\\/]dist[\\/].*\.m?js$/ }, async (args) => {
      const src = await readFile(args.path, 'utf8');
      const needle = 'const children = parent.children;';
      if (!src.includes(needle)) return { contents: src, loader: 'js' };
      patchCjkPhrasing.applied = true;
      return { contents: src.replace(needle, 'const children = parent.children || [];'), loader: 'js' };
    });
  },
};

const { entryPoints } = options;
const editorOptions = {
  ...options,
  entryPoints: { editor: 'src/viewer/editor-entry.js' },
  define: { 'document.compatMode': '"CSS1Compat"' },
  plugins: [patchCjkPhrasing],
};
delete entryPoints.editor;

if (watch) {
  await (await context(editorOptions)).watch();
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
  await build(editorOptions);
  if (!patchCjkPhrasing.applied) throw new Error('cjk phrasing patch did not apply; check the dependency');
}
