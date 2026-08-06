/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  cleanTempDir: 'always',
  commandRunner: {
    command: 'npm test',
  },
  concurrency: 4,
  coverageAnalysis: 'off',
  ignorePatterns: ['/node_modules'],
  mutate: [
    'scripts/release-request.mjs:19-161',
    'scripts/collect-release.mjs:17-140',
    'scripts/update-feed.mjs:12-198',
    'scripts/app-archive-policy.mjs:12-326',
    'scripts/mac-bundle-policy.mjs:12-67',
  ],
  mutator: {
    excludedMutations: ['StringLiteral'],
  },
  reporters: ['clear-text', 'progress', 'json'],
  testRunner: 'command',
  thresholds: { break: null, high: 80, low: 60 },
  timeoutMS: 10_000,
};

export default config;
