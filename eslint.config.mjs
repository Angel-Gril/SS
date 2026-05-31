import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const commonGlobals = {
  ...globals.browser,
  ...globals.node,
  ...globals.es2022,
  chrome: 'readonly',
};

export default tseslint.config(
  {
    ignores: [
      '**/.next/**',
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.config.js',
      '**/*.config.mjs',
      '**/*.config.ts',
    ],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: commonGlobals,
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-useless-assignment': 'off',
      'no-useless-escape': 'off',
      'prefer-const': 'off',
      'preserve-caught-error': 'off',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: commonGlobals,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-useless-assignment': 'off',
      'no-useless-escape': 'off',
      'prefer-const': 'off',
      'preserve-caught-error': 'off',
    },
  },
);
