import { READER_SHELL_BODY } from '../../src/reader/shell';

describe('READER_SHELL_BODY', () => {
  it('holds every container the reader UI looks up by id', () => {
    for (const id of ['app', 'sidebar', 'sidebar-resizer', 'pdf-shell', 'toolbar', 'find-bar', 'viewerContainer', 'viewer', 'status-pill', 'loading-msg', 'error-msg', 'selection-toolbar', 'hover-popup', 'cheatsheet']) {
      expect(READER_SHELL_BODY).toContain(`id="${id}"`);
    }
  });

  it('starts with the sidebar and error message hidden and the viewer focusable', () => {
    expect(READER_SHELL_BODY).toContain('<aside id="sidebar" aria-label="Sidebar" hidden>');
    expect(READER_SHELL_BODY).toContain('<div id="error-msg" role="alert" hidden>');
    expect(READER_SHELL_BODY).toContain('<div id="viewerContainer" tabindex="0"><div id="viewer" class="pdfViewer">');
  });
});
