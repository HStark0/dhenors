// =============================================================
// tools/sync-version.mjs — Versão única e lista de cache do PWA
// -------------------------------------------------------------
// A versão do app vem SÓ do package.json. Este script gera:
//   • js/version.js  → APP_VERSION (Ajustes, rodapé do menu, Novidades)
//   • sw-assets.js   → versão + lista de arquivos que o service
//                      worker guarda para abrir sem internet
// A lista é montada lendo as pastas (nada de lista manual que
// esquece arquivos). Roda no `npm run build` e no CI; o teste
// tests/version.test.mjs falha se alguém esquecer de rodar.
//
// Uso: node tools/sync-version.mjs
// =============================================================

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Pastas e arquivos que fazem parte do app publicado. */
const ROOT_FILES = ['index.html', 'manifest.webmanifest'];
const DIRS = ['css', 'js', 'assets'];
const SKIP = /(^|\/)\.|\.map$|\.md$|\.txt$/;

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (SKIP.test(path)) continue;
    if (entry.isDirectory()) out.push(...await walk(path));
    else out.push(path);
  }
  return out;
}

export async function appVersion() {
  return JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
}

/** Lista ordenada de arquivos para o cache do service worker. */
export async function computeAssets() {
  const files = [...ROOT_FILES];
  for (const d of DIRS) files.push(...await walk(d));
  return ['./', ...files.map((f) => `./${f.split(sep).join('/')}`).sort()];
}

export function versionModule(version) {
  return `// Gerado por tools/sync-version.mjs a partir do package.json — não edite à mão.\nexport const APP_VERSION = '${version}';\n`;
}

/**
 * Impressão digital do conteúdo: qualquer arquivo alterado muda o
 * sw-assets.js e o navegador percebe que há versão nova, mesmo que
 * o número da versão não tenha mudado.
 */
export async function contentHash(assets) {
  const h = createHash('sha256');
  for (const a of assets) {
    if (a === './') continue;
    h.update(a);
    h.update(await readFile(join(root, a.slice(2))));
  }
  return h.digest('hex').slice(0, 12);
}

export function assetsModule(version, assets, build = '') {
  return `// Gerado por tools/sync-version.mjs — não edite à mão.\n`
    + `// Versão e arquivos que o service worker (sw.js) guarda para uso offline.\n`
    + `self.DHENORS_VERSION = '${version}';\n`
    + `self.DHENORS_BUILD = '${build}';\n`
    + `self.DHENORS_ASSETS = ${JSON.stringify(assets, null, 2).replace(/"/g, "'")};\n`;
}

export async function sync() {
  const version = await appVersion();
  await writeFile(join(root, 'js/version.js'), versionModule(version));
  // a lista inclui js/version.js, então é calculada depois de gravá-lo
  const assets = await computeAssets();
  await writeFile(join(root, 'sw-assets.js'), assetsModule(version, assets, await contentHash(assets)));
  return { version, count: assets.length };
}

if (process.argv[1] && relative(process.argv[1], fileURLToPath(import.meta.url)) === '') {
  const { version, count } = await sync();
  console.log(`Dhenors ${version}: js/version.js e sw-assets.js atualizados (${count} arquivos no cache).`);
}
