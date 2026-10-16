// =============================================================
// tools/build.mjs — Gera dist/dhenors.html (arquivo ÚNICO)
// -------------------------------------------------------------
// O app normal (index.html) usa módulos ES, que precisam de um
// servidor (http://). Este script junta tudo — JS, CSS, fonte e
// ícones — em um só arquivo HTML que abre com dois cliques, sem
// servidor. A versão vem de js/version.js (npm run sync).
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
const dataURI = async (p, type = 'image/png') => `data:${type};base64,${(await readFile(join(root, p))).toString('base64')}`;

const CSS = ['tokens', 'base', 'layout', 'components', 'views', 'brand', 'features', 'design'];
const FONTS = ['InterVariable.woff2', 'InterVariable-ext.woff2'];

const js = await build({
  entryPoints: [join(root, 'js/main.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  write: false,
  legalComments: 'none',
});

let css = (await Promise.all(CSS.map((n) => read(`css/${n}.css`)))).join('\n');
// Fonte Inter embutida: o arquivo único não tem a pasta assets/
for (const font of FONTS) {
  const uri = await dataURI(`assets/fonts/${font}`, 'font/woff2');
  css = css.replaceAll(`url('../assets/fonts/${font}')`, `url('${uri}')`);
}
const cssMin = (await build({ stdin: { contents: css, loader: 'css' }, minify: true, write: false })).outputFiles[0].text;

const boot = await read('js/boot.js');
let html = await read('index.html');
const favicon = await dataURI('assets/icons/favicon-32.png');
const logo = await dataURI('assets/icons/logo-64.png');

html = html
  .replace(/\s*<link rel="stylesheet"[^>]*>/g, '')
  .replace(/\s*<link rel="manifest"[^>]*>/, '')
  .replace(/\s*<link rel="apple-touch-icon"[^>]*>/, '')
  .replace(/\s*<link rel="preload"[^>]*>/g, '')
  .replace(/\s*<script type="module"[^>]*><\/script>/, '')
  // Sem servidor, os scripts vão embutidos: a CSP do arquivo único libera
  // scripts e fontes inline (o resto da política continua igual).
  .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
  .replace("font-src 'self'", "font-src 'self' data:")
  .replace('<script src="js/boot.js"></script>', () => `<script>${boot}</script>`)
  .replace('href="assets/icons/favicon-32.png"', () => `href="${favicon}"`)
  .replace('src="assets/icons/logo-64.png"', () => `src="${logo}"`)
  .replace('</head>', () => `  <style>${cssMin}</style>\n</head>`)
  .replace('</body>', () => `  <script>${js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>\n</body>`);

await mkdir(join(root, 'dist'), { recursive: true });
await writeFile(join(root, 'dist/dhenors.html'), html);
console.log(`dist/dhenors.html gerado (${(html.length / 1024).toFixed(0)} KB)`);
