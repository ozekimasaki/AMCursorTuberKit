import js from '@eslint/js'
import { plugin as shadcn } from '@shadcn/lint'
import reactHooks from 'eslint-plugin-react-hooks'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig([
  { ignores: ['**/node_modules/**', '**/out/**', '**/release/**', '**/dist/**', '**/.wrangler/**', '.agents/**', '.pi/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['apps/desktop/src/renderer/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // デザインシステムのルール（tokens.css のセマンティックカラーだけを使う）
  {
    files: ['apps/desktop/src/renderer/src/**/*.tsx'],
    ignores: ['apps/desktop/src/renderer/src/components/ui/**'],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { shadcn },
    settings: {
      shadcn: { ui: '@/components/ui', note: 'packages/ui/src/tokens.css のトークンを使ってください。' },
    },
    rules: {
      'shadcn/no-raw-colors': 'error',
      'shadcn/no-unknown-classes': 'error',
      'shadcn/no-arbitrary-values': 'warn',
    },
  },
])
