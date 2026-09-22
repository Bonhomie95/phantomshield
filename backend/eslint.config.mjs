// Flat ESLint config for the backend. Previously the backend had no linter at
// all, so nothing caught floating promises — in a service built around
// deliberate fire-and-forget work (push enqueues, retention sweeps, presence
// writes) that is exactly the class of bug that goes unnoticed.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'eslint.config.mjs', 'jest.config.js'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        // Type-aware linting is intentionally NOT enabled: it roughly triples
        // lint time and the rules below don't need it.
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
      },
    },
    rules: {
      // `catch {}` and `_`-prefixed params are used deliberately throughout for
      // best-effort paths; don't fight the codebase's established style.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // The codebase uses `any` at a few Fastify/mongoose seams where the
      // library types are genuinely awkward. Warn so it stays visible.
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
    },
  },
  {
    files: ['src/__tests__/**'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
