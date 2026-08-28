// react-scripts 5 bundles jest 27 / jsdom 16, which hang on Node 18+, so the
// tests run against jest 29 directly instead of through `react-scripts test`.
module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: ['<rootDir>/src/**/*.test.js'],
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.js'],
};
