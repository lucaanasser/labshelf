module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // TypeScript 7 ships only the native compiler, without the JS API ts-jest
  // needs, so tests compile with the aliased TypeScript 6 package instead
  // (same arrangement as packages/vscode; see the root .pnpmfile.cjs).
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { compiler: 'typescript-js', tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts',
    // Process entry points and real-terminal / real-network glue: verified by the pty smoke test, not in jest.
    '!src/main.ts',
    '!src/tui/terminal.ts',
    '!src/preview/thumbnailWorker.ts',
    '!src/platform/nodePdfOpener.ts',
  ],
  coverageThreshold: { global: { branches: 50, functions: 50, lines: 50, statements: 50 } },
  moduleNameMapper: {
    // The real credentials file is gitignored; tests never talk to Google, so the template stands in.
    '^(\\.{1,2}/(?:.*/)?)googleDriveCredentials\\.js$': '$1googleDriveCredentials.example',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testTimeout: 30000,
};
