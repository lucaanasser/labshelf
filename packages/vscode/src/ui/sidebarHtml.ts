/**
 * Module: Sidebar HTML Template
 * Responsibility: Produce the static webview document for the sidebar UI
 * Dependencies: vscode webview API
 *
 * Architectural notes:
 * - All colors come from `--vscode-*` theme tokens so the sidebar stays
 *   coherent with light, dark, and high-contrast themes without runtime
 *   theme detection.
 * - The webview is fully static: dynamic state arrives via `setState`
 *   messages and is rendered locally. Filtering and search run in the
 *   webview to avoid round-trips for ergonomic UI interactions.
 * - Actions backed by real services are tagged via `data-real`; mock-only
 *   surfaces are tagged via `data-mock` and visually badged so users can
 *   tell what is wired and what is forthcoming.
 */

export function renderSidebarHtml(cspSource: string, nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>LabShelf Library</title>
  <style nonce="${nonce}">
    :root {
      color-scheme: light dark;
      --ls-gap: 6px;
      --ls-radius: 4px;
      --ls-surface: var(--vscode-sideBar-background);
      --ls-surface-alt: var(--vscode-sideBarSectionHeader-background, var(--vscode-editorWidget-background));
      --ls-fg: var(--vscode-sideBar-foreground, var(--vscode-foreground));
      --ls-fg-muted: var(--vscode-descriptionForeground);
      --ls-border: var(--vscode-sideBar-border, var(--vscode-panel-border, transparent));
      --ls-focus: var(--vscode-focusBorder);
      --ls-accent: var(--vscode-textLink-foreground);
      --ls-badge-bg: var(--vscode-badge-background);
      --ls-badge-fg: var(--vscode-badge-foreground);
      --ls-warn: var(--vscode-editorWarning-foreground);
      --ls-error: var(--vscode-errorForeground);
    }

    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      background: var(--ls-surface);
      color: var(--ls-fg);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      font-weight: var(--vscode-font-weight);
    }

    body {
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }

    button {
      font: inherit;
      color: inherit;
      background: transparent;
      border: 1px solid transparent;
      border-radius: var(--ls-radius);
      padding: 4px 8px;
      cursor: pointer;
    }

    button:hover {
      background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
    }

    button:focus-visible {
      outline: 1px solid var(--ls-focus);
      outline-offset: -1px;
    }

    button[disabled] {
      opacity: 0.5;
      cursor: not-allowed;
    }

    input[type="search"], input[type="text"] {
      width: 100%;
      box-sizing: border-box;
      padding: 4px 8px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: var(--ls-radius);
      font: inherit;
    }

    input[type="search"]:focus,
    input[type="text"]:focus {
      outline: 1px solid var(--ls-focus);
      outline-offset: -1px;
    }

    .toolbar {
      display: flex;
      gap: 4px;
      padding: 6px 8px;
      border-bottom: 1px solid var(--ls-border);
      align-items: center;
    }

    .toolbar button {
      padding: 4px 6px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .toolbar .spacer { flex: 1; }

    .toolbar .icon {
      width: 14px;
      height: 14px;
      display: inline-block;
    }

    .search {
      padding: 6px 8px 4px 8px;
    }

    .drop-zone {
      margin: 4px 8px 6px 8px;
      padding: 10px;
      text-align: center;
      border: 1px dashed var(--ls-border);
      border-radius: var(--ls-radius);
      color: var(--ls-fg-muted);
      font-size: 0.9em;
      transition: border-color 80ms linear, background-color 80ms linear;
    }

    .drop-zone[data-active="true"] {
      border-color: var(--ls-focus);
      background: var(--vscode-list-dropBackground, var(--vscode-list-hoverBackground));
      color: var(--ls-fg);
    }

    .drop-zone strong { color: var(--ls-fg); }

    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 0 8px 6px 8px;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid var(--ls-border);
      background: var(--ls-surface-alt);
      color: var(--ls-fg);
      font-size: 0.85em;
      cursor: pointer;
    }

    .chip[aria-pressed="true"] {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
      border-color: transparent;
    }

    .chip .count {
      background: var(--ls-badge-bg);
      color: var(--ls-badge-fg);
      border-radius: 999px;
      padding: 0 5px;
      font-size: 0.75em;
      min-width: 14px;
      text-align: center;
    }

    .section {
      border-top: 1px solid var(--ls-border);
    }

    .section-header {
      display: flex;
      align-items: center;
      padding: 6px 8px;
      text-transform: uppercase;
      font-size: 0.7em;
      letter-spacing: 0.06em;
      color: var(--ls-fg-muted);
      background: var(--ls-surface-alt);
      user-select: none;
    }

    .section-header .title { flex: 1; }

    .badge-mock {
      background: var(--ls-badge-bg);
      color: var(--ls-badge-fg);
      padding: 0 5px;
      border-radius: 999px;
      font-size: 0.9em;
      letter-spacing: 0;
      text-transform: none;
    }

    .list { display: flex; flex-direction: column; }

    .paper {
      display: grid;
      grid-template-columns: 28px 1fr auto;
      gap: 8px;
      align-items: start;
      padding: 8px 8px;
      cursor: default;
      border-left: 2px solid transparent;
    }

    .paper:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .paper[data-selected="true"] {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
      border-left-color: var(--ls-focus);
    }

    .paper .avatar {
      width: 28px;
      height: 28px;
      border-radius: var(--ls-radius);
      background: var(--ls-surface-alt);
      color: var(--ls-fg-muted);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 0.8em;
      font-weight: 600;
    }

    .paper .body {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .paper .title {
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .paper .meta {
      display: flex;
      gap: 6px;
      align-items: center;
      color: var(--ls-fg-muted);
      font-size: 0.85em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .paper .status {
      font-size: 0.75em;
      padding: 0 5px;
      border-radius: 999px;
      background: var(--ls-surface-alt);
      color: var(--ls-fg-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .paper[data-status="reading"] .status {
      background: var(--vscode-charts-blue, var(--ls-badge-bg));
      color: var(--vscode-editor-background, var(--ls-badge-fg));
    }

    .paper[data-status="done"] .status {
      background: var(--vscode-charts-green, var(--ls-badge-bg));
      color: var(--vscode-editor-background, var(--ls-badge-fg));
    }

    .paper .actions {
      display: none;
      gap: 2px;
    }

    .paper:hover .actions,
    .paper:focus-within .actions {
      display: inline-flex;
    }

    .icon-btn {
      width: 22px;
      height: 22px;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: var(--ls-radius);
      color: var(--ls-fg-muted);
    }

    .icon-btn:hover { color: var(--ls-fg); }

    .icon-btn[data-mock="true"]::after {
      content: "·";
      color: var(--ls-warn);
      margin-left: 1px;
    }

    .empty, .error, .loading {
      padding: 16px;
      text-align: center;
      color: var(--ls-fg-muted);
      font-size: 0.9em;
      line-height: 1.5;
    }

    .empty strong, .error strong { color: var(--ls-fg); }

    .empty kbd {
      background: var(--ls-surface-alt);
      border: 1px solid var(--ls-border);
      padding: 0 4px;
      border-radius: 3px;
      font-size: 0.85em;
    }

    .error { color: var(--ls-error); }

    .legend {
      margin-top: auto;
      padding: 6px 8px;
      border-top: 1px solid var(--ls-border);
      color: var(--ls-fg-muted);
      font-size: 0.75em;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .legend .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--ls-warn);
      display: inline-block;
    }

    .mock-stub {
      padding: 10px 12px;
      color: var(--ls-fg-muted);
      font-size: 0.85em;
      line-height: 1.5;
    }

    .mock-stub .tag {
      display: inline-block;
      padding: 1px 6px;
      margin-right: 6px;
      border-radius: 999px;
      background: var(--ls-surface-alt);
      color: var(--ls-fg);
      font-size: 0.85em;
    }
  </style>
</head>
<body>
  <header class="toolbar" role="toolbar" aria-label="LabShelf actions">
    <button id="action-add" title="Add paper (PDF)" data-real="true">
      <span class="icon" aria-hidden="true">＋</span>
      Add
    </button>
    <button id="action-doi" title="Lookup DOI / arXiv / ISBN" data-mock="true" aria-label="Lookup DOI (mock)">
      <span class="icon" aria-hidden="true">⌕</span>
      DOI
    </button>
    <span class="spacer"></span>
    <button id="action-bibtex" title="Regenerate BibTeX for the whole library" data-real="true" aria-label="Regenerate BibTeX">
      <span class="icon" aria-hidden="true">≡</span>
    </button>
    <button id="action-refresh" title="Refresh library" data-real="true" aria-label="Refresh">
      <span class="icon" aria-hidden="true">↻</span>
    </button>
  </header>

  <div class="search">
    <input id="search-input" type="search" placeholder="Search title or cite key…" autocomplete="off" spellcheck="false" />
  </div>

  <div id="drop-zone" class="drop-zone" data-active="false" tabindex="0" aria-label="Drop a PDF to import">
    Drop a <strong>PDF</strong> here to import
  </div>

  <nav class="filters" role="tablist" aria-label="Library filters">
    <button class="chip" data-filter="all" aria-pressed="true">All <span class="count" data-count="all">0</span></button>
    <button class="chip" data-filter="recent" aria-pressed="false" data-mock="true" title="Recent (mock — needs createdAt)">Recent <span class="count" data-count="recent">0</span></button>
    <button class="chip" data-filter="unread" aria-pressed="false">Unread <span class="count" data-count="unread">0</span></button>
    <button class="chip" data-filter="reading" aria-pressed="false">Reading <span class="count" data-count="reading">0</span></button>
    <button class="chip" data-filter="done" aria-pressed="false">Done <span class="count" data-count="done">0</span></button>
    <button class="chip" data-filter="favorites" aria-pressed="false" data-mock="true" title="Favorites (mock)">Favorites <span class="count" data-count="favorites">0</span></button>
  </nav>

  <section class="section" aria-label="Papers">
    <div class="section-header">
      <span class="title">Library</span>
      <span id="result-count" class="badge-mock" aria-live="polite">0</span>
    </div>
    <div id="list" class="list" role="list"></div>
    <div id="state-loading" class="loading" hidden>Loading library…</div>
    <div id="state-empty" class="empty" hidden>
      <p><strong>No papers yet.</strong></p>
      <p>Use <kbd>Add</kbd>, drop a PDF above, or run <kbd>Research: Add Paper</kbd> from the command palette.</p>
    </div>
    <div id="state-no-match" class="empty" hidden>
      <p>No papers match the current filter or search.</p>
    </div>
    <div id="state-error" class="error" hidden>
      <p><strong>Something went wrong.</strong></p>
      <p id="state-error-message"></p>
    </div>
  </section>

  <section class="section" aria-label="Tags and collections">
    <div class="section-header">
      <span class="title">Tags &amp; Collections</span>
      <span class="badge-mock" title="Mock — not yet backed by the database">mock</span>
    </div>
    <div class="mock-stub">
      <span class="tag">#methodology</span>
      <span class="tag">#reading-group</span>
      <span class="tag">+ new</span>
      <p>Tagging and collections are visual placeholders until the database surface is wired in.</p>
    </div>
  </section>

  <section class="section" aria-label="Notes and annotations">
    <div class="section-header">
      <span class="title">Notes</span>
      <span class="badge-mock" title="Mock — not yet implemented">mock</span>
    </div>
    <div class="mock-stub">
      Lightweight notes will live here once the notes service is connected.
    </div>
  </section>

  <section class="section" aria-label="Duplicates">
    <div class="section-header">
      <span class="title">Duplicates</span>
      <span class="badge-mock" title="Mock — not yet implemented">mock</span>
    </div>
    <div class="mock-stub">No duplicate suggestions to review.</div>
  </section>

  <footer class="legend" aria-label="Legend">
    <span class="dot" aria-hidden="true"></span>
    <span>· marker = mock action, not yet wired to a backend</span>
  </footer>

  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();
      const state = {
        papers: [],
        filter: 'all',
        query: '',
        selectedId: null,
        loading: true,
        error: null,
      };

      const listEl = document.getElementById('list');
      const searchInput = document.getElementById('search-input');
      const dropZone = document.getElementById('drop-zone');
      const resultCount = document.getElementById('result-count');
      const stateLoading = document.getElementById('state-loading');
      const stateEmpty = document.getElementById('state-empty');
      const stateNoMatch = document.getElementById('state-no-match');
      const stateError = document.getElementById('state-error');
      const stateErrorMessage = document.getElementById('state-error-message');

      function post(type, payload) {
        vscode.postMessage({ type, payload: payload ?? {} });
      }

      function render() {
        stateLoading.hidden = !state.loading;
        if (state.error) {
          stateError.hidden = false;
          stateErrorMessage.textContent = state.error;
        } else {
          stateError.hidden = true;
        }

        const counts = computeCounts(state.papers);
        for (const [key, value] of Object.entries(counts)) {
          const el = document.querySelector('[data-count="' + key + '"]');
          if (el) el.textContent = String(value);
        }

        const visible = filterPapers(state.papers, state.filter, state.query);
        resultCount.textContent = String(visible.length);

        listEl.innerHTML = '';
        for (const paper of visible) {
          listEl.appendChild(renderPaper(paper));
        }

        const libraryEmpty = !state.loading && !state.error && state.papers.length === 0;
        stateEmpty.hidden = !libraryEmpty;

        const noMatch = !state.loading && !state.error && state.papers.length > 0 && visible.length === 0;
        stateNoMatch.hidden = !noMatch;
      }

      function computeCounts(papers) {
        const counts = { all: papers.length, unread: 0, reading: 0, done: 0, recent: Math.min(papers.length, 10), favorites: 0 };
        for (const paper of papers) {
          if (paper.status === 'unread') counts.unread += 1;
          if (paper.status === 'reading') counts.reading += 1;
          if (paper.status === 'done') counts.done += 1;
        }
        return counts;
      }

      function filterPapers(papers, filter, query) {
        const q = query.trim().toLowerCase();
        return papers.filter((paper) => {
          if (filter === 'unread' && paper.status !== 'unread') return false;
          if (filter === 'reading' && paper.status !== 'reading') return false;
          if (filter === 'done' && paper.status !== 'done') return false;
          if (filter === 'favorites') return false;
          if (filter === 'recent') {
            const idx = papers.indexOf(paper);
            if (idx >= 10) return false;
          }
          if (q.length === 0) return true;
          const hay = (paper.title + ' ' + paper.citeKey).toLowerCase();
          return hay.includes(q);
        });
      }

      function renderPaper(paper) {
        const row = document.createElement('div');
        row.className = 'paper';
        row.setAttribute('role', 'listitem');
        row.setAttribute('data-status', paper.status);
        row.setAttribute('data-id', paper.id);
        row.tabIndex = 0;
        if (state.selectedId === paper.id) row.setAttribute('data-selected', 'true');

        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.textContent = paper.initials;
        row.appendChild(avatar);

        const body = document.createElement('div');
        body.className = 'body';

        const title = document.createElement('div');
        title.className = 'title';
        title.title = paper.title;
        title.textContent = paper.title;
        body.appendChild(title);

        const meta = document.createElement('div');
        meta.className = 'meta';
        const status = document.createElement('span');
        status.className = 'status';
        status.textContent = paper.statusLabel;
        meta.appendChild(status);
        if (paper.year) {
          const year = document.createElement('span');
          year.textContent = String(paper.year);
          meta.appendChild(year);
        }
        const cite = document.createElement('span');
        cite.textContent = '@' + paper.citeKey;
        cite.title = paper.citeKey;
        meta.appendChild(cite);
        body.appendChild(meta);

        row.appendChild(body);

        const actions = document.createElement('div');
        actions.className = 'actions';
        actions.appendChild(iconButton('Open PDF', svgIcon('download'), () => post('openPdf', { id: paper.id })));
        actions.appendChild(iconButton('Reveal folder', svgIcon('folder-open'), () => post('openFolder', { id: paper.id })));
        actions.appendChild(iconButton('Copy cite key', svgIcon('copy'), () => post('copyCitation', { id: paper.id })));
        actions.appendChild(iconButton('Change status', svgIcon('status-cycle'), () => cycleStatus(paper)));
        actions.appendChild(iconButton('Edit metadata (mock)', svgIcon('edit'), () => post('editMetadata', { id: paper.id }), true));
        row.appendChild(actions);

        row.addEventListener('click', (event) => {
          if (event.target.closest('.actions')) return;
          state.selectedId = paper.id;
          render();
        });
        row.addEventListener('dblclick', () => post('openPdf', { id: paper.id }));
        row.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') post('openPdf', { id: paper.id });
        });

        return row;
      }

      function iconButton(label, icon, handler, isMock = false) {
        const btn = document.createElement('button');
        btn.className = 'icon-btn';
        btn.title = label;
        btn.setAttribute('aria-label', label);
        btn.innerHTML = icon;
        if (isMock) btn.setAttribute('data-mock', 'true');
        btn.addEventListener('click', (event) => { event.stopPropagation(); handler(); });
        return btn;
      }

      function svgIcon(name) {
        const common = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
        switch (name) {
          case 'download':
            return '<svg ' + common + '><path d="M12 3v10"/><path d="M8 11l4 4 4-4"/><path d="M5 20h14"/></svg>';
          case 'folder-open':
            return '<svg ' + common + '><path d="M3 7h6l2 2h10v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7a2 2 0 0 1 2-2h4l2 2"/></svg>';
          case 'copy':
            return '<svg ' + common + '><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
          case 'status-cycle':
            return '<svg ' + common + '><path d="M6 12a6 6 0 0 1 9.9-4.5"/><path d="M16.5 7.5V5h2.5"/><path d="M18 12a6 6 0 0 1-9.9 4.5"/><path d="M7.5 16.5V19H5"/></svg>';
          case 'edit':
            return '<svg ' + common + '><path d="M4 20h4l10-10a2.1 2.1 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>';
          default:
            return '<svg ' + common + '><circle cx="12" cy="12" r="8"/></svg>';
        }
      }

      function cycleStatus(paper) {
        const cycle = { unread: 'reading', reading: 'done', done: 'unread' };
        const next = cycle[paper.status] || 'unread';
        post('updateStatus', { id: paper.id, status: next });
      }

      searchInput.addEventListener('input', (event) => {
        state.query = event.target.value;
        render();
      });

      document.querySelectorAll('.chip[data-filter]').forEach((chip) => {
        chip.addEventListener('click', () => {
          document.querySelectorAll('.chip[data-filter]').forEach((other) => other.setAttribute('aria-pressed', 'false'));
          chip.setAttribute('aria-pressed', 'true');
          state.filter = chip.getAttribute('data-filter');
          render();
        });
      });

      document.getElementById('action-add').addEventListener('click', () => post('addPaper'));
      document.getElementById('action-doi').addEventListener('click', () => post('doiLookup'));
      document.getElementById('action-bibtex').addEventListener('click', () => post('regenerateBibtex'));
      document.getElementById('action-refresh').addEventListener('click', () => post('refresh'));

      dropZone.addEventListener('dragenter', (event) => { event.preventDefault(); dropZone.dataset.active = 'true'; });
      dropZone.addEventListener('dragover', (event) => { event.preventDefault(); dropZone.dataset.active = 'true'; });
      dropZone.addEventListener('dragleave', () => { dropZone.dataset.active = 'false'; });
      dropZone.addEventListener('drop', (event) => {
        event.preventDefault();
        dropZone.dataset.active = 'false';
        const uris = (event.dataTransfer && event.dataTransfer.getData('text/uri-list')) || '';
        const paths = uris
          .split(/\\r?\\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0 && !line.startsWith('#'));
        if (paths.length === 0) {
          post('dropFailed', { reason: 'no-uri-list' });
          return;
        }
        post('addPaperFromUri', { uris: paths });
      });

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message || typeof message !== 'object') return;
        if (message.type === 'setState') {
          state.papers = Array.isArray(message.payload?.papers) ? message.payload.papers : [];
          state.loading = false;
          state.error = null;
          render();
        } else if (message.type === 'setLoading') {
          state.loading = Boolean(message.payload?.loading);
          render();
        } else if (message.type === 'setError') {
          state.error = String(message.payload?.message || 'Unknown error');
          state.loading = false;
          render();
        }
      });

      post('ready');
    })();
  </script>
</body>
</html>`;
}

export function makeNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return value;
}
