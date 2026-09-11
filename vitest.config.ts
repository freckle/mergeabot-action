import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    mockReset: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // all + include: report every src file, not just ones a test loaded
      all: true,
      include: ['src/**/*.ts'],
      // main.ts is thin wiring, covered by the integration CI job instead
      exclude: ['src/main.ts'],
      // Set just below what the existing suite already achieves (97.15 lines,
      // 95.57 branches, 97.10 functions, 97.22 statements) so a drop fails CI
      // rather than passing silently. Remove to stop enforcing coverage (also
      // revert ci.yml's pnpm coverage -> pnpm test).
      thresholds: {
        lines: 97,
        branches: 95,
        functions: 97,
        statements: 97
      }
    }
  }
})
