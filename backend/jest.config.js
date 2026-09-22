/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  // @phantomshield/shared resolves through node_modules like it does at runtime.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', {}],
  },

  // Without collectCoverageFrom, Jest only instruments files a test happens to
  // import — so `npm test` reported ~55% while the true figure across the
  // service was ~11%. Measure every source file, so the number means something
  // and untested modules are visible instead of invisible.
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/__tests__/**',
    '!src/scripts/**',
    // index.ts binds a port on import; it is covered by the CI boot smoke test.
    '!src/index.ts',
    '!src/types/**',
  ],
  coverageReporters: ['text-summary', 'lcov'],

  // Floors, not targets — deliberately set just under the current honest
  // numbers so coverage can only go up. Note Jest removes path-matched files
  // from the `global` group, so `global` here is "everything except the two
  // security-critical modules below", which is genuinely ~8% until an API
  // integration harness exists. Raise these as that lands.
  coverageThreshold: {
    global: {
      statements: 8,
      branches: 2,
      functions: 2,
      lines: 7,
    },
    // The security-critical pure logic is held to a real bar.
    './src/lib/plans.ts': { statements: 90, branches: 85, functions: 90, lines: 90 },
    // storage.ts / config/kv.ts are covered by mongoState.test.ts, which needs
    // MONGODB_TEST_URI (CI provides it), so they are not gated here.
  },
};
