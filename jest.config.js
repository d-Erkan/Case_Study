'use strict';

/**
 * Two projects share one baseline (globalSetup) and run serially (maxWorkers: 1)
 * because every test talks to the same stateful API + database.
 */

const common = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/tests/setup-after-env.js'],
};

module.exports = {
  globalSetup: '<rootDir>/tests/global-setup.js',
  globalTeardown: '<rootDir>/tests/global-teardown.js',
  testSequencer: '<rootDir>/tests/sequencer.js',
  maxWorkers: 1,
  testTimeout: 30_000,
  verbose: true,
  reporters: ['default', '<rootDir>/lib/known-bugs-reporter.js'],
  projects: [
    { ...common, displayName: 'integration', testMatch: ['<rootDir>/tests/integration/**/*.test.js'] },
    { ...common, displayName: 'e2e', testMatch: ['<rootDir>/tests/e2e/**/*.test.js'] },
  ],
};
