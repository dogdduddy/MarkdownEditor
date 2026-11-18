import { Crepe } from '@milkdown/crepe';
import { parserCtx, remarkCtx, remarkStringifyOptionsCtx, serializerCtx } from '@milkdown/kit/core';
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
    const { ctx } = crepe.editor;
    const remark = ctx.get(remarkCtx);
    const toDoc = ctx.get(parserCtx);
    const toMarkdown = ctx.get(serializerCtx);
    const spans = (md) =>
      remark
        .parse(md)
        .children.filter((n) => n.position)
        .map((n) => [n.position.start.offset, n.position.end.offset]);

    // Some blocks never reach the editor (link reference definitions, HTML
    // comments...). They are carried along with the gap before the next block.
    const vanishes = (text) => {
      try {
        return toMarkdown(toDoc(text)).trim() === '';
      } catch {
        return false;
      }
    };
    const all = spans(markdown);
    const hidden = []; // hidden[k]: source of vanished blocks sitting before visible block k
    const orig = [];
    let pending = [];
    for (const span of all) {
      if (vanishes(markdown.slice(span[0], span[1]))) {
        pending.push(markdown.slice(span[0], span[1]));
      } else {
        hidden.push(pending);
        pending = [];
        orig.push(span);
      }
    }
    hidden.push(pending);

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
      const emitted = new Set(); // gaps written verbatim (their hidden blocks included)
      const last = orig.length - 1;
      let out = '';
      let prev = -2;
      blocks.forEach(([s, e], n) => {
        const text = cur.slice(s, e);
        const queue = queues.get(text);
        const i = queue && queue.length ? queue.shift() : -2;
        const verbatim = i >= 0 && (n === 0 ? i === 0 : i === prev + 1);
        if (verbatim) {
          out += markdown.slice(i === 0 ? 0 : orig[i - 1][1], orig[i][0]);
          emitted.add(i);
        } else {
          if (n > 0) out += '\n\n';
          if (i >= 0 && hidden[i].length) {
            out += `${hidden[i].join('\n\n')}\n\n`;
            emitted.add(i);
          }
        }
        out += i >= 0 ? markdown.slice(orig[i][0], orig[i][1]) : text;
        prev = i;
      });
      if (blocks.length && prev === last) {
        out += markdown.slice(orig[last][1]);
        emitted.add(last + 1);
      } else if (blocks.length) {
        out += '\n';
      }
      // Hidden blocks whose neighbours were edited or removed still get written.
      const lost = hidden.flatMap((list, k) => (emitted.has(k) ? [] : list));
      if (lost.length) out += `${out && !out.endsWith('\n\n') ? (out.endsWith('\n') ? '\n' : '\n\n') : ''}${lost.join('\n\n')}\n`;
      return out;
    }

    return { getMarkdown, lossless: !!pristine, destroy: () => crepe.destroy() };
  },
};
