import js from '@eslint/js'
import { plugin as shadcn } from '@shadcn/lint'
import reactHooks from 'eslint-plugin-react-hooks'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'

const ELECTRON_BOUNDARY =
  'Electron の API は apps/desktop/src/main/host/electron/ と preload だけで使います。必要な機能は host/types.ts の DesktopHost に追加してください（AGENTS.md「デスクトップ基盤の境界」）。'

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
  // デスクトップ基盤の境界：基盤（Electron）を差し替えられるよう、Electron への依存を1か所に閉じ込める
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}', 'workers/**/*.ts'],
    ignores: ['apps/desktop/src/main/host/electron/**', 'apps/desktop/src/preload/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'electron', message: ELECTRON_BOUNDARY }], patterns: [{ group: ['electron/*'], message: ELECTRON_BOUNDARY }] },
      ],
      'no-restricted-syntax': ['error', { selector: "TSQualifiedName[left.name='Electron']", message: ELECTRON_BOUNDARY }],
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
