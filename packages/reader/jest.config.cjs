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
  // DOM-bound reader UI is verified in a real browser; its branching logic lives in webview/logic, which is covered.
  collectCoverageFrom: ['src/shared/**/*.ts', 'src/webview/logic/**/*.ts'],
  coverageThreshold: { global: { branches: 50, functions: 50, lines: 50, statements: 50 } },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
