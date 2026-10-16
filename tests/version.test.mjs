// Versão única: package.json → js/version.js, sw-assets.js (nome do cache
// do service worker), CHANGELOG.md e js/changelog.js precisam bater.
// Se falhar: rode `npm run sync` e registre a versão nas Novidades.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import { APP_VERSION } from '../js/version.js';
import { CHANGELOG, newerThan } from '../js/changelog.js';
import { THEME_COLORS } from '../js/core/theme.js';
import { computeAssets } from '../tools/sync-version.mjs';

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');
const pkg = JSON.parse(await read('package.json'));
const lock = JSON.parse(await read('package-lock.json'));

/** Executa sw-assets.js como o service worker faria (importScripts). */
async function swAssets() {
  const self = {};
  vm.runInNewContext(await read('sw-assets.js'), { self });
  return self;
}

test('package.json e package-lock.json têm a mesma versão', () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
});

test('js/version.js e sw-assets.js seguem o package.json (npm run sync)', async () => {
  assert.equal(APP_VERSION, pkg.version);
  const sw = await swAssets();
  assert.equal(sw.DHENORS_VERSION, pkg.version);
  assert.match(sw.DHENORS_BUILD, /^[0-9a-f]{12}$/);
});

test('o nome do cache do service worker usa a versão', async () => {
  const src = await read('sw.js');
  assert.match(src, /importScripts\(['"]\.\/sw-assets\.js['"]\)/);
  assert.match(src, /const VERSION = `dhenors-v\$\{self\.DHENORS_VERSION\}-\$\{self\.DHENORS_BUILD\}`/);
});

test('a lista de arquivos do cache está atualizada', async () => {
  const sw = await swAssets();
  assert.deepEqual([...sw.DHENORS_ASSETS], await computeAssets(), 'rode npm run sync');
});

test('Novidades: CHANGELOG.md e js/changelog.js começam pela versão atual', async () => {
  const md = await read('CHANGELOG.md');
  const top = md.match(/^## \[(\d+\.\d+\.\d+)\]/m);
  assert.ok(top, 'CHANGELOG.md sem entrada "## [x.y.z]"');
  assert.equal(top[1], pkg.version);
  assert.equal(CHANGELOG[0].version, pkg.version);
  for (let i = 1; i < CHANGELOG.length; i++) assert.ok(newerThan(CHANGELOG[i - 1].version, CHANGELOG[i].version), 'js/changelog.js fora de ordem');
});

test('a versão nunca volta para trás (já houve 3.2.0 publicada)', () => {
  assert.ok(newerThan(pkg.version, '3.2.0'), `${pkg.version} precisa ser maior que 3.2.0`);
});

test('cores da barra iguais em theme.js, index.html, boot.js e manifest', async () => {
  const index = await read('index.html');
  const boot = await read('js/boot.js');
  const manifest = JSON.parse(await read('manifest.webmanifest'));
  assert.match(index, new RegExp(`theme-color" content="${THEME_COLORS.light}" media="\\(prefers-color-scheme: light\\)`));
  assert.match(index, new RegExp(`theme-color" content="${THEME_COLORS.dark}" media="\\(prefers-color-scheme: dark\\)`));
  for (const c of Object.values(THEME_COLORS)) assert.ok(boot.includes(`'${c}'`), `boot.js sem ${c}`);
  assert.equal(manifest.theme_color, THEME_COLORS.light);
  assert.equal(manifest.background_color, THEME_COLORS.light);
  assert.equal(manifest.user_preferences.color_scheme_dark.theme_color, THEME_COLORS.dark);
});
