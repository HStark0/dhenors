// ESLint (flat config) — pega erros comuns sem impor estilo.
// O estilo (aspas, espaços) fica com o Prettier: npm run format
import js from '@eslint/js';
import globals from 'globals';

export default [
  // As Edge Functions em TypeScript (Deno) ficam fora; o email.js (JS puro) entra
  { ignores: ['node_modules/', 'dist/', 'test-results/', 'playwright-report/', 'supabase/functions/**/*.ts'] },
  js.configs.recommended,
  {
    files: ['js/**/*.js', 'sw.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.serviceworker },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-control-regex': 'off',
      'no-irregular-whitespace': ['error', { skipRegExps: true, skipStrings: true, skipTemplates: true, skipComments: true }],
      'no-misleading-character-class': 'off',
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['js/boot.js', 'sw.js'],
    languageOptions: { sourceType: 'script' },
    rules: { 'no-var': 'off' }, // boot.js roda antes de tudo, até em navegadores antigos
  },
  {
    // Edge Function "send-feedback": JS puro (ESM), roda no Deno e nos testes do Node
    files: ['supabase/functions/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals['shared-node-browser'] } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }], 'no-empty': ['error', { allowEmptyCatch: true }], eqeqeq: ['error', 'smart'], 'prefer-const': 'error', 'no-var': 'error', 'no-irregular-whitespace': ['error', { skipRegExps: true, skipStrings: true, skipTemplates: true, skipComments: true }] },
  },
  {
    files: ['tests/**/*.mjs','tests/**/*.js', 'tools/**/*.mjs', 'playwright.config.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }], eqeqeq: ['error', 'smart'], 'prefer-const': 'error', 'no-var': 'error', 'no-irregular-whitespace': ['error', { skipRegExps: true, skipStrings: true, skipTemplates: true }] },
  },
];
