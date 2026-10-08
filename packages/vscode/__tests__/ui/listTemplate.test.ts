import * as vm from 'node:vm';
import { buildListPanelHtml } from '../../src/ui/list/template';
import { buildListScript } from '../../src/ui/list/template.script';

const webview = { cspSource: 'vscode-resource:' } as never;

describe('buildListPanelHtml', () => {
  const html = buildListPanelHtml(webview);

  it('renders the navigation shell', () => {
    for (const id of ['breadcrumb', 'searchInput', 'statusFilters', 'subStrip', 'includeSubBtn', 'newFolderBtn', 'addPaperBtn', 'paperList', 'detailPane']) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it('exposes sortable column heads', () => {
    for (const key of ['title', 'creator', 'year', 'publication', 'status']) {
      expect(html).toContain(`data-sort="${key}"`);
    }
  });

  it('locks scripts to a nonce', () => {
    const nonce = /script-src 'nonce-([A-Za-z0-9]+)'/.exec(html)?.[1];
    expect(nonce).toBeDefined();
    expect(html).toContain(`<script nonce="${nonce}">`);
  });
});

describe('buildListScript', () => {
  const script = buildListScript('abc');
  const body = script.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');

  it('is syntactically valid JavaScript', () => {
    expect(() => new vm.Script(body)).not.toThrow();
  });

  it('handshakes with the host and handles every organizing action', () => {
    for (const command of ['ready', 'navigate', 'movePapers', 'pickMoveTarget', 'newFolder', 'addPaper', 'openPdf']) {
      expect(body).toContain(`'${command}'`);
    }
  });

  it('keeps the list about papers: subfolders are chips, never list rows', () => {
    expect(body).toContain('sub-chip');
    expect(body).not.toContain('folder-row');
  });

  it('directs drag-and-drop import to the sidebar tree in the empty state', () => {
    expect(body).toContain('drop PDF files onto a folder in the LabShelf tree');
  });

  it('has no backslashes outside the embedded icon table', () => {
    // The script lives in a TypeScript template string; a stray escape there
    // changes meaning silently.
    const lines = body.split('\n').filter((line) => line.includes('\\') && !line.includes('const ICON ='));
    expect(lines).toEqual([]);
  });

  it('shows text layers and asks the host for OCR', () => {
    expect(body).toContain("m.type === 'jobs'");
    expect(body).toContain("post('makeSearchable'");
    for (const fragment of ['tl-tab', 'tlBanner', 'tlField', 'file-no-text']) {
      expect(body).toContain(fragment);
    }
  });

  it('renders papers saved without a PDF honestly', () => {
    expect(body).toContain('function hasPdf(p)');
    expect(body).toContain('file-off');
    expect(body).toContain('No PDF attached');
    // textLayerSummary reports "No PDF" instead of a text-layer verdict.
    expect(body).toContain("'No PDF'");
  });
});
