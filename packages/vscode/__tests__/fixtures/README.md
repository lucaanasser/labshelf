# Test Fixtures

This directory contains test data, mock objects, and shared fixtures used across the test suite.

## Files

### Sample Data
- `mockPapers.ts` - Mock paper objects for testing
- `mockBibTeX.ts` - Sample BibTeX entries
- `mockFiles.ts` - Mock file system data

### Test Helpers
- `setupDatabase.ts` - Initialize test database
- `setupFileSystem.ts` - Create temporary test file structure

## Usage

```typescript
import { mockPapers } from '../fixtures/mockPapers';

describe('PaperService', () => {
  it('should handle paper data', () => {
    const paper = mockPapers.validPaper();
    // Use fixture in test
  });
});
```

## Creating Fixtures

- Keep fixtures minimal and focused
- Use factory functions for flexibility
- Document fixture structure and usage
- Place mock data in separate files by domain
