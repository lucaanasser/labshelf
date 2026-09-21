/**
 * Detail-pane portion of the list webview script: renders the selected paper (or a multi-selection summary) and owns the pane's collapse and resize behaviour.
 *
 * Returned as a source fragment that template.script.ts splices into its IIFE, so it shares that scope (view, ICON, STATUSES, STATUS_LABEL, esc, post, saveState, navigate, setStatus, setQuery, paperById).
 *
 * @depends none
 * @dependents ui/list/template.script.ts
 */

/**
 * Returns the detail-pane JavaScript source. Like its host script it avoids template literals and backslashes.
 * @usedBy ui/list/template.script.ts
 * @returns JavaScript source text, without a surrounding script tag
 */
export function detailScriptFragment(): string {
  return `
  // ── detail pane ───────────────────────────────────────────────────────────
  const detail = $('detailPane');

  function field(label, value) {
    return '<div class="detail-field"><div class="detail-label">' + esc(label) + '</div><div class="detail-value">' + esc(value) + '</div></div>';
  }
  function section(id, title, body, actions) {
    var closed = !!view.secCollapsed[id];
    return '<div class="detail-section">' +
      '<div class="sec-head' + (closed ? ' collapsed' : '') + '" data-sec="' + id + '"><div class="sec-head-left"><span class="sec-chevron' + (closed ? ' collapsed' : '') + '">' + ICON['chevron-down'] + '</span><span>' + esc(title) + '</span></div>' + (actions || '') + '</div>' +
      '<div class="sec-body' + (closed ? ' hidden' : '') + '" id="sec-' + id + '">' + body + '</div></div>';
  }
  function muted(text) {
    return '<div style="color:var(--vscode-descriptionForeground);font-style:italic;font-size:11px">' + esc(text) + '</div>';
  }
  function soonBtn(title) {
    return '<div class="sec-actions"><button class="sec-btn" title="' + esc(title) + '" disabled>+</button></div>';
  }

  function statusSeg(current) {
    return '<div class="status-seg">' + STATUSES.map(function (st) {
      return '<button class="' + (current === st ? 'on' : '') + '" data-action="setStatus" data-status="' + st + '"><span class="status-dot s-' + st + '"></span>' + STATUS_LABEL[st] + '</button>';
    }).join('') + '</div>';
  }
  function actionRow(single) {
    return '<div class="detail-action-row">' +
      (single ? '<button class="action-btn primary" data-action="openPdf">Open PDF</button><button class="action-btn" data-action="copyCitation">Copy Key</button>' : '') +
      '<button class="action-btn' + (single ? '' : ' primary') + '" data-action="move">Move to…</button>' +
      (single ? '<button class="action-btn" data-action="openFolder">Show Folder</button><button class="action-btn" data-action="deletePaper" style="color:var(--vscode-errorForeground)">Remove</button>' : '') +
      '</div>';
  }

  function infoBody(p) {
    var html = field('Item Type', 'Journal Article');
    (p.authors || []).forEach(function (a) { html += field('Author', a); });
    [['Publication', p.journal], ['Publisher', p.publisher], ['Date', p.year], ['Volume', p.volume], ['Issue', p.issue],
     ['Pages', p.pages], ['DOI', p.doi], ['ISSN', p.issn]].forEach(function (pair) {
      if (pair[1]) html += field(pair[0], String(pair[1]));
    });
    if (p.url) {
      html += '<div class="detail-field"><div class="detail-label">URL</div><div class="detail-value"><a href="' + esc(p.url) + '" style="color:var(--vscode-textLink-foreground);word-break:break-all;font-size:11px">' + esc(p.url) + '</a></div></div>';
    }
    if (p.language) html += field('Language', p.language);
    html += '<div class="detail-field"><div class="detail-label">Citation Key</div><div class="detail-value" style="font-family:monospace;font-size:11px">' + esc(p.citeKey) + '</div></div>';
    html += '<div class="detail-field"><div class="detail-label">Folder</div><div class="detail-value"><a href="#" data-action="goFolder" style="color:var(--vscode-textLink-foreground)">' + esc(p.relFolder || view.folder.label) + '</a></div></div>';
    return html;
  }

  function abstractBody(p) {
    if (!p.summary) return muted('No abstract available');
    var long = p.summary.length > 320;
    return '<div class="detail-abstract' + (long && !view.abstractOpen ? ' detail-abstract-truncated' : '') + '">' + esc(p.summary) + '</div>' +
      (long ? '<button class="more-link" data-action="toggleAbstract">' + (view.abstractOpen ? 'Show less' : 'Show more') + '</button>' : '');
  }

  function keywordsBody(p) {
    return '<div class="kw-list">' + p.keywords.map(function (k) {
      return '<button class="kw" data-action="searchKeyword" data-keyword="' + esc(k) + '" title="Search this keyword">' + esc(k) + '</button>';
    }).join('') + '</div>';
  }

  // What the paper is comes first, then what you can do with it; reference fields follow.
  function paperDetailHtml(p) {
    var venue = [p.journal || p.publisher, p.year].filter(Boolean).join(' · ');
    var hasKeywords = p.keywords && p.keywords.length > 0;
    return '<div class="detail-head">' +
        '<div class="detail-paper-title">' + esc(p.title) + '</div>' +
        (p.authors && p.authors.length ? '<div class="detail-byline">' + esc(p.authors.join(', ')) + '</div>' : '') +
        (venue ? '<div class="detail-venue">' + esc(venue) + '</div>' : '') +
        actionRow(true) + statusSeg(p.status) +
      '</div>' +
      section('abstract', 'Abstract', abstractBody(p)) +
      (hasKeywords ? section('keywords', 'Keywords', keywordsBody(p)) : '') +
      section('info', 'Info', infoBody(p)) +
      section('attach', '1 Attachment', '<div class="attach-item" data-action="openPdf"><span class="sec-icon">' + ICON['file'] + '</span><span>paper.pdf</span></div>') +
      section('notes', '0 Notes', muted('Notes not yet implemented'), soonBtn('Add note (coming soon)')) +
      section('tags', '0 Tags', muted('Tags not yet implemented'), soonBtn('Add tag (coming soon)')) +
      section('related', '0 Related', muted('Related papers not yet implemented'));
  }

  function renderDetail() {
    var ids = Array.from(view.selected);
    if (ids.length === 0) {
      detail.innerHTML = '<div class="detail-placeholder">Select a paper to see details</div>';
      return;
    }
    if (ids.length > 1) {
      detail.innerHTML = '<div class="detail-head"><div class="detail-paper-title">' + ids.length + ' papers selected</div>' +
        '<div class="detail-byline">Drag them onto a subfolder chip or a path segment, or pick a destination.</div>' +
        actionRow(false) + statusSeg(null) + '</div>';
    } else {
      var p = paperById(ids[0]);
      if (!p) { detail.innerHTML = ''; return; }
      detail.innerHTML = paperDetailHtml(p);
    }

    detail.querySelectorAll('.sec-head').forEach(function (h) {
      h.addEventListener('click', function () {
        var sec = h.dataset.sec, closed = !view.secCollapsed[sec];
        view.secCollapsed[sec] = closed;
        saveState({ secCollapsed: view.secCollapsed });
        $('sec-' + sec).classList.toggle('hidden', closed);
        h.classList.toggle('collapsed', closed);
        h.querySelector('.sec-chevron').classList.toggle('collapsed', closed);
      });
    });
    detail.querySelectorAll('[data-action]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        var action = el.dataset.action, current = Array.from(view.selected), id = current[0];
        if (action === 'move') { post('pickMoveTarget', { paperIds: current }); return; }
        if (action === 'setStatus') { setStatus(current, el.dataset.status); return; }
        if (action === 'goFolder') { var paper = paperById(id); if (paper) navigate(paper.folderPath); return; }
        if (action === 'toggleAbstract') { view.abstractOpen = !view.abstractOpen; renderDetail(); return; }
        if (action === 'searchKeyword') { view.status = 'all'; setQuery(el.dataset.keyword.toLowerCase()); return; }
        post(action, { paperId: id });
      });
    });
  }

  // ── detail pane: collapse + resize ─────────────────────────────────────────
  const detailResizer = $('detailResizer');
  const MIN_W = 220, MAX_W = 620, COLLAPSE_AT = 160;
  if (saved.detailWidth) { detail.style.width = saved.detailWidth + 'px'; }
  if (saved.detailCollapsed) { document.body.classList.add('detail-collapsed'); }
  $('toggleDetailBtn').addEventListener('click', function () {
    saveState({ detailCollapsed: document.body.classList.toggle('detail-collapsed') });
  });
  var resizing = false;
  detailResizer.addEventListener('mousedown', function (e) {
    resizing = true; detailResizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; e.preventDefault();
  });
  window.addEventListener('mousemove', function (e) {
    if (!resizing) return;
    var desired = window.innerWidth - e.clientX;
    if (desired < COLLAPSE_AT) { document.body.classList.add('detail-collapsed'); }
    else { document.body.classList.remove('detail-collapsed'); detail.style.width = Math.min(MAX_W, Math.max(MIN_W, desired)) + 'px'; }
  });
  window.addEventListener('mouseup', function () {
    if (!resizing) return;
    resizing = false; detailResizer.classList.remove('dragging');
    document.body.style.cursor = ''; document.body.style.userSelect = '';
    saveState({ detailWidth: parseInt(detail.style.width, 10) || MIN_W, detailCollapsed: document.body.classList.contains('detail-collapsed') });
  });
`;
}
