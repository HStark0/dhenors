// ESLint (flat config) — pega erros comuns sem impor estilo.
// O estilo (aspas, espaços) fica com o Prettier: npm run format
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'dist/', 'test-results/', 'playwright-report/', 'supabase/functions/'] },
  js.configs.recommended,
  {
    files: ['js/**/*.js', 'sw.js', 'sw-assets.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.serviceworker },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-control-regex': 'off',
      'no-irregular-whitespace': ['error', { skipRegExps: true, skipStrings: true, skipTemplates: true, skipComments: true }],
      'no-misleading-character-class': 'off',
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'warn',
    },
  },
  {
    files: ['js/boot.js', 'sw.js', 'sw-assets.js'],
    languageOptions: { sourceType: 'script' },
    rules: { 'no-var': 'off' }, // boot.js roda antes de tudo, até em navegadores antigos
  },
  {
    files: ['tests/**/*.mjs', 'tests/**/*.js', 'tools/**/*.mjs', 'playwright.config.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }], 'no-irregular-whitespace': ['error', { skipRegExps: true, skipStrings: true, skipTemplates: true }] },
  },
];
