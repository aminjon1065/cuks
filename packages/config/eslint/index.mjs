import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Shared flat ESLint config for the CUKS monorepo.
 * Encodes the conventions from docs/04-conventions.md:
 *  - no `any`, no `@ts-ignore` (only `@ts-expect-error` with description),
 *  - no `enum` (use `as const` objects + union types).
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/*.tsbuildinfo',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true, 'ts-nocheck': true },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSEnumDeclaration',
          message: 'Do not use `enum`. Use `as const` objects + union types (docs/04).',
        },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  // React files: hooks rules everywhere.
  {
    files: ['**/*.tsx'],
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  // Fast-refresh only matters for the Vite app, not the component library.
  {
    files: ['apps/web/**/*.tsx'],
    plugins: { 'react-refresh': reactRefresh },
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  // NestJS uses parameter decorators + classes; relax rules that clash with DI.
  {
    files: ['apps/api/**/*.ts', 'apps/worker/**/*.ts'],
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
      // DI-injected classes appear "type-only" to ESLint, but emitDecoratorMetadata
      // needs the value import at runtime — enforcing `import type` breaks injection.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  // Config / script / CLI / e2e files may log to the console.
  {
    files: [
      '**/*.{js,mjs,cjs}',
      '**/*.config.{ts,mts}',
      '**/seed*.ts',
      '**/scripts/**',
      '**/import/**',
      '**/e2e/**',
    ],
    rules: {
      'no-console': 'off',
    },
  },
  prettier,
);
