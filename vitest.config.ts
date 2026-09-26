import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/desktop/src/main/**/*.test.ts', 'workers/**/*.test.ts'],
    environment: 'node',
  },
})
