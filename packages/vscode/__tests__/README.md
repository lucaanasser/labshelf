# Test Architecture

This directory contains all tests for LabShelf APIs, organized by module layer.

## Structure

```
__tests__/
├── core/              # Tests for eventBus, logger, paperService
├── db/                # Tests for database operations
├── storage/           # Tests for file system operations
├── pdf/               # Tests for PDF parsing
├── bibtex/            # Tests for BibTeX parsing
├── commands/          # Tests for command handlers
├── fixtures/          # Test fixtures and mock data
├── setup.ts           # Global test setup
└── README.md          # This file
```

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run tests for a specific module
npm test -- core
```

## Test Naming Conventions

- Test files should be named `<module>.test.ts` or `<feature>.spec.ts`
- Describe blocks should match the class or function being tested
- Test cases should be specific and descriptive
- Use `describe` for grouping related tests

## Writing Tests

### 1. Unit Tests

Test individual functions and classes in isolation:

```typescript
describe('eventBus', () => {
  describe('emit', () => {
    it('should emit events to registered listeners', () => {
      const bus = new EventBus();
      const listener = jest.fn();
      
      bus.on('event', listener);
      bus.emit('event', { data: 'test' });
      
      expect(listener).toHaveBeenCalledWith({ data: 'test' });
    });
  });
});
```

### 2. Integration Tests

Test modules working together:

```typescript
describe('paperService integration', () => {
  it('should fetch and cache papers from database', () => {
    // Test service integration with database
  });
});
```

### 3. Fixtures and Mocks

Use the `fixtures/` directory for:
- Mock data
- Test database seeds
- Sample files
- Predefined test states

## Test Requirements by Layer

### Core Layer (`core/`)
- EventBus: Event emission, listener registration, error handling
- Logger: Structured logging, log levels, output
- PaperService: Paper retrieval, caching, error states

### Database Layer (`db/`)
- Connection: Database initialization, connection pooling
- Queries: CRUD operations, transactions, error handling
- Schema: Table creation, migrations, constraints

### Storage Layer (`storage/`)
- File operations: Read, write, delete with error handling
- Path resolution: Workspace paths, relative/absolute conversions
- File watching: File change detection and events

### PDF Layer (`pdf/`)
- PDF parsing: Metadata extraction, error recovery
- Page analysis: Layout detection, text handling
- File validation: Format checking, corruption handling

### BibTeX Layer (`bibtex/`)
- Parsing: BibTeX syntax validation, entry extraction
- Formatting: Citation generation, export
- Validation: Reference validation, key uniqueness

### Commands Layer (`commands/`)
- Command execution: Handler invocation, argument passing
- Error handling: User-facing error messages
- State management: Command side effects and state changes

## Mandatory Test Coverage

According to AGENTS.md, every feature **MUST** have:

1. **Unit Tests**: Validate individual components
2. **Integration Tests**: Verify component interactions
3. **Spec Compliance**: Test cases must cover all behaviors in the corresponding `spec.yaml`
4. **Error Scenarios**: Test error handling and edge cases
5. **Fixtures**: Use consistent test data

## Coverage Requirements

- Minimum **50%** coverage across all layers
- **80%+** for critical paths (database, file I/O, BibTeX parsing)
- Every public API must have at least one test
- Error paths must be tested

## CI/CD Integration

Tests are run automatically on:
- Pull requests
- Commits to main
- Pre-release builds

Failing tests block merges. Always run tests locally before committing:

```bash
npm test
```
