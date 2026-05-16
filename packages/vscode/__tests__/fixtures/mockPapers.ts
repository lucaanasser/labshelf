/**
 * Mock paper data for testing
 */

export const mockPapers = {
  validPaper: () => ({
    id: '1',
    key: 'test2023',
    title: 'Test Research Paper',
    authors: 'John Doe, Jane Smith',
    year: 2023,
    abstract: 'This is a test abstract.',
    path: '/workspace/papers/test2023',
    createdAt: new Date('2023-01-01'),
    updatedAt: new Date('2023-01-01'),
  }),

  validPaperWithMetadata: () => ({
    ...mockPapers.validPaper(),
    doi: '10.1234/test.2023.1',
    journal: 'Test Journal',
    volume: '10',
    issue: '2',
    pages: '1-10',
    url: 'https://example.com/paper',
    keywords: ['test', 'mock', 'fixture'],
  }),

  multiplePapers: () => [
    mockPapers.validPaper(),
    {
      id: '2',
      key: 'research2024',
      title: 'Another Research Paper',
      authors: 'Bob Wilson',
      year: 2024,
      abstract: 'Another test abstract.',
      path: '/workspace/papers/research2024',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    },
  ],

  invalidPaper: () => ({
    id: '',
    key: '',
    title: '',
    authors: '',
    year: 0,
    path: '',
  }),
};
