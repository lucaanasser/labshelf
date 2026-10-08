import { isSafeExternalUrl, isWebviewMessage } from '../../src/reader/protocol';

describe('isWebviewMessage', () => {
  describe('accepts a valid sample of every WebviewToHost command', () => {
    it('ready-for-init', () => {
      expect(isWebviewMessage({ command: 'ready-for-init' })).toBe(true);
    });

    it('ready', () => {
      expect(isWebviewMessage({ command: 'ready', totalPages: 12 })).toBe(true);
    });

    it('perf', () => {
      expect(
        isWebviewMessage({
          command: 'perf',
          timeline: { firstPaint: 120 },
          pageNumber: 1,
          theme: 'dark',
          dpr: 2,
          canvas: 'webgl',
        }),
      ).toBe(true);
    });

    it('pageChanged', () => {
      expect(isWebviewMessage({ command: 'pageChanged', pageNumber: 3 })).toBe(true);
    });

    it('zoomChanged', () => {
      expect(isWebviewMessage({ command: 'zoomChanged', zoomLevel: 1.5 })).toBe(true);
    });

    it('selectTheme', () => {
      expect(isWebviewMessage({ command: 'selectTheme', theme: 'sepia' })).toBe(true);
    });

    it('createAnnotation', () => {
      expect(
        isWebviewMessage({ command: 'createAnnotation', type: 'highlight', pageNumber: 2, content: 'quoted text' }),
      ).toBe(true);
      expect(
        isWebviewMessage({ command: 'createAnnotation', type: 'note', pageNumber: 2, content: 'a note' }),
      ).toBe(true);
    });

    it('deleteAnnotation', () => {
      expect(isWebviewMessage({ command: 'deleteAnnotation', id: 'ann-1' })).toBe(true);
    });

    it('updateAnnotation', () => {
      expect(isWebviewMessage({ command: 'updateAnnotation', id: 'ann-1', content: 'updated' })).toBe(true);
    });

    it('saveReadingState', () => {
      expect(
        isWebviewMessage({
          command: 'saveReadingState',
          state: { page: 1, scaleValue: '1', updatedAt: '2024-01-01T00:00:00.000Z' },
        }),
      ).toBe(true);
    });

    it('copyWithCitation', () => {
      expect(isWebviewMessage({ command: 'copyWithCitation', text: 'quote', pageNumber: 5 })).toBe(true);
    });

    it('copyText', () => {
      expect(isWebviewMessage({ command: 'copyText', text: 'hello' })).toBe(true);
    });

    it('exportAnnotations', () => {
      expect(isWebviewMessage({ command: 'exportAnnotations', target: 'clipboard' })).toBe(true);
      expect(isWebviewMessage({ command: 'exportAnnotations', target: 'file' })).toBe(true);
    });

    it('openExternalLink', () => {
      expect(isWebviewMessage({ command: 'openExternalLink', url: 'https://example.com' })).toBe(true);
    });
  });

  describe('rejects malformed input', () => {
    it('rejects non-object values', () => {
      expect(isWebviewMessage(null)).toBe(false);
      expect(isWebviewMessage(undefined)).toBe(false);
      expect(isWebviewMessage('ready-for-init')).toBe(false);
      expect(isWebviewMessage(42)).toBe(false);
      expect(isWebviewMessage(['ready-for-init'])).toBe(false);
    });

    it('rejects an unknown command', () => {
      expect(isWebviewMessage({ command: 'doSomethingUnknown' })).toBe(false);
    });

    it('rejects "ready" without a numeric totalPages', () => {
      expect(isWebviewMessage({ command: 'ready' })).toBe(false);
      expect(isWebviewMessage({ command: 'ready', totalPages: '12' })).toBe(false);
    });

    it('rejects "perf" with a non-object timeline', () => {
      expect(isWebviewMessage({ command: 'perf', timeline: 'nope', pageNumber: 1, theme: 'dark', dpr: 1, canvas: null })).toBe(false);
    });

    it('rejects "pageChanged" with a string page', () => {
      expect(isWebviewMessage({ command: 'pageChanged', pageNumber: '3' })).toBe(false);
    });

    it('rejects "zoomChanged" with a non-numeric zoomLevel', () => {
      expect(isWebviewMessage({ command: 'zoomChanged', zoomLevel: '150%' })).toBe(false);
    });

    it('rejects "selectTheme" without a theme string', () => {
      expect(isWebviewMessage({ command: 'selectTheme' })).toBe(false);
      expect(isWebviewMessage({ command: 'selectTheme', theme: 5 })).toBe(false);
    });

    it('rejects "createAnnotation" with type "tag"', () => {
      expect(isWebviewMessage({ command: 'createAnnotation', type: 'tag', pageNumber: 1, content: 'x' })).toBe(false);
    });

    it('rejects "createAnnotation" with missing content', () => {
      expect(isWebviewMessage({ command: 'createAnnotation', type: 'highlight', pageNumber: 1 })).toBe(false);
    });

    it('rejects "deleteAnnotation" with an empty id', () => {
      expect(isWebviewMessage({ command: 'deleteAnnotation', id: '' })).toBe(false);
    });

    it('rejects "updateAnnotation" with empty content', () => {
      expect(isWebviewMessage({ command: 'updateAnnotation', id: 'ann-1', content: '' })).toBe(false);
    });

    it('rejects "saveReadingState" without a state object', () => {
      expect(isWebviewMessage({ command: 'saveReadingState' })).toBe(false);
    });

    it('rejects "copyWithCitation" with a missing pageNumber', () => {
      expect(isWebviewMessage({ command: 'copyWithCitation', text: 'quote' })).toBe(false);
    });

    it('rejects "copyText" with a missing text', () => {
      expect(isWebviewMessage({ command: 'copyText' })).toBe(false);
    });

    it('rejects "exportAnnotations" with target "email"', () => {
      expect(isWebviewMessage({ command: 'exportAnnotations', target: 'email' })).toBe(false);
    });

    it('rejects "openExternalLink" with a missing url', () => {
      expect(isWebviewMessage({ command: 'openExternalLink' })).toBe(false);
    });

    it('rejects NaN numeric fields', () => {
      expect(isWebviewMessage({ command: 'pageChanged', pageNumber: NaN })).toBe(false);
      expect(isWebviewMessage({ command: 'zoomChanged', zoomLevel: NaN })).toBe(false);
    });
  });
});

describe('isSafeExternalUrl', () => {
  it('accepts http, https and mailto', () => {
    expect(isSafeExternalUrl('http://example.com')).toBe(true);
    expect(isSafeExternalUrl('https://example.com/path?x=1')).toBe(true);
    expect(isSafeExternalUrl('mailto:test@example.com')).toBe(true);
  });

  it('rejects file:, command:, vscode:, javascript: and data: schemes', () => {
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeExternalUrl('command:workbench.action.something')).toBe(false);
    expect(isSafeExternalUrl('vscode://some/path')).toBe(false);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('data:text/plain;base64,SGVsbG8=')).toBe(false);
  });

  it('rejects relative and garbage input', () => {
    expect(isSafeExternalUrl('/local/path')).toBe(false);
    expect(isSafeExternalUrl('relative/path')).toBe(false);
    expect(isSafeExternalUrl('not a url at all!!!')).toBe(false);
  });
});
