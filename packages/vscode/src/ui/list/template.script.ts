/**
 * Inline JavaScript for the list webview panel. The list shows papers only; subfolders live in a chip strip above it. Owns search (with field prefixes), status filters, sorting, selection, keyboard control, inline status changes, and paper drag-and-drop.
 *
 * The script body deliberately avoids template literals and backslashes so it can live inside a TypeScript template string without escaping.
 */
import { PAPER_STATUSES } from '@labshelf/core';
import { secIcon } from './template.icons.js';
import { menuScriptFragment } from './template.menu.script.js';
import { detailScriptFragment } from './template.detail.script.js';
import { detailTabsScriptFragment } from './template.detail.tabs.script.js';

const ICON_NAMES = [
  'chevron-down', 'chevron-right', 'file', 'folder', 'library', 'book', 'search', 'file-no-text', 'file-off', 'loader',
  'book-open', 'key', 'quote', 'folder-move', 'more', 'copy', 'external', 'highlighter', 'note', 'sparkle', 'trash',
  'refresh', 'download', 'link', 'check', 'users', 'tag', 'x',
] as const;

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
  const STATUSES = ${JSON.stringify(PAPER_STATUSES)};
  const STATUS_ORDER = { unread: 0, reading: 1, done: 2 };
  const STATUS_LABEL = { unread: 'Unread', reading: 'Reading', done: 'Done' };
  const NL = String.fromCharCode(10);
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  const MOD = IS_MAC ? '⌘' : 'Ctrl+';
  const ALT = IS_MAC ? '⌥' : 'Alt+';

  function $(id) { return document.getElementById(id); }
  const list = $('paperList'), crumbs = $('breadcrumb'), subStrip = $('subStrip'), statusFilters = $('statusFilters');
  const search = $('searchInput'), searchBox = search.parentElement;
  const includeSubBtn = $('includeSubBtn'), colHeads = $('colHeads');

  const saved = vscode.getState() || {};
  function saveState(patch) { vscode.setState(Object.assign({}, vscode.getState() || {}, patch)); }
  function post(command, payload) { vscode.postMessage(Object.assign({ command: command }, payload || {})); }

  const view = {
    folder: null, breadcrumb: [], subfolders: [], papers: [], library: [], stats: {},
    query: '', status: 'all',
    sortKey: saved.sortKey || 'title',
    sortDir: saved.sortDir === -1 ? -1 : 1,
    includeSub: saved.includeSub !== false,
    selected: new Set(), anchor: null, cursor: null, order: [],
    // Detail pane: collapsed sections, the open tab, the chosen citation style.
    secCollapsed: saved.secCollapsed || {},
    tab: saved.detailTab || 'details',
    citeFormat: saved.citeFormat || 'bibtex',
    abstractOpen: false, authorsOpen: false, annFilter: '', annColor: null,
    // Per-paper data fetched on demand: annotations, file, citations; AI-similar papers.
    extras: {}, extrasPending: {}, similar: {}, noteDraft: {},
    // A paper to select once the folder it lives in has loaded (jumps from Related).
    pendingSelect: null,
    // "No text" filter, and the papers waiting for or undergoing OCR (by id).
    noText: false, jobs: {},
  };

  // ── formatting ────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // "Family, Given" or "Given Family" → family name.
  function lastName(a) {
    a = String(a).trim();
    var c = a.indexOf(',');
    return c !== -1 ? a.slice(0, c).trim() : a.split(' ').pop();
  }
  function fmtCreator(authors) {
    if (!authors || authors.length === 0) return '';
    if (authors.length === 1) return lastName(authors[0]);
    return authors.length > 2 ? lastName(authors[0]) + ' et al.' : authors.map(lastName).join(' & ');
  }
  function fmtAgo(iso) {
    var t = iso ? Date.parse(iso) : NaN;
    if (isNaN(t)) return '';
    var s = (Date.now() - t) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    var d = Math.floor(s / 86400);
    if (d === 1) return 'yesterday';
    if (d < 7) return d + 'd ago';
    if (d < 30) return Math.floor(d / 7) + 'w ago';
    var dt = new Date(t), mon = dt.toLocaleString('en', { month: 'short' });
    return d < 365 ? mon + ' ' + dt.getDate() : mon + ' ' + dt.getFullYear();
  }
  function fmtDate(iso) {
    var t = iso ? Date.parse(iso) : NaN;
    return isNaN(t) ? '' : new Date(t).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' });
  }
  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return Math.round(bytes / 1024) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }
  function nextStatus(status) { return STATUSES[(STATUSES.indexOf(status) + 1) % STATUSES.length]; }
  function badgeHtml(status) {
    return '<button class="badge badge-' + esc(status) + '" data-cycle="1" title="Click to mark as ' + STATUS_LABEL[nextStatus(status)] + '">' + esc(STATUS_LABEL[status] || status) + '</button>';
  }
  function selIds() { return Array.from(view.selected); }

  // ── search ────────────────────────────────────────────────────────────────
  // Free words match anywhere; "field:word" (or "#tag") matches one field only.
  var FIELD_ALIASES = { author: 'authors', a: 'authors', year: 'year', y: 'year', tag: 'tags', t: 'tags', kw: 'keywords',
    keyword: 'keywords', venue: 'venue', journal: 'venue', note: 'note', key: 'citeKey', abstract: 'summary' };
  function parseQuery(q) {
    return q.toLowerCase().split(' ').filter(Boolean).map(function (raw) {
      var c = raw.indexOf(':');
      if (c > 0 && FIELD_ALIASES[raw.slice(0, c)]) return { field: FIELD_ALIASES[raw.slice(0, c)], text: raw.slice(c + 1) };
      if (raw.charAt(0) === '#' && raw.length > 1) return { field: 'tags', text: raw.slice(1) };
      return { field: null, text: raw };
    }).filter(function (t) { return t.text; });
  }
  function queryTokens() { return parseQuery(view.query); }
  function tokens() { return queryTokens().map(function (t) { return t.text; }); }
  function indexPaper(p) {
    var f = {
      title: p.title, authors: (p.authors || []).join(' '), year: p.year, tags: (p.tags || []).join(' '),
      keywords: (p.keywords || []).join(' '), venue: [p.journal, p.publisher].join(' '), note: p.note,
      summary: p.summary, citeKey: p.citeKey, folder: p.relFolder,
    };
    Object.keys(f).forEach(function (k) { f[k] = String(f[k] == null ? '' : f[k]).toLowerCase(); });
    p._f = f;
    p._hay = Object.keys(f).map(function (k) { return f[k]; }).join(' ');
    return p;
  }
  function matches(p, toks) {
    return toks.every(function (t) { return (t.field ? p._f[t.field] : p._hay).indexOf(t.text) !== -1; });
  }
  // When a row matched only through a field it does not show, say which.
  var HINT_FIELDS = [['authors', 'author'], ['keywords', 'keyword'], ['tags', 'tag'], ['summary', 'abstract'], ['note', 'note'], ['citeKey', 'cite key']];
  function matchHint(p, toks) {
    var visible = [p._f.title, fmtCreator(p.authors).toLowerCase(), p._f.year, p._f.venue, p._f.folder, p._f.tags].join(' ');
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t.field || visible.indexOf(t.text) !== -1) continue;
      for (var j = 0; j < HINT_FIELDS.length; j++) {
        if (p._f[HINT_FIELDS[j][0]].indexOf(t.text) !== -1) return '<span class="match-hint">in ' + HINT_FIELDS[j][1] + '</span>';
      }
    }
    return '';
  }

  // ── text layer ────────────────────────────────────────────────────────────
  // A paper was saved with a PDF unless the host says otherwise; undefined (an
  // older record) still counts as present.
  function hasPdf(p) { return p.hasPdf !== false; }
  // A paper "has no text" when its PDF is a scan nobody has read yet or OCR
  // failed on it: search and selection do not work, and it can be fixed. A
  // paper with no PDF cannot be "missing text" — there is nothing to search —
  // so it never counts here, which also clears the "No text" tab and banner.
  function hasNoText(p) {
    if (!hasPdf(p)) return false;
    var st = p.textLayer && p.textLayer.state;
    return st === 'missing' || st === 'failed';
  }
  function jobFor(p) { return view.jobs[p.id] || null; }
  function jobText(job) {
    return job.phase === 'reading'
      ? 'Making searchable — reading page ' + job.page + ' of ' + job.total + '…'
      : 'Waiting to be made searchable…';
  }
  // The leading icon of a row: the paper type, a spinner while OCR runs, or a
  // struck-through file when the PDF has no text to search.
  function typeIcon(p) {
    var job = jobFor(p);
    if (job) return { cls: 'tl-busy', html: '<span class="spin" style="display:flex">' + ICON['loader'] + '</span>', title: jobText(job) };
    if (!hasPdf(p)) {
      return { cls: 'no-pdf', html: ICON['file-off'], title: 'No PDF: this paper was saved without one.' };
    }
    if (hasNoText(p)) {
      return { cls: 'tl-missing', html: ICON['file-no-text'],
        title: 'No text layer: search (Ctrl+F) and text selection do not work in this PDF. Select the paper to make it searchable.' };
    }
    return { cls: '', html: ICON['file'], title: '' };
  }
  function typeIconCell(p) {
    var t = typeIcon(p);
    return '<div class="paper-type-icon ' + t.cls + '"' + (t.title ? ' title="' + esc(t.title) + '"' : '') + '>' + t.html + '</div>';
  }
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
    var toks = queryTokens();
    return view.papers.filter(function (p) {
      if (toks.length) return matches(p, toks);
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
      if (key === 'lastRead') return (view.stats[p.id] && view.stats[p.id].lastRead) || '';
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
  function libraryById(id) {
    for (var i = 0; i < view.library.length; i++) { if (view.library[i].id === id) return view.library[i]; }
    return null;
  }

  // ── navigation ────────────────────────────────────────────────────────────
  function navigate(dirPath) { flushNote(); post('navigate', { dirPath: dirPath }); }
  function goUp() {
    if (view.breadcrumb.length > 1) navigate(view.breadcrumb[view.breadcrumb.length - 2].dirPath);
  }
  // Shows a paper wherever it lives: clears filters that hide it here, or opens its folder first.
  function revealPaper(id) {
    var p = paperById(id);
    if (!p) {
      var lib = libraryById(id);
      if (lib) { view.pendingSelect = id; navigate(lib.folderPath); }
      return;
    }
    if (!papersInScope().some(function (q) { return q.id === id; }) || (view.status !== 'all' && p.status !== view.status) || (view.noText && !hasNoText(p))) {
      view.status = 'all'; view.noText = false; view.query = ''; search.value = '';
      if (p.relFolder !== '') view.includeSub = true;
      render();
    }
    selectOnly(id);
    var el = rowEl(id);
    if (el) el.scrollIntoView({ block: 'center' });
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
    var narrowed = tokens().length > 0 || view.status !== 'all' || view.noText;
    count.textContent = narrowed ? shown + ' / ' + view.papers.length : (scopeTotal ? String(scopeTotal) : '');
    crumbs.appendChild(count);
  }

  // Each filter counts what the other one lets through, so the numbers always
  // say what a click would show.
  function renderStatusTabs(scope) {
    var forStatus = view.noText ? scope.filter(hasNoText) : scope;
    var counts = { all: forStatus.length, unread: 0, reading: 0, done: 0 };
    forStatus.forEach(function (p) { if (counts[p.status] != null) counts[p.status]++; });
    statusFilters.innerHTML = '';
    ['all'].concat(STATUSES).forEach(function (key, i) {
      var b = document.createElement('button');
      b.className = 'status-tab' + (view.status === key ? ' active' : '');
      b.dataset.status = key;
      b.setAttribute('role', 'tab');
      if (key !== 'all') b.title = 'Show ' + STATUS_LABEL[key].toLowerCase() + ' papers. Mark the selection with ' + ALT + i;
      b.innerHTML = (key === 'all' ? '' : '<span class="status-dot s-' + key + '"></span>') +
        '<span>' + (key === 'all' ? 'All' : STATUS_LABEL[key]) + '</span><span class="n">' + counts[key] + '</span>';
      b.addEventListener('click', function () { view.status = key; render(); });
      statusFilters.appendChild(b);
    });

    // Shown only while some paper lacks text, so libraries without scans never see it.
    var noTextCount = (view.status === 'all' ? scope : scope.filter(function (p) { return p.status === view.status; })).filter(hasNoText).length;
    if (noTextCount > 0 || view.noText) {
      var t = document.createElement('button');
      t.className = 'status-tab tl-tab' + (view.noText ? ' active' : '');
      t.title = 'Papers whose PDF has no text layer: Ctrl+F and text selection do not work in them';
      t.innerHTML = ICON['file-no-text'] + '<span>No text</span><span class="n">' + noTextCount + '</span>';
      t.addEventListener('click', function () { view.noText = !view.noText; render(); });
      statusFilters.appendChild(t);
    }
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
  function buildPaperRow(p, toks, queryToks) {
    var row = document.createElement('div');
    row.className = 'paper-row';
    row.dataset.id = p.id;
    row.draggable = true;
    var st = view.stats[p.id] || {};
    var creator = fmtCreator(p.authors), venue = p.journal || p.publisher || '';
    var tags = p.tags || [];
    var tagHtml = tags.slice(0, 3).map(function (t) {
      return '<span class="row-tag" data-tag="' + esc(t) + '" title="Show papers tagged ' + esc(t) + '">' + hl(t, toks) + '</span>';
    }).join('') + (tags.length > 3 ? '<span class="row-tag more" title="' + esc(tags.slice(3).join(', ')) + '">+' + (tags.length - 3) + '</span>' : '');
    var chip = p.relFolder ? '<span class="loc-chip" title="Go to ' + esc(p.relFolder) + '">' + hl(p.relFolder, toks) + '</span>' : '';
    var marks = (st.annotations ? '<span class="row-mark" title="' + st.annotations + ' annotation' + (st.annotations === 1 ? '' : 's') + '">' + ICON['highlighter'] + st.annotations + '</span>' : '') +
      (p.note && p.note.trim() ? '<span class="row-mark" title="Has a note">' + ICON['note'] + '</span>' : '');
    var read = fmtAgo(st.lastRead);
    row.innerHTML =
      typeIconCell(p) +
      '<div class="col-title title-cell" title="' + esc(p.title) + '"><span class="title-text">' + hl(p.title, toks) + '</span>' +
        tagHtml + chip + matchHint(p, queryToks) + (marks ? '<span class="row-marks">' + marks + '</span>' : '') + '</div>' +
      '<div class="col-meta" title="' + esc((p.authors || []).join(', ')) + '">' + hl(creator, toks) + '</div>' +
      '<div class="col-meta">' + (p.year ? hl(p.year, toks) : '') + '</div>' +
      '<div class="col-meta col-pub" title="' + esc(venue) + '">' + hl(venue, toks) + '</div>' +
      '<div class="col-meta col-read"' + (st.lastRead ? ' title="Last read ' + esc(fmtDate(st.lastRead)) + (st.lastPage ? ', page ' + st.lastPage : '') + '"' : '') + '>' + esc(read) + '</div>' +
      '<div class="col-meta">' + badgeHtml(p.status) + '</div>';

    row.addEventListener('click', function (e) {
      var tag = e.target.closest('.row-tag');
      if (tag && tag.dataset.tag) { e.stopPropagation(); searchTag(tag.dataset.tag); return; }
      if (e.target.closest('.loc-chip')) { e.stopPropagation(); navigate(p.folderPath); return; }
      if (e.target.closest('[data-cycle]')) { e.stopPropagation(); setStatus([p.id], nextStatus(p.status)); return; }
      clickPaper(p.id, e);
    });
    row.addEventListener('dblclick', function (e) {
      if (e.target.closest('[data-cycle],.row-tag,.loc-chip')) return;
      post('openPdf', { paperId: p.id });
    });
    row.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      if (!view.selected.has(p.id)) selectOnly(p.id);
      openMenu(e.clientX, e.clientY, paperMenu(selIds()));
    });

    row.addEventListener('dragstart', function (e) {
      if (!view.selected.has(p.id)) { selectOnly(p.id); }
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify(selIds()));
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
  function searchTag(tag) {
    view.status = 'all';
    setQuery(String(tag).toLowerCase().split(' ').filter(Boolean).map(function (w) { return 'tag:' + w; }).join(' '));
  }

  function emptyState(narrowed) {
    var box = document.createElement('div');
    box.className = 'empty-state';
    if (narrowed) {
      // Reached after the last scan here was made searchable: say so plainly.
      var allSearchable = view.noText && !tokens().length && view.status === 'all';
      box.innerHTML = '<div class="empty-icon">' + ICON[allSearchable ? 'file' : 'search'] + '</div><div class="empty-text">' +
        (allSearchable ? 'No paper in ' + esc(view.folder.label) + ' is missing its text layer' : 'No papers match in ' + esc(view.folder.label)) + '</div>' +
        '<button class="list-add-btn" style="margin-top:8px">' + (allSearchable ? 'Show all papers' : 'Clear filters') + '</button>';
      box.querySelector('button').addEventListener('click', function () { view.status = 'all'; view.noText = false; setQuery(''); search.focus(); });
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
    var queryToks = queryTokens(), toks = tokens(), scope = papersInScope();
    var papers = sortPapers(scope.filter(function (p) {
      return (view.status === 'all' || p.status === view.status) && (!view.noText || hasNoText(p));
    }));
    var narrowed = toks.length > 0 || view.status !== 'all' || view.noText;

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
    papers.forEach(function (p) { frag.appendChild(buildPaperRow(p, toks, queryToks)); view.order.push(p.id); });
    if (papers.length === 0) frag.appendChild(emptyState(narrowed));

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
  function selectionChanged() {
    view.abstractOpen = false; view.authorsOpen = false; view.annFilter = ''; view.annColor = null;
  }
  function selectOnly(id) {
    flushNote();
    view.selected = new Set([id]); view.anchor = id; view.cursor = id;
    selectionChanged();
    applySelection(); renderDetail();
  }
  function selectRange(toId) {
    var a = view.order.indexOf(view.anchor), b = view.order.indexOf(toId);
    if (a === -1 || b === -1) { selectOnly(toId); return; }
    flushNote();
    view.selected = new Set(view.order.slice(Math.min(a, b), Math.max(a, b) + 1));
    view.cursor = toId;
    applySelection(); renderDetail();
  }
  function clickPaper(id, e) {
    if (e.shiftKey && view.anchor) { selectRange(id); return; }
    if (e.metaKey || e.ctrlKey) {
      flushNote();
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
      // Dates and years read best newest first.
      else { view.sortKey = h.dataset.sort; view.sortDir = (view.sortKey === 'lastRead' || view.sortKey === 'year') ? -1 : 1; }
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
    if (menuKeydown(e)) return;
    if (active === search) {
      if (e.key === 'Escape') { setQuery(''); list.focus(); e.preventDefault(); }
      else if (e.key === 'ArrowDown' || e.key === 'Enter') { list.focus(); if (!view.cursor) moveCursor(1); e.preventDefault(); }
      return;
    }
    // Tag, note and filter fields in the detail pane keep their keys.
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
    if (active && active.tagName === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return;
    var ids = selIds();

    if (e.key === '/' || (mod && e.key === 'f')) { search.focus(); search.select(); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { moveCursor(1, e.shiftKey); e.preventDefault(); }
    else if (e.key === 'ArrowUp' && e.altKey) { goUp(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { moveCursor(-1, e.shiftKey); e.preventDefault(); }
    else if (e.key === 'Home') { view.cursor = null; moveCursor(1); e.preventDefault(); }
    else if (e.key === 'End') { view.cursor = null; moveCursor(-1); e.preventDefault(); }
    else if (e.key === 'Enter') { if (view.cursor) post('openPdf', { paperId: view.cursor }); e.preventDefault(); }
    else if (e.key === 'Escape' && (view.query || view.status !== 'all' || view.noText)) { view.status = 'all'; view.noText = false; setQuery(''); }
    else if (mod && e.key === 'a') {
      view.selected = new Set(view.order); applySelection(); renderDetail(); e.preventDefault();
    }
    // Alt+1/2/3 mark the selection Unread/Reading/Done (by key position: Alt changes the character on a Mac).
    else if (e.altKey && !mod && /^Digit[123]$/.test(e.code)) {
      if (ids.length) setStatus(ids, STATUSES[Number(e.code.slice(5)) - 1]);
      e.preventDefault();
    }
    else if ((mod && e.key === 'Backspace') || e.key === 'Delete') {
      if (ids.length) post('deletePaper', { paperIds: ids });
      e.preventDefault();
    }
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      var row = view.cursor && rowEl(view.cursor);
      if (row && ids.length) { var r = row.getBoundingClientRect(); openMenu(r.left + 40, r.bottom, paperMenu(ids)); }
      e.preventDefault();
    }
    // Type-to-search: any printable key jumps into the search box and lands there.
    else if (e.key.length === 1 && !mod && !e.altKey) { search.focus(); }
  });
  // Copy with nothing selected as text copies the selected papers' cite keys,
  // ready for a citation command: key1,key2.
  document.addEventListener('copy', function (e) {
    var active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
    var sel = window.getSelection();
    if ((sel && String(sel).length) || view.selected.size === 0) return;
    e.preventDefault();
    post('copyCitation', { paperIds: selIds(), format: 'key' });
  });

  // ── host state ────────────────────────────────────────────────────────────
  // Job updates arrive every page; only the affected icons and the selected
  // paper's text-layer lines are patched, so hover, scroll and drag survive.
  function applyJobs(jobs) {
    var next = {};
    (jobs || []).forEach(function (j) { next[j.paperId] = j; });
    var changed = {};
    Object.keys(view.jobs).concat(Object.keys(next)).forEach(function (id) {
      if (JSON.stringify(view.jobs[id] || null) !== JSON.stringify(next[id] || null)) changed[id] = true;
    });
    view.jobs = next;
    list.querySelectorAll('.paper-row').forEach(function (row) {
      if (!changed[row.dataset.id]) return;
      var p = paperById(row.dataset.id), cell = row.querySelector('.paper-type-icon');
      if (p && cell) cell.outerHTML = typeIconCell(p);
    });
    if (selIds().some(function (id) { return changed[id]; })) refreshTextLayerDetail();
  }
  function renderTagOptions() {
    var seen = {}, names = [];
    view.library.forEach(function (p) {
      (p.tags || []).forEach(function (t) { var k = t.toLowerCase(); if (!seen[k]) { seen[k] = 1; names.push(t); } });
    });
    names.sort(function (a, b) { return a.localeCompare(b); });
    $('tagOptions').innerHTML = names.map(function (t) { return '<option value="' + esc(t) + '"></option>'; }).join('');
  }

  window.addEventListener('message', function (ev) {
    var m = ev.data;
    if (!m) return;
    if (m.type === 'jobs') { applyJobs(m.jobs); return; }
    if (m.type === 'extras') { receiveExtras(m); return; }
    if (m.type === 'similar') { view.similar[m.paperId] = m.items || []; if (view.tab === 'related' && selIds()[0] === m.paperId) renderDetail(); return; }
    if (m.type === 'sidecarChanged') { refreshExtras(); return; }
    if (m.type !== 'state') return;
    var folderChanged = !view.folder || view.folder.dirPath !== m.folder.dirPath;
    view.folder = m.folder; view.breadcrumb = m.breadcrumb; view.subfolders = m.subfolders;
    view.library = m.library || [];
    view.stats = m.stats || {};
    view.papers = m.papers.map(function (p) {
      // A note being typed wins over the copy the host echoes back.
      if (view.noteDraft[p.id] !== undefined) p.note = view.noteDraft[p.id];
      return indexPaper(p);
    });
    renderTagOptions();

    if (folderChanged) {
      view.selected = new Set(); view.anchor = null; view.cursor = null;
      view.query = ''; search.value = ''; view.status = 'all'; view.noText = false;
      list.scrollTop = 0;
    } else {
      var alive = new Set(view.papers.map(function (p) { return p.id; }));
      view.selected.forEach(function (id) { if (!alive.has(id)) view.selected.delete(id); });
    }
    refreshExtras(true);
    render();
    var pending = view.pendingSelect;
    view.pendingSelect = null;
    if (pending && paperById(pending)) { revealPaper(pending); list.focus(); }
    else if (folderChanged && document.activeElement !== search) list.focus();
  });

${menuScriptFragment()}
${detailScriptFragment()}
${detailTabsScriptFragment()}

  post('ready');
})();
</script>`;
}
