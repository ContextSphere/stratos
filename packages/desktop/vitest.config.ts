import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    passWithNoTests: true,
    include: ['src/**/*.test.{ts,tsx}'],
    environmentMatchGlobs: [
      ['src/renderer/**', 'happy-dom'],
      ['src/main/**', 'node']
    ]
  }
})
