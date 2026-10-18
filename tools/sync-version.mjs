// =============================================================
// tools/sync-version.mjs — Versão única do app
// -------------------------------------------------------------
// A versão do app vem SÓ do package.json. Este script gera
// js/version.js (APP_VERSION: Ajustes, rodapé do menu, Novidades).
// Roda no `npm run build` e no CI; o teste tests/version.test.mjs
// falha se alguém esquecer de rodar.
// (Não há mais lista de cache: o app não guarda arquivos no
// navegador — ver sw.js.)
//
// Uso: node tools/sync-version.mjs
// =============================================================

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function appVersion() {
  return JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
}

export function versionModule(version) {
  return `// Gerado por tools/sync-version.mjs a partir do package.json — não edite à mão.\nexport const APP_VERSION = '${version}';\n`;
}

export async function sync() {
  const version = await appVersion();
  await writeFile(join(root, 'js/version.js'), versionModule(version));
  return { version };
}

if (process.argv[1] && relative(process.argv[1], fileURLToPath(import.meta.url)) === '') {
  const { version } = await sync();
  console.log(`Dhenors ${version}: js/version.js atualizado.`);
}
