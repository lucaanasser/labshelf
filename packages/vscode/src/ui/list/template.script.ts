/**
 * Inline JavaScript for the paper list webview panel, injected as a nonce-protected script block.
 *
 * @depends ui/list/template.icons.ts
 * @dependents ui/list/template.ts
 */
import { secIcon } from './template.icons.js';

/**
 * Builds the inline `<script>` block for the paper list webview.
 * @param nonce CSP nonce for the script tag.
 * @param papersJson JSON-serialized PaperRecord array.
 * @returns A complete `<script>` HTML string.
 */
export function buildListScript(nonce: string, papersJson: string): string {
  return `<script nonce="${nonce}">
(function(){
  const vscode = acquireVsCodeApi();
  const papers = ${papersJson};

  // ── render list ───────────────────────────────────────────────────────────
  const list = document.getElementById('paperList');
  const countEl = document.getElementById('paperCount');
  const detail = document.getElementById('detailPane');

  countEl.textContent = papers.length > 0 ? String(papers.length) : '';

  if (papers.length === 0) {
    list.innerHTML = \`<div class="empty-state">
      <div class="empty-icon">${secIcon('book')}</div>
      <div class="empty-text">No papers in this collection</div>
      <button class="list-add-btn" id="emptyAddBtn" style="margin-top:8px" title="Add PDF or folder">+ Add Paper</button>
      <div class="empty-hint">To import by drag and drop, drop PDF files onto a folder in the LabShelf tree in the sidebar — not onto this panel.</div>
    </div>\`;
    document.getElementById('emptyAddBtn')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'addPaper' });
    });
  } else {
    papers.forEach(p => list.appendChild(buildRow(p)));
  }

  function fmt(authors) {
    if (!authors || authors.length === 0) return '';
    if (authors.length === 1) return authors[0];
    return authors.length > 2
      ? authors[0].split(' ').pop() + ' et al.'
      : authors.map(a => a.split(' ').pop()).join(', ');
  }

  function field(label, value) {
    return \`<div class="detail-field"><div class="detail-label">\${esc(label)}</div><div class="detail-value">\${esc(value)}</div></div>\`;
  }

  function badgeHtml(status) {
    const labels = { unread: 'Unread', reading: 'Reading', done: 'Done' };
    return \`<span class="badge badge-\${esc(status)}">\${esc(labels[status] || status)}</span>\`;
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function buildRow(p) {
    const row = document.createElement('div');
    row.className = 'paper-row';
    row.dataset.id = p.id;
    const creator = fmt(p.authors);
    row.innerHTML = \`
      <div class="paper-row-main">
        <div class="expand-btn collapsed" title="Expand">${secIcon('chevron-down')}</div>
        <div class="paper-type-icon">${secIcon('file')}</div>
        <div class="col-title" title="\${esc(p.title)}">\${esc(p.title)}</div>
        <div class="col-meta" title="\${esc(creator)}">\${esc(creator)}</div>
        <div class="col-meta">\${badgeHtml(p.status)}</div>
        <div class="col-attach">1</div>
      </div>
      <div class="paper-children">
        <div class="child-row" data-action="openPdf" data-id="\${esc(p.id)}">
          <div></div>
          <div style="opacity:.6;display:flex;align-items:center">${secIcon('file')}</div>
          <div>PDF</div>
          <div></div><div></div><div></div>
        </div>
      </div>
    \`;
    const main = row.querySelector('.paper-row-main');
    const expandBtn = row.querySelector('.expand-btn');
    expandBtn.addEventListener('click', e => {
      e.stopPropagation();
      const isExpanded = row.classList.toggle('expanded');
      expandBtn.classList.toggle('collapsed', !isExpanded);
    });
    main.addEventListener('click', () => selectPaper(p, row));
    row.querySelector('.child-row[data-action="openPdf"]').addEventListener('click', e => {
      e.stopPropagation();
      vscode.postMessage({ command: 'openPdf', paperId: p.id });
    });
    return row;
  }

  // ── selection + detail ────────────────────────────────────────────────────
  let selectedId = null;

  function selectPaper(p, row) {
    document.querySelectorAll('.paper-row.selected').forEach(r => r.classList.remove('selected'));
    row.classList.add('selected');
    selectedId = p.id;
    renderDetail(p);
  }

  function renderDetail(p) {
    const attachCount = 1;
    detail.innerHTML = \`
      <div class="detail-paper-title">\${esc(p.title)}</div>
      <div class="detail-section">
        <div class="sec-head" data-sec="info"><div class="sec-head-left"><span class="sec-chevron">${secIcon('chevron-down')}</span><span>Info</span></div></div>
        <div class="sec-body" id="sec-info">
          \${field('Item Type', 'Journal Article')}
          \${p.authors && p.authors.length ? p.authors.map(a => field('Author', a)).join('') : ''}
          \${p.journal ? field('Publication', p.journal) : ''}
          \${p.publisher ? field('Publisher', p.publisher) : ''}
          \${p.year ? field('Date', String(p.year)) : ''}
          \${p.volume ? field('Volume', p.volume) : ''}
          \${p.issue ? field('Issue', p.issue) : ''}
          \${p.pages ? field('Pages', p.pages) : ''}
          \${p.doi ? field('DOI', p.doi) : ''}
          \${p.issn ? field('ISSN', p.issn) : ''}
          \${p.url ? \`<div class="detail-field"><div class="detail-label">URL</div><div class="detail-value"><a href="\${esc(p.url)}" style="color:var(--vscode-textLink-foreground);word-break:break-all;font-size:11px">\${esc(p.url)}</a></div></div>\` : ''}
          \${p.language ? field('Language', p.language) : ''}
          <div class="detail-field"><div class="detail-label">Citation Key</div><div class="detail-value" style="font-family:monospace;font-size:11px">\${esc(p.citeKey)}</div></div>
          <div class="detail-field"><div class="detail-label">Status</div><div class="detail-value">\${badgeHtml(p.status)}</div></div>
        </div>
      </div>
      <div class="detail-section">
        <div class="sec-head" data-sec="abstract"><div class="sec-head-left"><span class="sec-chevron">${secIcon('chevron-down')}</span><span>Abstract</span></div></div>
        <div class="sec-body" id="sec-abstract">
          \${p.summary ? \`<div class="detail-abstract detail-abstract-truncated">\${esc(p.summary)}</div>\` : \`<div style="color:var(--vscode-descriptionForeground);font-style:italic">No abstract available</div>\`}
        </div>
      </div>
      <div class="detail-section">
        <div class="sec-head" data-sec="attach"><div class="sec-head-left"><span class="sec-chevron">${secIcon('chevron-down')}</span><span>\${attachCount} Attachment</span></div></div>
        <div class="sec-body" id="sec-attach">
          <div class="attach-item" data-action="openPdf" data-id="\${esc(p.id)}"><span class="sec-icon">${secIcon('file')}</span><span>paper.pdf</span></div>
        </div>
      </div>
      <div class="detail-section">
        <div class="sec-head" data-sec="notes"><div class="sec-head-left"><span class="sec-chevron collapsed">${secIcon('chevron-down')}</span><span>0 Notes</span></div><div class="sec-actions"><button class="sec-btn" title="Add note (coming soon)" disabled>+</button></div></div>
        <div class="sec-body hidden" id="sec-notes"><div style="color:var(--vscode-descriptionForeground);font-style:italic;font-size:11px">Notes not yet implemented</div></div>
      </div>
      <div class="detail-section">
        <div class="sec-head" data-sec="tags"><div class="sec-head-left"><span class="sec-chevron collapsed">${secIcon('chevron-down')}</span><span>0 Tags</span></div><div class="sec-actions"><button class="sec-btn" title="Add tag (coming soon)" disabled>+</button></div></div>
        <div class="sec-body hidden" id="sec-tags"><div style="color:var(--vscode-descriptionForeground);font-style:italic;font-size:11px">Tags not yet implemented</div></div>
      </div>
      <div class="detail-section">
        <div class="sec-head" data-sec="related"><div class="sec-head-left"><span class="sec-chevron collapsed">${secIcon('chevron-down')}</span><span>0 Related</span></div></div>
        <div class="sec-body hidden" id="sec-related"><div style="color:var(--vscode-descriptionForeground);font-style:italic;font-size:11px">Related papers not yet implemented</div></div>
      </div>
      <div class="detail-action-row">
        <button class="action-btn primary" data-action="openPdf" data-id="\${esc(p.id)}">Open PDF</button>
        <button class="action-btn" data-action="copyCitation" data-id="\${esc(p.id)}">Copy Key</button>
        <button class="action-btn" data-action="openFolder" data-id="\${esc(p.id)}">Show Folder</button>
        <button class="action-btn" data-action="deletePaper" data-id="\${esc(p.id)}" style="color:var(--vscode-errorForeground)">Remove</button>
      </div>
      <div style="padding:8px 10px;border-top:1px solid var(--vscode-panel-border,rgba(128,128,128,.1))">
        <div class="detail-label">Reading Status</div>
        <div style="display:flex;gap:4px;margin-top:4px">
          \${['unread','reading','done'].map(s => \`<button class="action-btn\${p.status===s?' primary':''}" data-action="updateStatus" data-id="\${esc(p.id)}" data-status="\${s}">\${s.charAt(0).toUpperCase()+s.slice(1)}</button>\`).join('')}
        </div>
      </div>
    \`;
    detail.querySelectorAll('.sec-head').forEach(h => {
      h.addEventListener('click', () => {
        const body = document.getElementById('sec-' + h.dataset.sec);
        const chev = h.querySelector('.sec-chevron');
        if (body) { body.classList.toggle('hidden'); }
        if (chev) { chev.classList.toggle('collapsed'); }
        h.classList.toggle('collapsed');
      });
    });
    detail.querySelectorAll('[data-action]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        const action = el.dataset.action;
        const id = el.dataset.id;
        if (action === 'openPdf') { vscode.postMessage({ command: 'openPdf', paperId: id }); }
        if (action === 'openFolder') { vscode.postMessage({ command: 'openFolder', paperId: id }); }
        if (action === 'copyCitation') { vscode.postMessage({ command: 'copyCitation', paperId: id }); }
        if (action === 'updateStatus') { vscode.postMessage({ command: 'updateStatus', paperId: id, status: el.dataset.status }); }
        if (action === 'deletePaper') { vscode.postMessage({ command: 'deletePaper', paperId: id }); }
      });
    });
  }

  document.getElementById('addPaperBtn')?.addEventListener('click', () => {
    vscode.postMessage({ command: 'addPaper' });
  });

  // ── detail pane: collapse + resize ─────────────────────────────────────────
  const detailPane = document.getElementById('detailPane');
  const detailResizer = document.getElementById('detailResizer');
  const toggleDetailBtn = document.getElementById('toggleDetailBtn');
  const persisted = vscode.getState() || {};
  if (persisted.detailWidth) { detailPane.style.width = persisted.detailWidth + 'px'; }
  if (persisted.detailCollapsed) { document.body.classList.add('detail-collapsed'); }
  function saveState(patch) { vscode.setState(Object.assign({}, vscode.getState() || {}, patch)); }
  toggleDetailBtn?.addEventListener('click', () => {
    const collapsed = document.body.classList.toggle('detail-collapsed');
    saveState({ detailCollapsed: collapsed });
  });
  const MIN_W = 220, MAX_W = 620, COLLAPSE_AT = 160;
  let resizing = false;
  detailResizer?.addEventListener('mousedown', e => {
    resizing = true; detailResizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!resizing) return;
    const desired = window.innerWidth - e.clientX;
    if (desired < COLLAPSE_AT) { document.body.classList.add('detail-collapsed'); }
    else { document.body.classList.remove('detail-collapsed'); detailPane.style.width = Math.min(MAX_W, Math.max(MIN_W, desired)) + 'px'; }
  });
  window.addEventListener('mouseup', () => {
    if (!resizing) return;
    resizing = false; detailResizer.classList.remove('dragging');
    document.body.style.cursor = ''; document.body.style.userSelect = '';
    saveState({ detailWidth: parseInt(detailPane.style.width, 10) || MIN_W, detailCollapsed: document.body.classList.contains('detail-collapsed') });
  });
  if (papers.length > 0 && selectedId) {
    const row = list.querySelector(\`[data-id="\${selectedId}"]\`);
    const paper = papers.find(p => p.id === selectedId);
    if (row && paper) { selectPaper(paper, row); }
  }
})();
</script>`;
}
