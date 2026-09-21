/**
 * Inline JavaScript for the list webview panel. The list shows papers only; subfolders live in a chip strip above it. Owns search, status filters, sorting, selection, keyboard control, inline status changes, and paper drag-and-drop.
 *
 * The script body deliberately avoids template literals and backslashes so it can live inside a TypeScript template string without escaping.
 *
 * @depends ui/list/template.icons.ts, ui/list/template.detail.script.ts
 * @dependents ui/list/template.ts
 */
import { secIcon } from './template.icons.js';
import { detailScriptFragment } from './template.detail.script.js';

const ICON_NAMES = ['chevron-down', 'chevron-right', 'file', 'folder', 'library', 'book', 'search'] as const;

/**
 * Builds the inline `<script>` block for the list webview.
 * @param nonce CSP nonce for the script tag.
 * @returns A complete `<script>` HTML string.
 */
export function buildListScript(nonce: string): string {
  const icons = JSON.stringify(Object.fromEntries(ICON_NAMES.map((name) => [name, secIcon(name)])));

  return `<script nonce="${nonce}">
(function(){
  const vscode = acquireVsCodeApi();
  const ICON = ${icons};
  const DRAG_MIME = 'application/x-labshelf-papers';
  const STATUSES = ['unread', 'reading', 'done'];
  const STATUS_ORDER = { unread: 0, reading: 1, done: 2 };
  const STATUS_LABEL = { unread: 'Unread', reading: 'Reading', done: 'Done' };

  function $(id) { return document.getElementById(id); }
  const list = $('paperList'), crumbs = $('breadcrumb'), subStrip = $('subStrip'), statusFilters = $('statusFilters');
  const search = $('searchInput'), searchBox = search.parentElement;
  const includeSubBtn = $('includeSubBtn'), colHeads = $('colHeads');

  const saved = vscode.getState() || {};
  function saveState(patch) { vscode.setState(Object.assign({}, vscode.getState() || {}, patch)); }
  function post(command, payload) { vscode.postMessage(Object.assign({ command: command }, payload || {})); }

  const view = {
    folder: null, breadcrumb: [], subfolders: [], papers: [],
    query: '', status: 'all',
    sortKey: saved.sortKey || 'title',
    sortDir: saved.sortDir === -1 ? -1 : 1,
    includeSub: saved.includeSub !== false,
    selected: new Set(), anchor: null, cursor: null,
    expanded: new Set(), order: [],
    secCollapsed: saved.secCollapsed || { notes: true, tags: true, related: true },
    abstractOpen: false,
  };

  // ── formatting ────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function lastName(a) { return String(a).split(' ').pop(); }
  function fmtCreator(authors) {
    if (!authors || authors.length === 0) return '';
    if (authors.length === 1) return authors[0];
    return authors.length > 2 ? lastName(authors[0]) + ' et al.' : authors.map(lastName).join(', ');
  }
  function nextStatus(status) { return STATUSES[(STATUSES.indexOf(status) + 1) % STATUSES.length]; }
  function badgeHtml(status) {
    return '<button class="badge badge-' + esc(status) + '" data-cycle="1" title="Click to mark as ' + STATUS_LABEL[nextStatus(status)] + '">' + esc(STATUS_LABEL[status] || status) + '</button>';
  }
  function tokens() { return view.query.toLowerCase().split(' ').filter(Boolean); }
  // Escapes text and wraps every search-token match in <mark>.
  function hl(text, toks) {
    text = String(text == null ? '' : text);
    if (!toks.length) return esc(text);
    var lower = text.toLowerCase(), marks = [];
    toks.forEach(function (t) {
      var i = 0;
      while ((i = lower.indexOf(t, i)) !== -1) { marks.push([i, i + t.length]); i += t.length; }
    });
    if (!marks.length) return esc(text);
    marks.sort(function (a, b) { return a[0] - b[0]; });
    var out = '', pos = 0;
    marks.forEach(function (m) {
      if (m[1] <= pos) return;
      var start = Math.max(m[0], pos);
      out += esc(text.slice(pos, start)) + '<mark>' + esc(text.slice(start, m[1])) + '</mark>';
      pos = m[1];
    });
    return out + esc(text.slice(pos));
  }

  // ── derived rows ──────────────────────────────────────────────────────────
  // Papers in scope before the status tab is applied, so each tab can show its own count.
  // A search always covers the whole subtree; without one the subfolder toggle decides.
  function papersInScope() {
    var toks = tokens();
    return view.papers.filter(function (p) {
      if (toks.length) return toks.every(function (t) { return p._hay.indexOf(t) !== -1; });
      return view.includeSub || p.relFolder === '';
    });
  }
  function sortPapers(papers) {
    var key = view.sortKey, dir = view.sortDir;
    function val(p) {
      if (key === 'creator') return fmtCreator(p.authors).toLowerCase();
      if (key === 'year') return p.year || 0;
      if (key === 'status') return STATUS_ORDER[p.status] || 0;
      if (key === 'publication') return String(p.journal || p.publisher || '').toLowerCase();
      return String(p.title || '').toLowerCase();
    }
    return papers.sort(function (a, b) {
      var x = val(a), y = val(b);
      if (x < y) return -dir;
      if (x > y) return dir;
      return String(a.title || '').localeCompare(String(b.title || ''));
    });
  }
  function paperById(id) {
    for (var i = 0; i < view.papers.length; i++) { if (view.papers[i].id === id) return view.papers[i]; }
    return null;
  }

  // ── navigation ────────────────────────────────────────────────────────────
  function navigate(dirPath) { post('navigate', { dirPath: dirPath }); }
  function goUp() {
    if (view.breadcrumb.length > 1) navigate(view.breadcrumb[view.breadcrumb.length - 2].dirPath);
  }

  // Lets papers dragged from the list be dropped on el to move them into dirPath.
  function makeDropTarget(el, dirPath) {
    function accepts(e) { return Array.prototype.indexOf.call(e.dataTransfer.types, DRAG_MIME) !== -1; }
    el.addEventListener('dragover', function (e) {
      if (!accepts(e)) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('drop-target');
    });
    el.addEventListener('dragleave', function () { el.classList.remove('drop-target'); });
    el.addEventListener('drop', function (e) {
      el.classList.remove('drop-target');
      if (!accepts(e)) return;
      e.preventDefault();
      var ids = [];
      try { ids = JSON.parse(e.dataTransfer.getData(DRAG_MIME)) || []; } catch (err) { ids = []; }
      if (ids.length) post('movePapers', { paperIds: ids, targetDir: dirPath });
    });
  }

  function renderHeader(shown, scopeTotal) {
    crumbs.innerHTML = '';
    view.breadcrumb.forEach(function (node, i) {
      var isLast = i === view.breadcrumb.length - 1;
      if (i > 0) {
        var sep = document.createElement('span');
        sep.className = 'crumb-sep'; sep.innerHTML = ICON['chevron-right'];
        crumbs.appendChild(sep);
      }
      var b = document.createElement('button');
      b.className = 'crumb' + (isLast ? ' current' : '');
      b.title = isLast ? node.label : 'Go to ' + node.label;
      b.innerHTML = (i === 0 ? ICON['library'] : '') + '<span>' + esc(node.label) + '</span>';
      if (!isLast) {
        b.addEventListener('click', function () { navigate(node.dirPath); });
        makeDropTarget(b, node.dirPath);
      }
      crumbs.appendChild(b);
    });
    var count = document.createElement('span');
    count.className = 'list-header-count'; count.id = 'paperCount';
    var narrowed = tokens().length > 0 || view.status !== 'all';
    count.textContent = narrowed ? shown + ' / ' + view.papers.length : (scopeTotal ? String(scopeTotal) : '');
    crumbs.appendChild(count);
  }

  function renderStatusTabs(scope) {
    var counts = { all: scope.length, unread: 0, reading: 0, done: 0 };
    scope.forEach(function (p) { if (counts[p.status] != null) counts[p.status]++; });
    statusFilters.innerHTML = '';
    ['all'].concat(STATUSES).forEach(function (key) {
      var b = document.createElement('button');
      b.className = 'status-tab' + (view.status === key ? ' active' : '');
      b.dataset.status = key;
      b.setAttribute('role', 'tab');
      b.innerHTML = (key === 'all' ? '' : '<span class="status-dot s-' + key + '"></span>') +
        '<span>' + (key === 'all' ? 'All' : STATUS_LABEL[key]) + '</span><span class="n">' + counts[key] + '</span>';
      b.addEventListener('click', function () { view.status = key; render(); });
      statusFilters.appendChild(b);
    });
  }

  function renderSubStrip() {
    subStrip.innerHTML = '';
    view.subfolders.forEach(function (f) {
      var b = document.createElement('button');
      b.className = 'sub-chip';
      b.title = 'Open ' + f.label + ' — or drop papers here to move them';
      b.innerHTML = ICON['folder'] + '<span>' + esc(f.label) + '</span>' + (f.count > 0 ? '<span class="n">' + f.count + '</span>' : '');
      b.addEventListener('click', function () { navigate(f.dirPath); });
      makeDropTarget(b, f.dirPath);
      subStrip.appendChild(b);
    });
  }

  // ── rows ──────────────────────────────────────────────────────────────────
  function buildPaperRow(p, toks) {
    var row = document.createElement('div');
    row.className = 'paper-row' + (view.expanded.has(p.id) ? ' expanded' : '');
    row.dataset.id = p.id;
    row.draggable = true;
    var creator = fmtCreator(p.authors), venue = p.journal || p.publisher || '';
    var chip = p.relFolder ? '<span class="loc-chip" title="Go to ' + esc(p.relFolder) + '">' + hl(p.relFolder, toks) + '</span>' : '';
    row.innerHTML =
      '<div class="paper-row-main">' +
        '<div class="expand-btn' + (view.expanded.has(p.id) ? '' : ' collapsed') + '" title="Attachments">' + ICON['chevron-down'] + '</div>' +
        '<div class="paper-type-icon">' + ICON['file'] + '</div>' +
        '<div class="col-title title-cell" title="' + esc(p.title) + '"><span class="title-text">' + hl(p.title, toks) + '</span>' + chip + '</div>' +
        '<div class="col-meta" title="' + esc((p.authors || []).join(', ')) + '">' + hl(creator, toks) + '</div>' +
        '<div class="col-meta">' + (p.year ? hl(p.year, toks) : '') + '</div>' +
        '<div class="col-meta col-pub" title="' + esc(venue) + '">' + hl(venue, toks) + '</div>' +
        '<div class="col-meta">' + badgeHtml(p.status) + '</div>' +
      '</div>' +
      '<div class="paper-children">' +
        '<div class="child-row"><div></div><div style="opacity:.6;display:flex;align-items:center">' + ICON['file'] + '</div><div>PDF</div><div></div><div></div><div class="col-pub"></div><div></div></div>' +
      '</div>';

    var expandBtn = row.querySelector('.expand-btn');
    expandBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = row.classList.toggle('expanded');
      expandBtn.classList.toggle('collapsed', !open);
      if (open) view.expanded.add(p.id); else view.expanded.delete(p.id);
    });
    var main = row.querySelector('.paper-row-main');
    main.addEventListener('click', function (e) { clickPaper(p.id, e); });
    main.addEventListener('dblclick', function () { post('openPdf', { paperId: p.id }); });
    row.querySelector('.child-row').addEventListener('click', function (e) {
      e.stopPropagation(); post('openPdf', { paperId: p.id });
    });
    row.querySelector('[data-cycle]').addEventListener('click', function (e) {
      e.stopPropagation(); setStatus([p.id], nextStatus(p.status));
    });
    row.querySelector('[data-cycle]').addEventListener('dblclick', function (e) { e.stopPropagation(); });
    var chipEl = row.querySelector('.loc-chip');
    if (chipEl) chipEl.addEventListener('click', function (e) { e.stopPropagation(); navigate(p.folderPath); });

    row.addEventListener('dragstart', function (e) {
      if (!view.selected.has(p.id)) { selectOnly(p.id); }
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify(Array.from(view.selected)));
      e.dataTransfer.setData('text/plain', p.title || p.id);
      e.dataTransfer.effectAllowed = 'move';
      document.body.classList.add('dragging-papers');
      applySelection('dragging');
    });
    row.addEventListener('dragend', function () {
      document.body.classList.remove('dragging-papers');
      list.querySelectorAll('.dragging').forEach(function (r) { r.classList.remove('dragging'); });
    });
    return row;
  }

  // Applied locally first so the row responds instantly; the host confirms with a fresh state.
  function setStatus(ids, status) {
    ids.forEach(function (id) {
      var p = paperById(id);
      if (p && p.status !== status) { p.status = status; post('updateStatus', { paperId: id, status: status }); }
    });
    render();
  }

  function emptyState(narrowed) {
    var box = document.createElement('div');
    box.className = 'empty-state';
    if (narrowed) {
      box.innerHTML = '<div class="empty-icon">' + ICON['search'] + '</div><div class="empty-text">No papers match in ' + esc(view.folder.label) + '</div>' +
        '<button class="list-add-btn" style="margin-top:8px">Clear filters</button>';
      box.querySelector('button').addEventListener('click', function () { view.status = 'all'; setQuery(''); search.focus(); });
    } else {
      var onlyNested = view.papers.length > 0;
      box.innerHTML = '<div class="empty-icon">' + ICON['book'] + '</div>' +
        '<div class="empty-text">' + (onlyNested ? 'All papers here are inside subfolders' : 'No papers here yet') + '</div>' +
        '<button class="list-add-btn" style="margin-top:8px">' + (onlyNested ? 'Show papers from subfolders' : '+ Add Paper') + '</button>' +
        (onlyNested ? '' : '<div class="empty-hint">To import by drag and drop, drop PDF files onto a folder in the LabShelf tree in the sidebar — not onto this panel.</div>');
      box.querySelector('button').addEventListener('click', function () {
        if (onlyNested) { includeSubBtn.click(); } else { post('addPaper'); }
      });
    }
    return box;
  }

  function render() {
    if (!view.folder) return;
    var toks = tokens(), scope = papersInScope();
    var papers = sortPapers(view.status === 'all' ? scope : scope.filter(function (p) { return p.status === view.status; }));

    renderHeader(papers.length, scope.length);
    renderStatusTabs(scope);
    renderSubStrip();
    includeSubBtn.classList.toggle('hidden', view.subfolders.length === 0);
    includeSubBtn.classList.toggle('active', view.includeSub);
    searchBox.classList.toggle('has-query', view.query.length > 0);
    colHeads.querySelectorAll('.sortable').forEach(function (h) {
      var on = h.dataset.sort === view.sortKey;
      h.classList.toggle('sorted', on);
      h.classList.toggle('asc', on && view.sortDir === 1);
    });

    var frag = document.createDocumentFragment();
    view.order = [];
    papers.forEach(function (p) { frag.appendChild(buildPaperRow(p, toks)); view.order.push(p.id); });
    if (papers.length === 0) frag.appendChild(emptyState(toks.length > 0 || view.status !== 'all'));

    var scroll = list.scrollTop;
    list.innerHTML = '';
    list.appendChild(frag);
    list.scrollTop = scroll;
    if (view.cursor && view.order.indexOf(view.cursor) === -1) view.cursor = null;
    applySelection();
    renderDetail();
  }

  // ── selection ─────────────────────────────────────────────────────────────
  function rowEl(id) {
    var rows = list.querySelectorAll('.paper-row');
    for (var i = 0; i < rows.length; i++) { if (rows[i].dataset.id === id) return rows[i]; }
    return null;
  }
  function applySelection(extraClass) {
    list.querySelectorAll('.paper-row').forEach(function (r) {
      var on = view.selected.has(r.dataset.id);
      r.classList.toggle('selected', on);
      r.classList.toggle('cursor', r.dataset.id === view.cursor);
      if (extraClass) r.classList.toggle(extraClass, on);
    });
  }
  function selectOnly(id) {
    view.selected = new Set([id]); view.anchor = id; view.cursor = id; view.abstractOpen = false;
    applySelection(); renderDetail();
  }
  function selectRange(toId) {
    var a = view.order.indexOf(view.anchor), b = view.order.indexOf(toId);
    if (a === -1 || b === -1) { selectOnly(toId); return; }
    view.selected = new Set(view.order.slice(Math.min(a, b), Math.max(a, b) + 1));
    view.cursor = toId;
    applySelection(); renderDetail();
  }
  function clickPaper(id, e) {
    if (e.shiftKey && view.anchor) { selectRange(id); return; }
    if (e.metaKey || e.ctrlKey) {
      if (view.selected.has(id)) view.selected.delete(id); else view.selected.add(id);
      view.anchor = id; view.cursor = id;
      applySelection(); renderDetail();
      return;
    }
    selectOnly(id);
  }
  function moveCursor(delta, extend) {
    if (!view.order.length) return;
    var idx = view.order.indexOf(view.cursor);
    idx = idx === -1 ? (delta > 0 ? 0 : view.order.length - 1) : Math.min(view.order.length - 1, Math.max(0, idx + delta));
    var id = view.order[idx];
    if (extend && view.anchor) selectRange(id); else selectOnly(id);
    var el = rowEl(id);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  // ── search + sort + toolbar ───────────────────────────────────────────────
  var searchTimer = null;
  function setQuery(q) {
    view.query = q;
    if (search.value !== q) search.value = q;
    render();
  }
  search.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { setQuery(search.value); }, 80);
  });
  $('searchClear').addEventListener('click', function () { setQuery(''); search.focus(); });
  colHeads.querySelectorAll('.sortable').forEach(function (h) {
    h.addEventListener('click', function () {
      if (view.sortKey === h.dataset.sort) view.sortDir = -view.sortDir;
      else { view.sortKey = h.dataset.sort; view.sortDir = 1; }
      saveState({ sortKey: view.sortKey, sortDir: view.sortDir });
      render();
    });
  });
  includeSubBtn.addEventListener('click', function () {
    view.includeSub = !view.includeSub;
    saveState({ includeSub: view.includeSub });
    render();
  });
  $('newFolderBtn').addEventListener('click', function () { post('newFolder'); });
  $('addPaperBtn').addEventListener('click', function () { post('addPaper'); });

  // ── keyboard ──────────────────────────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    var active = document.activeElement, mod = e.metaKey || e.ctrlKey;
    if (active === search) {
      if (e.key === 'Escape') { setQuery(''); list.focus(); e.preventDefault(); }
      else if (e.key === 'ArrowDown' || e.key === 'Enter') { list.focus(); if (!view.cursor) moveCursor(1); e.preventDefault(); }
      return;
    }
    if (active && active.tagName === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return;

    if (e.key === '/' || (mod && e.key === 'f')) { search.focus(); search.select(); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { moveCursor(1, e.shiftKey); e.preventDefault(); }
    else if (e.key === 'ArrowUp' && e.altKey) { goUp(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { moveCursor(-1, e.shiftKey); e.preventDefault(); }
    else if (e.key === 'Home') { view.cursor = null; moveCursor(1); e.preventDefault(); }
    else if (e.key === 'End') { view.cursor = null; moveCursor(-1); e.preventDefault(); }
    else if (e.key === 'Enter') { if (view.cursor) post('openPdf', { paperId: view.cursor }); e.preventDefault(); }
    else if (e.key === 'Escape' && (view.query || view.status !== 'all')) { view.status = 'all'; setQuery(''); }
    else if (mod && e.key === 'a') {
      view.selected = new Set(view.order); applySelection(); renderDetail(); e.preventDefault();
    }
    // Type-to-search: any printable key jumps into the search box and lands there.
    else if (e.key.length === 1 && !mod && !e.altKey) { search.focus(); }
  });

  // ── host state ────────────────────────────────────────────────────────────
  window.addEventListener('message', function (ev) {
    var m = ev.data;
    if (!m || m.type !== 'state') return;
    var folderChanged = !view.folder || view.folder.dirPath !== m.folder.dirPath;
    view.folder = m.folder; view.breadcrumb = m.breadcrumb; view.subfolders = m.subfolders;
    view.papers = m.papers.map(function (p) {
      p._hay = [p.title, (p.authors || []).join(' '), p.year, p.citeKey, p.journal, p.publisher, (p.keywords || []).join(' '), p.relFolder].join(' ').toLowerCase();
      return p;
    });

    if (folderChanged) {
      view.selected = new Set(); view.anchor = null; view.cursor = null; view.expanded = new Set();
      view.query = ''; search.value = ''; view.status = 'all';
      list.scrollTop = 0;
    } else {
      var alive = new Set(view.papers.map(function (p) { return p.id; }));
      view.selected.forEach(function (id) { if (!alive.has(id)) view.selected.delete(id); });
    }
    render();
    if (folderChanged && document.activeElement !== search) list.focus();
  });

${detailScriptFragment()}

  post('ready');
})();
</script>`;
}
