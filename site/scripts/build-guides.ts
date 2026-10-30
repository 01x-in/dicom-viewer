// Turns docs/guides/*.md into site/guides/*.html, one page per guide, so the landing page can link to
// pages on the site instead of GitHub's file view. Vite then builds those pages like any other page.
// The output is generated: it is git-ignored, and `pnpm build` and `pnpm dev` make it first.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import MarkdownIt from 'markdown-it';
import { createHighlighter } from 'shiki';

const REPO_URL = 'https://github.com/01x-in/dicom-viewer';
const REPO_ROOT = resolve(import.meta.dirname, '../..');
const GUIDES_DIR = join(REPO_ROOT, 'docs/guides');
const OUT_DIR = resolve(import.meta.dirname, '../guides');

// The order of the side list. A guide that is not here goes at the end, under its own title.
const ORDER: readonly { readonly name: string; readonly label: string }[] = [
  { name: 'index', label: 'Overview' },
  { name: 'nextjs-tutorial', label: 'Tutorial: Next.js' },
  { name: 'installing', label: 'Installing in a framework' },
  { name: 'data-sources', label: 'Data sources' },
  { name: 'observability', label: 'Observability' },
  { name: 'measurements-and-segmentations', label: 'Measurements and segmentations' },
  { name: 'visual-regression', label: 'Visual regression' },
  { name: 'releasing', label: 'Releasing' },
];

const LANGS = ['bash', 'ts', 'tsx', 'js', 'jsx', 'json', 'html', 'vue', 'css', 'yaml'];

type Token = ReturnType<MarkdownIt['parse']>[number];

interface Guide {
  readonly name: string;
  readonly file: string;
  readonly tokens: Token[];
  readonly title: string;
  readonly description: string;
  readonly ids: Set<string>;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function inlineText(token: Token | undefined): string {
  if (token?.children == null) return token?.content ?? '';
  return token.children
    .filter((child) => child.type === 'text' || child.type === 'code_inline')
    .map((child) => child.content)
    .join('');
}

// The ids GitHub gives headings, so a link such as `README.md#using-it` and our own anchors agree.
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

const highlighter = await createHighlighter({ themes: ['vitesse-dark'], langs: LANGS });
const loaded = new Set(highlighter.getLoadedLanguages());

const md = new MarkdownIt({
  html: false,
  linkify: false,
  highlight: (code, lang): string => {
    if (!loaded.has(lang)) return '';
    return highlighter.codeToHtml(code, { lang, theme: 'vitesse-dark' });
  },
});

md.renderer.rules['heading_open'] = (tokens, index): string => {
  const token = tokens[index];
  if (token === undefined) return '';
  return `<${token.tag} id="${escapeHtml(token.attrGet('id') ?? '')}">`;
};
md.renderer.rules['heading_close'] = (tokens, index): string => {
  const token = tokens[index];
  if (token === undefined) return '';
  const id = escapeHtml(String(token.meta ?? ''));
  return `<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></${token.tag}>\n`;
};
md.renderer.rules['table_open'] = (): string => '<div class="table-wrap"><table>\n';
md.renderer.rules['table_close'] = (): string => '</table></div>\n';

function walk(tokens: Token[], visit: (token: Token) => void): void {
  for (const token of tokens) {
    visit(token);
    if (token.children !== null) walk(token.children, visit);
  }
}

function readGuide(name: string): Guide {
  const file = join(GUIDES_DIR, `${name}.md`);
  const tokens = md.parse(readFileSync(file, 'utf8'), {});
  const ids = new Set<string>();
  const seen = new Map<string, number>();
  let title = '';
  let description = '';

  for (const [index, token] of tokens.entries()) {
    if (token.type === 'heading_open') {
      const base = slugify(inlineText(tokens[index + 1]));
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      const id = count === 0 ? base : `${base}-${String(count)}`;
      ids.add(id);
      token.attrSet('id', id);
      for (let close = index + 1; close < tokens.length; close++) {
        const candidate = tokens[close];
        if (candidate?.type === 'heading_close') {
          candidate.meta = id;
          break;
        }
      }
      if (token.tag === 'h1' && title === '') title = inlineText(tokens[index + 1]);
    }
    if (token.type === 'paragraph_open' && description === '') {
      description = inlineText(tokens[index + 1])
        .replace(/\s+/g, ' ')
        .slice(0, 200);
    }
  }
  if (title === '') throw new Error(`${file} has no top-level heading`);
  return { name, file, tokens, title, description, ids };
}

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path !== '' && !path.startsWith('..') && !path.startsWith(sep);
}

interface Rewritten {
  readonly href: string;
  readonly external: boolean;
}

