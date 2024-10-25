module.exports = {
  testEnvironment: 'node',
  collectCoverageFrom: [
    'index.js',
    '!**/node_modules/**',
    '!**/vendor/**'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  // Update the test match pattern to look in tests/ directory
  testMatch: [
    '**/tests/**/*.test.js'
  ],
  // Clear mocks between each test
  clearMocks: true,
  // Automatically reset mock state
  resetMocks: true,
  // Restore the original implementation between tests
  restoreMocks: true
};
