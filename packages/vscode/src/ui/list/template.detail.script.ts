/**
 * Detail-pane portion of the list webview script: the paper header (title, authors, actions, status, tags), the tab
 * bar (Details, Annotations, Notes, Related), the multi-selection summary, every click and key in the pane, and the
 * pane's collapse and resize behaviour. The tab bodies come from template.detail.tabs.script.ts.
 *
 * Returned as a source fragment that template.script.ts splices into its IIFE, so it shares that scope (view, ICON, STATUSES, STATUS_LABEL, NL, MOD, esc, post, saveState, selIds, navigate, setStatus, setQuery, searchTag, revealPaper, paperById, hasPdf, hasNoText, jobFor, jobText, typeIconCell, fmtAgo, lastName, list, render, openMenu, paperMenu).
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
  var TABS = [['details', 'Details'], ['annotations', 'Annotations'], ['notes', 'Notes'], ['related', 'Related']];

  function iconBtn(action, icon, title, attrs) {
    return '<button class="icon-btn" data-action="' + action + '" title="' + esc(title) + '"' + (attrs || '') + '>' + ICON[icon] + '</button>';
  }
  function muted(text) { return '<div class="muted">' + esc(text) + '</div>'; }
  // A collapsible block with a VS Code pane header. Open unless the user closed it (or opts.closed says so).
  function section(id, title, body, opts) {
    opts = opts || {};
    var closed = view.secCollapsed[id] !== undefined ? view.secCollapsed[id] : !!opts.closed;
    return '<div class="detail-section">' +
      '<div class="sec-head' + (closed ? ' collapsed' : '') + '" data-sec="' + id + '" role="button" tabindex="0" aria-expanded="' + !closed + '">' +
        '<div class="sec-head-left"><span class="sec-chevron">' + ICON['chevron-down'] + '</span><span class="sec-title">' + esc(title) + '</span>' +
        (opts.count ? '<span class="sec-count">' + opts.count + '</span>' : '') + '</div>' +
        (opts.actions ? '<div class="sec-actions">' + opts.actions + '</div>' : '') +
      '</div>' +
      '<div class="sec-body' + (closed ? ' hidden' : '') + '">' + body + '</div></div>';
  }
  function toggleSection(head) {
    var id = head.dataset.sec, closed = !head.classList.contains('collapsed');
    view.secCollapsed[id] = closed;
    saveState({ secCollapsed: view.secCollapsed });
    head.classList.toggle('collapsed', closed);
    head.setAttribute('aria-expanded', String(!closed));
    head.nextElementSibling.classList.toggle('hidden', closed);
  }

  function statusSeg(current) {
    return '<div class="status-seg" role="radiogroup" aria-label="Reading status">' + STATUSES.map(function (st, i) {
      return '<button class="' + (current === st ? 'on' : '') + '" role="radio" aria-checked="' + (current === st) + '" data-action="setStatus" data-status="' + st + '" title="Mark as ' + STATUS_LABEL[st] + ' (' + ALT + (i + 1) + ')">' +
        '<span class="status-dot s-' + st + '"></span>' + STATUS_LABEL[st] + '</button>';
    }).join('') + '</div>';
  }
  function tagRow(tags) {
    return '<div class="tag-row">' + tags.map(function (t) {
      return '<span class="tag-chip"><button class="tag-name" data-action="searchTag" data-tag="' + esc(t) + '" title="Show papers tagged ' + esc(t) + '">' + esc(t) + '</button>' +
        '<button class="tag-x" data-action="removeTag" data-tag="' + esc(t) + '" title="Remove tag" aria-label="Remove tag ' + esc(t) + '">' + ICON['x'] + '</button></span>';
    }).join('') +
      '<input id="tagInput" class="tag-input" list="tagOptions" placeholder="' + (tags.length ? '+ Tag' : '+ Add tag') + '" title="Type a tag and press Enter; commas add several" spellcheck="false" autocomplete="off"/></div>';
  }
  function focusTagInput() {
    if (document.body.classList.contains('detail-collapsed')) { document.body.classList.remove('detail-collapsed'); saveState({ detailCollapsed: false }); }
    var input = $('tagInput');
    if (input) { input.scrollIntoView({ block: 'nearest' }); input.focus(); }
  }
  function commonTags(ids) {
    var first = (paperById(ids[0]) || {}).tags || [];
    return first.filter(function (t) {
      return ids.every(function (id) { var p = paperById(id); return p && (p.tags || []).some(function (x) { return x.toLowerCase() === t.toLowerCase(); }); });
    });
  }
  // Applied locally first; the host writes metadata.yaml and confirms with a fresh state.
  function changeTags(ids, add, remove) {
    var drop = remove.map(function (t) { return t.toLowerCase(); });
    ids.forEach(function (id) {
      var p = paperById(id);
      if (!p) return;
      var next = (p.tags || []).filter(function (t) { return drop.indexOf(t.toLowerCase()) === -1; });
      add.forEach(function (t) { if (!next.some(function (x) { return x.toLowerCase() === t.toLowerCase(); })) next.push(t); });
      p.tags = next;
      indexPaper(p);
    });
    post('setTags', { paperIds: ids, add: add, remove: remove });
    render();
  }

  // ── text layer ────────────────────────────────────────────────────────────
  function textLayerSummary(p) {
    var job = jobFor(p), tl = p.textLayer;
    if (job) return jobText(job);
    if (!hasPdf(p)) return 'No PDF';
    if (!tl) return 'Not checked yet';
    if (tl.state === 'native') return 'Embedded in the PDF';
    if (tl.state === 'ocr') {
      return 'Added by OCR' + (tl.ocrPages ? ' · ' + tl.ocrPages + ' page' + (tl.ocrPages === 1 ? '' : 's') : '') +
        (tl.failedPages ? ', ' + tl.failedPages + ' unreadable' : '');
    }
    return tl.state === 'failed' ? 'None (OCR failed)' : 'None';
  }
  // The pane's call to action for a paper that cannot be searched, or the
  // progress of the OCR running on it. Empty but present otherwise, so live
  // updates can replace it in place.
  function textLayerBanner(p) {
    var job = jobFor(p), tl = p.textLayer;
    if (job) {
      // Pages already read, out of all the pages to read.
      var done = job.phase === 'reading' && job.total ? Math.round(100 * (job.page - 1) / job.total) : 0;
      return '<div id="tlBanner" class="tl-banner busy"><span class="tl-icon spin">' + ICON['loader'] + '</span><div class="tl-text">' + esc(jobText(job)) +
        (job.phase === 'reading' ? '<div class="tl-progress"><span style="width:' + done + '%"></span></div>' : '') + '</div></div>';
    }
    if (!hasNoText(p)) return '<div id="tlBanner"></div>';
    var failed = tl.state === 'failed';
    return '<div id="tlBanner" class="tl-banner"><span class="tl-icon">' + ICON['file-no-text'] + '</span><div class="tl-text">' +
      (failed ? 'LabShelf could not add a text layer to this PDF.' : 'No text layer: Ctrl+F and text selection do not work in this PDF.') +
      (tl.reason ? '<div class="tl-reason">' + esc(tl.reason) + '</div>' : '') +
      '<button class="action-btn primary tl-action" data-action="makeSearchable">' + (failed ? 'Try again' : 'Make searchable') + '</button></div></div>';
  }
  // Papers among the selection that OCR could fix and that are not already queued.
  function fixable(ids) {
    return ids.filter(function (id) { var p = paperById(id); return p && hasNoText(p) && !jobFor(p); });
  }
  function selectionBanner(ids) {
    var busy = ids.filter(function (id) { var p = paperById(id); return p && jobFor(p); }).length;
    var todo = fixable(ids).length;
    if (!todo && !busy) return '<div id="tlBanner"></div>';
    if (!todo) {
      return '<div id="tlBanner" class="tl-banner busy"><span class="tl-icon spin">' + ICON['loader'] + '</span><div class="tl-text">' +
        busy + ' of these papers ' + (busy === 1 ? 'is' : 'are') + ' being made searchable…</div></div>';
    }
    return '<div id="tlBanner" class="tl-banner"><span class="tl-icon">' + ICON['file-no-text'] + '</span><div class="tl-text">' +
      todo + ' of these papers ' + (todo === 1 ? 'has' : 'have') + ' no text layer.' +
      '<button class="action-btn primary tl-action" data-action="makeSearchable">Make searchable</button></div></div>';
  }
  // Patches the banner and the File line in place when a job advances.
  function refreshTextLayerDetail() {
    var ids = selIds(), old = $('tlBanner');
    if (!old) return;
    var html = ids.length > 1 ? selectionBanner(ids) : (paperById(ids[0]) ? textLayerBanner(paperById(ids[0])) : '');
    if (!html) return;
    var holder = document.createElement('div');
    holder.innerHTML = html;
    old.replaceWith(holder.firstChild);
    var line = $('tlField');
    if (line && ids.length === 1) line.textContent = textLayerSummary(paperById(ids[0]));
  }
  // Shown as queued at once; the host confirms with a jobs message.
  function requestTextLayers(ids) {
    if (!ids.length) return;
    ids.forEach(function (id) { if (!view.jobs[id]) view.jobs[id] = { paperId: id, phase: 'queued' }; });
    post('makeSearchable', { paperIds: ids });
    list.querySelectorAll('.paper-row').forEach(function (row) {
      var p = ids.indexOf(row.dataset.id) !== -1 ? paperById(row.dataset.id) : null;
      var cell = p && row.querySelector('.paper-type-icon');
      if (cell) cell.outerHTML = typeIconCell(p);
    });
    refreshTextLayerDetail();
  }

  // ── header ────────────────────────────────────────────────────────────────
  // Who wrote it, where it appeared, and the actions you reach for most; the rest lives in the tabs.
  function paperHeadHtml(p) {
    var st = view.stats[p.id] || {};
    var authors = p.authors || [];
    var shown = view.authorsOpen || authors.length <= 5 ? authors : authors.slice(0, 3);
    var byline = shown.map(function (a) {
      return '<button class="link-btn" data-action="searchAuthor" data-q="' + esc(lastName(a)) + '" title="Show papers by ' + esc(a) + '">' + esc(a) + '</button>';
    }).join(', ') + (authors.length > shown.length
      ? ' <button class="link-btn more" data-action="toggleAuthors">+' + (authors.length - shown.length) + ' more</button>'
      : (view.authorsOpen && authors.length > 5 ? ' <button class="link-btn more" data-action="toggleAuthors">less</button>' : ''));
    var meta = [];
    if (p.journal || p.publisher) meta.push('<span class="venue">' + esc(p.journal || p.publisher) + '</span>');
    if (p.year) meta.push(esc(p.year));
    if (p.volume) meta.push('vol. ' + esc(p.volume) + (p.issue ? ' (' + esc(p.issue) + ')' : ''));
    if (p.pages) meta.push('pp. ' + esc(p.pages));
    var open = hasPdf(p)
      ? '<button class="action-btn primary open-btn" data-action="openPdf" title="Open in the reader (Enter)' + (st.lastPage > 1 ? ' — it reopens where you left off' : '') + '">' + ICON['book-open'] +
        '<span>' + (st.lastPage > 1 ? 'Continue · p. ' + st.lastPage : 'Open PDF') + '</span></button>'
      : '<button class="action-btn open-btn" disabled title="This paper has no PDF">' + ICON['file-off'] + '<span>No PDF</span></button>';
    return '<div class="detail-head">' +
      '<div class="detail-title" title="' + esc(p.title) + '">' + esc(p.title) + '</div>' +
      (authors.length ? '<div class="detail-byline">' + byline + '</div>' : '') +
      (meta.length ? '<div class="detail-meta">' + meta.join('<span class="dot-sep">·</span>') + '</div>' : '') +
      '<div class="detail-toolbar">' + open + '<span class="tb-spacer"></span>' +
        iconBtn('copyKey', 'key', 'Copy cite key ' + p.citeKey + ' (' + MOD + 'C)') +
        iconBtn('copyCite', 'quote', 'Copy citation as ' + citeLabel(view.citeFormat) + ' — pick the style under Cite') +
        iconBtn('move', 'folder-move', 'Move to folder…') +
        iconBtn('more', 'more', 'More actions') +
      '</div>' +
      statusSeg(p.status) + tagRow(p.tags || []) + textLayerBanner(p) +
    '</div>';
  }

  function tabBar(p) {
    var ex = view.extras[p.id], st = view.stats[p.id] || {};
    var ann = ex ? ex.annotations.length : (st.annotations || 0);
    var hasNote = !!(noteText(p) || '').trim();
    var rel = relatedGroups(p).total;
    var badge = { annotations: ann ? String(ann) : '', notes: hasNote ? '•' : '', related: rel ? String(rel) : '' };
    return '<div class="detail-tabs" role="tablist">' + TABS.map(function (t) {
      return '<button class="detail-tab' + (view.tab === t[0] ? ' active' : '') + '" id="tab-' + t[0] + '" role="tab" aria-selected="' + (view.tab === t[0]) + '" data-action="tab" data-tab="' + t[0] + '">' +
        esc(t[1]) + (badge[t[0]] ? '<span class="tab-badge' + (t[0] === 'notes' ? ' dot' : '') + '">' + badge[t[0]] + '</span>' : '') + '</button>';
    }).join('') + '</div>';
  }

  function paperDetailHtml(p) {
    var body = view.tab === 'annotations' ? annotationsTab(p)
      : view.tab === 'notes' ? notesTab(p)
      : view.tab === 'related' ? relatedTab(p)
      : detailsTab(p);
    return paperHeadHtml(p) + tabBar(p) + '<div class="tab-body" id="tabBody">' + body + '</div>';
  }

  function selectionHtml(ids) {
    var papers = ids.map(paperById).filter(Boolean);
    var statuses = papers.map(function (p) { return p.status; });
    var same = statuses.every(function (s) { return s === statuses[0]; }) ? statuses[0] : null;
    return '<div class="detail-head">' +
      '<div class="detail-title">' + ids.length + ' papers selected</div>' +
      '<div class="detail-byline muted-text">Drag them onto a subfolder chip or a path segment, or use the actions below.</div>' +
      '<div class="detail-toolbar"><button class="action-btn primary" data-action="move">' + ICON['folder-move'] + '<span>Move to…</span></button><span class="tb-spacer"></span>' +
        iconBtn('copyKey', 'key', 'Copy all cite keys (' + MOD + 'C)') +
        iconBtn('copyCite', 'quote', 'Copy all as ' + citeLabel(view.citeFormat)) +
        iconBtn('more', 'more', 'More actions') +
      '</div>' + statusSeg(same) + tagRow(commonTags(ids)) + selectionBanner(ids) +
    '</div>' +
    '<div class="sel-list">' + papers.map(function (p) {
      return '<div class="rel-row" data-action="selectOnly" data-id="' + esc(p.id) + '" title="Show only this paper"><span class="status-dot s-' + p.status + '"></span>' +
        '<div class="rel-main"><div class="rel-title">' + esc(p.title) + '</div><div class="rel-sub">' + esc([fmtCreator(p.authors), p.year].filter(Boolean).join(' · ')) + '</div></div></div>';
    }).join('') + '</div>';
  }

  // Rebuilt on every selection or state change; scroll, focus and the caret in a field survive it,
  // and a note being typed is never rebuilt under the cursor.
  function renderDetail() {
    var ids = selIds(), key = ids.join(',');
    var active = document.activeElement;
    var keep = active && detail.contains(active) && active.id ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null;
    if (keep && keep.id === 'noteInput' && detail.dataset.key === key) { view.detailStale = true; return; }
    view.detailStale = false;
    var sameKey = detail.dataset.key === key, scroll = detail.scrollTop;
    detail.dataset.key = key;

    if (ids.length === 0) {
      detail.innerHTML = '<div class="detail-placeholder"><div class="empty-icon">' + ICON['book'] + '</div>Select a paper to see its details, annotations, notes and related papers.' +
        '<div class="kbd-help"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>/</kbd> search</span><span><kbd>' + MOD + 'C</kbd> copy key</span><span><kbd>' + ALT + '1–3</kbd> status</span></div></div>';
      return;
    }
    if (ids.length > 1) {
      detail.innerHTML = selectionHtml(ids);
    } else {
      var p = paperById(ids[0]);
      if (!p) { detail.innerHTML = ''; return; }
      ensureExtras(p.id);
      if (view.tab === 'related') ensureSimilar(p.id);
      detail.innerHTML = paperDetailHtml(p);
    }
    detail.scrollTop = sameKey ? scroll : 0;
    if (keep) {
      var el = $(keep.id);
      if (el) {
        el.focus();
        try { if (keep.start != null) el.setSelectionRange(keep.start, keep.end); } catch (err) { /* not a text field */ }
      }
    }
  }

  // ── per-paper data from the host ──────────────────────────────────────────
  function ensureExtras(id) {
    if (view.extras[id] || view.extrasPending[id]) return;
    view.extrasPending[id] = true;
    post('paperExtras', { paperId: id });
  }
  // The record or its sidecar changed: re-ask for the shown paper while still showing what it had.
  function refreshExtras() {
    var ids = selIds(), id = ids.length === 1 ? ids[0] : null, kept = {};
    if (id && view.extras[id]) kept[id] = view.extras[id];
    view.extras = kept; view.extrasPending = {};
    if (id) { view.extrasPending[id] = true; post('paperExtras', { paperId: id }); }
  }
  function receiveExtras(m) {
    delete view.extrasPending[m.paperId];
    view.extras[m.paperId] = m;
    var ids = selIds();
    if (ids.length === 1 && ids[0] === m.paperId) renderDetail();
  }
  function ensureSimilar(id) {
    if (view.similar[id] !== undefined) return;
    view.similar[id] = null;
    post('findSimilar', { paperId: id });
  }

  // ── clicks and keys ───────────────────────────────────────────────────────
  detail.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (el && detail.contains(el) && !el.disabled) { e.preventDefault(); e.stopPropagation(); detailAction(el); return; }
    var head = e.target.closest('.sec-head');
    if (head) toggleSection(head);
  });
  detail.addEventListener('dblclick', function (e) {
    var card = e.target.closest('.rel-row[data-id]');
    if (card && !e.target.closest('.icon-btn')) post('openPdf', { paperId: card.dataset.id });
  });

  function detailAction(el) {
    var a = el.dataset.action, ids = selIds(), id = ids[0], p = paperById(id);
    switch (a) {
      case 'openPdf': post('openPdf', Object.assign({ paperId: el.dataset.id || id }, el.dataset.page ? { page: Number(el.dataset.page) } : {})); return;
      case 'openPdfExternal': case 'openFolder': case 'fetchMetadata': case 'exportAnnotations': post(a, { paperId: id }); return;
      case 'copyKey': post('copyCitation', { paperIds: ids, format: 'key' }); return;
      case 'copyCite': post('copyCitation', { paperIds: ids, format: el.dataset.format || view.citeFormat }); return;
      case 'citeFormat': view.citeFormat = el.dataset.format; saveState({ citeFormat: view.citeFormat }); renderDetail(); return;
      case 'copyField': post('copyText', { text: el.dataset.text, label: el.dataset.label }); return;
      case 'copyAbstract': if (p && p.summary) post('copyText', { text: p.summary, label: 'abstract' }); return;
      case 'openLink': post('openExternal', { url: el.dataset.url }); return;
      case 'move': post('pickMoveTarget', { paperIds: ids }); return;
      case 'more': { var r = el.getBoundingClientRect(); openMenu(r.left, r.bottom + 2, paperMenu(ids)); return; }
      case 'setStatus': setStatus(ids, el.dataset.status); return;
      case 'goFolder': if (p) navigate(p.folderPath); return;
      case 'toggleAbstract': view.abstractOpen = !view.abstractOpen; renderDetail(); return;
      case 'toggleAuthors': view.authorsOpen = !view.authorsOpen; renderDetail(); return;
      case 'searchAuthor': view.status = 'all'; setQuery('author:' + el.dataset.q.toLowerCase().split(' ').join(' author:')); return;
      case 'searchKeyword': view.status = 'all'; setQuery(el.dataset.keyword.toLowerCase()); return;
      case 'searchTag': searchTag(el.dataset.tag); return;
      case 'removeTag': changeTags(ids, [], [el.dataset.tag]); return;
      case 'tab':
        view.tab = el.dataset.tab; saveState({ detailTab: view.tab });
        renderDetail();
        // Deep in a long tab, switching lands at the top of the new one, under the sticky tab bar.
        var bar = detail.querySelector('.detail-tabs');
        if (bar) detail.scrollTop = Math.min(detail.scrollTop, bar.offsetTop);
        return;
      case 'openRelated': revealPaper(el.dataset.id); return;
      case 'selectOnly': selectOnly(el.dataset.id); return;
      case 'makeSearchable': requestTextLayers(fixable(ids)); return;
      case 'deletePaper': post('deletePaper', { paperIds: ids }); return;
      default: tabAction(a, el, p);
    }
  }

  detail.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t.classList && t.classList.contains('sec-head') && (e.key === 'Enter' || e.key === ' ')) { toggleSection(t); e.preventDefault(); return; }
    if (t.id === 'tagInput') {
      if (e.key === 'Enter') {
        var add = t.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        t.value = '';
        if (add.length) changeTags(selIds(), add, []);
        e.preventDefault();
      } else if (e.key === 'Escape') { t.value = ''; list.focus(); e.preventDefault(); }
      else if (e.key === 'Backspace' && !t.value) {
        // Backspace in an empty tag field takes back the last tag, as chip inputs do.
        var p = paperById(selIds()[0]), tags = selIds().length === 1 && p ? (p.tags || []) : [];
        if (tags.length) { changeTags(selIds(), [], [tags[tags.length - 1]]); e.preventDefault(); }
      }
      return;
    }
    if (t.id === 'noteInput' && e.key === 'Escape') { flushNote(); list.focus(); e.preventDefault(); return; }
    if (t.id === 'annFilter' && e.key === 'Escape') { view.annFilter = ''; t.value = ''; updateAnnList(); list.focus(); e.preventDefault(); }
  });
  detail.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id === 'noteInput') noteChanged(selIds()[0], t.value);
    else if (t.id === 'annFilter') { view.annFilter = t.value; updateAnnList(); }
  });
  // Renders skipped while the note had focus catch up once it loses it. Never between a press and its
  // click: replacing the pressed button there would swallow the click.
  var pointerDown = false;
  function catchUpDetail() {
    if (view.detailStale && !(document.activeElement && document.activeElement.id === 'noteInput')) renderDetail();
  }
  document.addEventListener('mousedown', function () { pointerDown = true; }, true);
  document.addEventListener('mouseup', function () { pointerDown = false; setTimeout(catchUpDetail, 0); }, true);
  detail.addEventListener('focusout', function (e) {
    if (e.target.id !== 'noteInput') return;
    flushNote();
    if (!pointerDown) setTimeout(catchUpDetail, 0);
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) flushNote(); });

  // ── detail pane: collapse + resize ─────────────────────────────────────────
  const detailResizer = $('detailResizer');
  const MIN_W = 260, MAX_W = 760, COLLAPSE_AT = 180;
  if (saved.detailWidth) { detail.style.width = Math.max(MIN_W, saved.detailWidth) + 'px'; }
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
  // Double-clicking the edge restores the default width.
  detailResizer.addEventListener('dblclick', function () {
    detail.style.width = ''; document.body.classList.remove('detail-collapsed');
    saveState({ detailWidth: 0, detailCollapsed: false });
  });
`;
}
