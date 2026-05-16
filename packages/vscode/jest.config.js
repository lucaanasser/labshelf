module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__', '<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/extension.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
    },
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    'vscode': '<rootDir>/__mocks__/vscode.js',
    // pdfjs-dist uses import.meta.url (ESM-only) and cannot be loaded in Jest CJS mode
    'pdfjs-dist/legacy/build/pdf\\.worker\\.mjs': '<rootDir>/__mocks__/pdfjs-worker-legacy.js',
    'pdfjs-dist/legacy/build/pdf\\.mjs': '<rootDir>/__mocks__/pdfjs-dist-legacy.js',
    // Remap .js extensions in relative imports to allow ts-jest to resolve .ts files
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.ts'],
  testTimeout: 60000,
};