function rewriteLink(href: string, from: Guide, guides: ReadonlyMap<string, Guide>): Rewritten {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { href, external: href.startsWith('http') };

  if (href.startsWith('#')) {
    if (!from.ids.has(href.slice(1))) throw new Error(`${from.file}: no heading for ${href}`);
    return { href, external: false };
  }

  const [path = '', hash = ''] = href.split('#', 2);
  const target = resolve(dirname(from.file), path);
  const suffix = hash === '' ? '' : `#${hash}`;

  const guide = isInside(GUIDES_DIR, target) ? guides.get(basename(target, '.md')) : undefined;
  if (guide !== undefined && target.endsWith('.md') && dirname(target) === GUIDES_DIR) {
    if (hash !== '' && !guide.ids.has(hash)) {
      throw new Error(`${from.file}: ${guide.name}.md has no heading for #${hash}`);
    }
    return { href: `${guide.name}.html${suffix}`, external: false };
  }

  if (!isInside(REPO_ROOT, target) || !existsSync(target)) {
    throw new Error(`${from.file}: the link ${href} does not point to a file in the repository`);
  }
  // Anything else in the repository is shown by GitHub.
  const repoPath = toPosix(relative(REPO_ROOT, target));
  const kind = statSync(target).isDirectory() ? 'tree' : 'blob';
  return { href: `${REPO_URL}/${kind}/main/${repoPath}${suffix}`, external: true };
}

function copyImage(src: string, from: Guide): void {
  const source = resolve(dirname(from.file), src);
  if (!isInside(GUIDES_DIR, source) || !existsSync(source)) {
    throw new Error(`${from.file}: the image ${src} is not a file under docs/guides`);
  }
  const destination = join(OUT_DIR, relative(GUIDES_DIR, source));
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination);
}

function render(guide: Guide, guides: ReadonlyMap<string, Guide>): string {
  walk(guide.tokens, (token) => {
    if (token.type === 'link_open') {
      const rewritten = rewriteLink(token.attrGet('href') ?? '', guide, guides);
      token.attrSet('href', rewritten.href);
      if (rewritten.external) {
        token.attrSet('target', '_blank');
        token.attrSet('rel', 'noopener noreferrer');
      }
    }
    if (token.type === 'image') {
      const src = token.attrGet('src') ?? '';
      if (!/^https?:/.test(src)) copyImage(src, guide);
      token.attrSet('loading', 'lazy');
    }
  });
  return md.renderer.render(guide.tokens, md.options, {});
}

function page(
  guide: Guide,
  body: string,
  order: readonly Guide[],
  label: (g: Guide) => string,
): string {
  const list = order
    .map((entry) => {
      const current = entry.name === guide.name;
      return `<li><a href="${entry.name}.html"${current ? ' aria-current="page"' : ''}>${escapeHtml(label(entry))}</a></li>`;
    })
    .join('\n          ');
  const source = `${REPO_URL}/blob/main/docs/guides/${guide.name}.md`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(guide.title)} | dicom-viewer</title>
    <meta name="description" content="${escapeHtml(guide.description)}" />
    <meta name="color-scheme" content="dark" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <script type="module" src="/src/guide.ts"></script>
  </head>
  <body class="doc">
    <a class="skip" href="#content">Skip to the guide</a>

    <header class="top">
      <a class="mark" href="../" aria-label="dicom-viewer, home">
        <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
          <circle cx="16" cy="16" r="9" fill="none" stroke="currentColor" stroke-width="2" />
          <path d="M16 3v6M16 23v6M3 16h6M23 16h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
        <span>dicom-viewer</span>
      </a>
      <nav aria-label="Main">
        <a href="./nextjs-tutorial.html"${guide.name === 'nextjs-tutorial' ? ' aria-current="page"' : ''}>Tutorial</a>
        <a href="./"${guide.name !== 'nextjs-tutorial' ? ' aria-current="page"' : ''}>Guides</a>
        <a href="../api/">API</a>
        <a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">GitHub</a>
        <a href="https://www.npmjs.com/package/@01x/dicom-viewer-core" target="_blank" rel="noopener noreferrer">npm</a>
      </nav>
    </header>

    <div class="doc-layout">
      <nav class="doc-list" aria-label="Guides">
        <ul>
          ${list}
        </ul>
      </nav>
      <main id="content">
        <article class="prose">
${body}
        </article>
        <p class="doc-source"><a href="${source}" target="_blank" rel="noopener noreferrer">Edit this page on GitHub</a></p>
      </main>
    </div>

    <footer class="foot">
      <p>
        MIT licensed. Built on
        <a href="https://www.cornerstonejs.org/" target="_blank" rel="noopener noreferrer">Cornerstone3D</a>.
      </p>
      <p>
        <a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">Source</a> &middot;
        <a href="${REPO_URL}/blob/main/SECURITY.md" target="_blank" rel="noopener noreferrer">Security</a> &middot;
        <a href="https://www.npmjs.com/org/01x" target="_blank" rel="noopener noreferrer">npm</a>
      </p>
    </footer>
  </body>
</html>
`;
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const names = readdirSync(GUIDES_DIR)
  .filter((file) => file.endsWith('.md'))
  .map((file) => basename(file, '.md'));
const rank = (name: string): number => {
  const index = ORDER.findIndex((entry) => entry.name === name);
  return index === -1 ? ORDER.length : index;
};
names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

const guides = new Map(names.map((name) => [name, readGuide(name)]));
const ordered = [...guides.values()];
const label = (guide: Guide): string =>
  ORDER.find((entry) => entry.name === guide.name)?.label ?? guide.title;

for (const guide of ordered) {
  const html = page(guide, render(guide, guides), ordered, label);
  writeFileSync(join(OUT_DIR, `${guide.name}.html`), html);
}
console.log(
  `Wrote ${String(ordered.length)} guide pages to ${toPosix(relative(process.cwd(), OUT_DIR))}`,
);
