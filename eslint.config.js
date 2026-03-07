import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      'react-hooks': reactHooks
    },
    rules: {
      // TypeScript rules
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'error',

      // Disable JS rules superseded by TS rules
      'no-unused-vars': 'off',

      // Relaxed rules for existing code patterns
      'no-empty': 'off',                    // common catch {} pattern
      'no-async-promise-executor': 'warn',  // pre-existing
      'prefer-const': 'warn',              // pre-existing

      // React hooks
      'react-hooks/exhaustive-deps': 'warn'
    }
  },
  {
    ignores: ['**/dist/**', '**/out/**', '**/node_modules/**', '**/*.d.ts', '**/*.config.*']
  }
)
