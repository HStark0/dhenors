// =============================================================
// tools/build.mjs — Gera dist/dhenors.html (arquivo ÚNICO)
// -------------------------------------------------------------
// O app normal (index.html) usa módulos ES, que precisam de um
// servidor (http://). Este script junta tudo — JS, CSS e ícones —
// em um só arquivo HTML que abre com dois cliques, sem servidor.
//
// Uso:  npm install   (uma vez, instala o esbuild)
//       npm run build
// =============================================================

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFile(join(root, p), 'utf8');
const dataURI = async (p) => `data:image/png;base64,${(await readFile(join(root, p))).toString('base64')}`;

const CSS = ['tokens', 'base', 'layout', 'components', 'views', 'brand'];

const js = await build({
  entryPoints: [join(root, 'js/main.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  write: false,
  legalComments: 'none',
});

const css = (await Promise.all(CSS.map((n) => read(`css/${n}.css`)))).join('\n');
const cssMin = (await build({ stdin: { contents: css, loader: 'css' }, minify: true, write: false })).outputFiles[0].text;

let html = await read('index.html');
const favicon = await dataURI('assets/icons/favicon-32.png');
const logo = await dataURI('assets/icons/logo-64.png');

html = html
  .replace(/\s*<link rel="stylesheet"[^>]*>/g, '')
  .replace(/\s*<link rel="manifest"[^>]*>/, '')
  .replace(/\s*<link rel="apple-touch-icon"[^>]*>/, '')
  .replace(/\s*<script type="module"[^>]*><\/script>/, '')
  .replace('href="assets/icons/favicon-32.png"', () => `href="${favicon}"`)
  .replace('src="assets/icons/logo-64.png"', () => `src="${logo}"`)
  .replace('</head>', () => `  <style>${cssMin}</style>\n</head>`)
  .replace('</body>', () => `  <script>${js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>\n</body>`);

await mkdir(join(root, 'dist'), { recursive: true });
await writeFile(join(root, 'dist/dhenors.html'), html);
console.log(`dist/dhenors.html gerado (${(html.length / 1024).toFixed(0)} KB)`);
