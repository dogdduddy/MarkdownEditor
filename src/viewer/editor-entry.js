import { Crepe } from '@milkdown/crepe';
import { remarkCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { remarkGFMPlugin } from '@milkdown/kit/preset/gfm';
import { $remark } from '@milkdown/kit/utils';
import remarkCjkFriendly from 'remark-cjk-friendly';

const cjkFriendly = $remark('remarkCjkFriendly', () => remarkCjkFriendly);

// Loaded on demand (it is large). The viewer talks to it through this global.
globalThis.__mdlEditor = {
  async create({ root, markdown, onChange, renderPreview, placeholder }) {
    const crepe = new Crepe({
      root,
      defaultValue: markdown,
      features: {
        [Crepe.Feature.AI]: false,
        [Crepe.Feature.TopBar]: false,
        // The image block rewrites alt text with its size ratio; keep plain images.
        [Crepe.Feature.ImageBlock]: false,
      },
      featureConfigs: {
        [Crepe.Feature.CodeMirror]: { renderPreview },
        [Crepe.Feature.Placeholder]: { text: placeholder, mode: 'block' },
      },
    });
    crepe.editor
      .config((ctx) => {
        // Keep the written Markdown close to what people type by hand.
        ctx.update(remarkStringifyOptionsCtx, (o) => ({
          ...o,
          bullet: '-',
          rule: '-',
          emphasis: '*',
          strong: '*',
          fences: true,
          listItemIndent: 'one',
        }));
        // H~2~O is subscript in the viewer, not strikethrough.
        ctx.set(remarkGFMPlugin.options.key, { singleTilde: false });
      })
      .use(cjkFriendly);
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, md, prev) => {
        if (md !== prev) onChange();
      });
    });
    await crepe.create();

    // --- lossless save ---------------------------------------------------
    // Serialising the whole document would reformat it and escape syntax the
    // editor does not know ([[TOC]], > [!NOTE], *[abbr]: ...). Instead the file
    // is cut into top-level blocks; blocks the user did not touch are written
    // back byte-for-byte from the original, only edited ones are serialised.
    const remark = crepe.editor.ctx.get(remarkCtx);
    const spans = (md) =>
      remark
        .parse(md)
        .children.filter((n) => n.position)
        .map((n) => [n.position.start.offset, n.position.end.offset]);

    const orig = spans(markdown);
    const initial = crepe.getMarkdown();
    const initialSpans = spans(initial);
    let pristine = null;
    if (orig.length === initialSpans.length) {
      pristine = new Map();
      initialSpans.forEach(([s, e], i) => {
        const key = initial.slice(s, e);
        if (!pristine.has(key)) pristine.set(key, []);
        pristine.get(key).push(i);
      });
    }

    function getMarkdown() {
      const cur = crepe.getMarkdown();
      if (!pristine) return cur;
      const queues = new Map([...pristine].map(([k, v]) => [k, [...v]]));
      const blocks = spans(cur);
      if (!blocks.length) return '';
      let out = '';
      let prev = -2;
      blocks.forEach(([s, e], n) => {
        const text = cur.slice(s, e);
        const queue = queues.get(text);
        const i = queue && queue.length ? queue.shift() : -2;
        if (n === 0) out += i === 0 ? markdown.slice(0, orig[0][0]) : '';
        else out += i >= 0 && i === prev + 1 ? markdown.slice(orig[prev][1], orig[i][0]) : '\n\n';
        out += i >= 0 ? markdown.slice(orig[i][0], orig[i][1]) : text;
        prev = i;
      });
      out += prev === orig.length - 1 ? markdown.slice(orig[prev][1]) : '\n';
      return out;
    }

    return { getMarkdown, destroy: () => crepe.destroy() };
  },
};
