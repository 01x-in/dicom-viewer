// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import { importX } from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.venv/**',
      'fixtures/**',
      // Examples are standalone projects installed from tarballs; the matrix builds and runs them.
      'examples/**',
      '.matrix/**',
      '.tarballs/**',
      '.docs/**',
      '.visual/**',
      'packages/core/assets/**',
      'packages/core/src/generated/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'import-x': importX },
    rules: {
      'import-x/no-default-export': 'error',
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "TSAsExpression[expression.type='TSAsExpression'][expression.typeAnnotation.type='TSUnknownKeyword']",
          message:
            'Do not use `as unknown as X`. Narrow the value with a type guard or a Zod schema.',
        },
      ],
      // Only the engine layer may talk to Cornerstone (see docs/plan.md, "Boundaries").
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@cornerstonejs/*'],
              message:
                'Only packages/core/src/engine may import Cornerstone. Go through RenderingPort.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/core/src/engine/**/*.ts', 'packages/core/workers/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // Tool configuration files must default-export by convention.
    files: [
      '*.config.ts',
      '*.config.js',
      'packages/*/*.config.ts',
      'tools/*/*.config.ts',
      'scripts/*.config.ts',
      'site/*.config.ts',
    ],
    rules: { 'import-x/no-default-export': 'off' },
  },
);
