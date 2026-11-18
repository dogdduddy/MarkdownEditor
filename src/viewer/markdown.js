import MarkdownIt from 'markdown-it';
import cjkFriendly from 'markdown-it-cjk-friendly';
import { full as emoji } from 'markdown-it-emoji';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import ins from 'markdown-it-ins';
import mark from 'markdown-it-mark';
import abbr from 'markdown-it-abbr';
import deflist from 'markdown-it-deflist';
import footnote from 'markdown-it-footnote';
import frontMatter from 'markdown-it-front-matter';
import multimdTable from 'markdown-it-multimd-table';
import taskLists from 'markdown-it-task-lists';
import githubAlerts from 'markdown-it-github-alerts';
import katexPlugin from '@vscode/markdown-it-katex';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';

const interop = (m) => (m && m.default) || m;

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function createRenderer(settings) {
  const p = settings.plugins;
  const md = new MarkdownIt({
    html: true,
    breaks: !!settings.breaks,
    linkify: !!p.linkify,
    typographer: !!p.typographer,
    highlight(code, lang) {
      const name = (lang || '').trim().split(/\s+/)[0];
      if (name && hljs.getLanguage(name)) {
        try {
          return hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
        } catch {}
      }
      return '';
    },
  });

  // Makes **bold(괄호)**뒤 style emphasis work next to CJK text and punctuation,
  // which plain CommonMark flanking rules reject.
  md.use(interop(cjkFriendly));

  if (p.emoji) md.use(emoji);
  if (p.sub) md.use(interop(sub));
  if (p.sup) md.use(interop(sup));
  if (p.ins) md.use(interop(ins));
  if (p.mark) md.use(interop(mark));
  if (p.abbr) md.use(interop(abbr));
  if (p.deflist) md.use(interop(deflist));
  if (p.footnote) md.use(interop(footnote));
  if (p.frontMatter) md.use(interop(frontMatter), () => {});
  if (p.mmdTable) {
    md.use(interop(multimdTable), { multiline: true, rowspan: true, headerless: true });
  }
  if (p.taskList) md.use(interop(taskLists), { enabled: false, label: true });
  if (p.alerts) md.use(interop(githubAlerts));
  if (p.math) md.use(interop(katexPlugin), { throwOnError: false, output: 'html' });

  // Diagram fences become placeholders that the viewer renders after insert.
  const fence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const lang = (token.info || '').trim().split(/\s+/)[0].toLowerCase();
    if (p.mermaid && lang === 'mermaid') {
      return `<pre class="mdl-diagram" data-kind="mermaid">${escapeHtml(token.content)}</pre>\n`;
    }
    if (p.plantuml && (lang === 'plantuml' || lang === 'puml')) {
      return `<pre class="mdl-diagram" data-kind="plantuml">${escapeHtml(token.content)}</pre>\n`;
    }
    return fence(tokens, idx, options, env, self);
  };

  return (text) =>
    DOMPurify.sanitize(md.render(text), {
      ADD_ATTR: ['target'],
      FORBID_TAGS: ['style', 'form'],
    });
}

export function slugify(text) {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s+/g, '-') || 'section'
  );
}

// PlantUML text encoding: raw deflate + its own base64 alphabet.
export async function plantumlUrl(source) {
  const stream = new Blob([source]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  const abc = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    const b2 = bytes[i + 1] || 0;
    const b3 = bytes[i + 2] || 0;
    out += abc[b1 >> 2] + abc[((b1 & 3) << 4) | (b2 >> 4)] + abc[((b2 & 15) << 2) | (b3 >> 6)] + abc[b3 & 63];
  }
  return `https://www.plantuml.com/plantuml/svg/${out}`;
}
