/**
 * Tab bodies of the list webview's detail pane: Details (abstract, keywords, info, cite, file), Annotations (jump to
 * page, filter, copy as quotes), Notes (the paper's own note, autosaved) and Related (same authors, shared tags or
 * keywords, same venue, and similar content when the AI index runs).
 *
 * Returned as a source fragment that template.script.ts splices into its IIFE, so it shares that scope with the list
 * and detail fragments (view, ICON, NL, esc, post, selIds, paperById, libraryById, hasPdf, fmtCreator, fmtAgo, fmtDate,
 * fmtSize, lastName, section, muted, iconBtn, textLayerSummary, renderDetail).
 */

import { ANNOTATION_COLORS, PDF_FILE } from '@labshelf/core';

/**
 * Returns the tab-body JavaScript source. Like its host script it avoids template literals and backslashes.
 * @returns JavaScript source text, without a surrounding script tag
 */
export function detailTabsScriptFragment(): string {
  return `
  // ── Details tab ───────────────────────────────────────────────────────────
  var CITE_FORMATS = [['bibtex', 'BibTeX'], ['apa', 'APA'], ['mla', 'MLA'], ['chicago', 'Chicago'], ['inText', 'In-text']];
  function citeLabel(fmt) {
    for (var i = 0; i < CITE_FORMATS.length; i++) { if (CITE_FORMATS[i][0] === fmt) return CITE_FORMATS[i][1]; }
    return 'BibTeX';
  }
  function loading(text) { return '<div class="muted loading"><span class="spin">' + ICON['loader'] + '</span>' + esc(text || 'Loading…') + '</div>'; }
  function kv(label, valueHtml) { return '<div class="kv-label">' + esc(label) + '</div><div class="kv-value">' + valueHtml + '</div>'; }
  function copyBtn(text, label) {
    return iconBtn('copyField', 'copy', 'Copy ' + label, ' data-text="' + esc(text) + '" data-label="' + esc(label) + '"');
  }

  function abstractBody(p) {
    if (!p.summary) return muted('No abstract. Fetch Metadata Online (in ⋯) can often find one.');
    var long = p.summary.length > 420;
    return '<div class="detail-abstract' + (long && !view.abstractOpen ? ' clamped' : '') + '">' + esc(p.summary) + '</div>' +
      (long ? '<button class="link-btn more-link" data-action="toggleAbstract">' + (view.abstractOpen ? 'Show less' : 'Show more') + '</button>' : '');
  }
  function keywordsBody(p) {
    return '<div class="kw-list">' + p.keywords.map(function (k) {
      return '<button class="kw" data-action="searchKeyword" data-keyword="' + esc(k) + '" title="Find papers with this keyword">' + esc(k) + '</button>';
    }).join('') + '</div>';
  }
  function infoBody(p) {
    var html = '';
    if (p.journal) html += kv('Publication', esc(p.journal));
    if (p.publisher && p.publisher !== p.journal) html += kv('Publisher', esc(p.publisher));
    if (p.year) html += kv('Year', esc(p.year));
    if (p.volume || p.issue) html += kv('Volume', esc([p.volume, p.issue ? '(' + p.issue + ')' : ''].filter(Boolean).join(' ')));
    if (p.pages) html += kv('Pages', esc(p.pages));
    if (p.doi) {
      html += kv('DOI', '<span class="kv-line"><button class="link-btn mono" data-action="openLink" data-url="https://doi.org/' + esc(p.doi) + '" title="Open doi.org/' + esc(p.doi) + '">' + esc(p.doi) + '</button>' + copyBtn(p.doi, 'DOI') + '</span>');
    }
    if (p.url && !(p.doi && p.url.indexOf(p.doi) !== -1)) {
      html += kv('URL', '<span class="kv-line"><button class="link-btn url" data-action="openLink" data-url="' + esc(p.url) + '" title="' + esc(p.url) + '">' + esc(p.url.replace(/^https?:[/][/](www[.])?/, '')) + '</button>' + copyBtn(p.url, 'URL') + '</span>');
    }
    if (p.issn) html += kv('ISSN', esc(p.issn));
    if (p.language) html += kv('Language', esc(p.language));
    html += kv('Cite key', '<span class="kv-line"><span class="mono">' + esc(p.citeKey) + '</span>' + copyBtn(p.citeKey, 'cite key') + '</span>');
    html += kv('Folder', '<button class="link-btn" data-action="goFolder" title="Open this folder">' + ICON['folder'] + esc(p.relFolder || view.folder.label) + '</button>');
    return '<div class="kv-grid">' + html + '</div>';
  }
  function citeBody(p) {
    var ex = view.extras[p.id], fmt = view.citeFormat;
    var text = ex ? (fmt === 'bibtex' ? ex.bibtex : ex.cite[fmt]) : null;
    return '<div class="seg-tabs" role="tablist">' + CITE_FORMATS.map(function (f) {
      return '<button class="seg-tab' + (fmt === f[0] ? ' on' : '') + '" role="tab" aria-selected="' + (fmt === f[0]) + '" data-action="citeFormat" data-format="' + f[0] + '">' + f[1] + '</button>';
    }).join('') + '</div>' +
      (text == null ? loading() : '<pre class="cite-box' + (fmt === 'bibtex' ? ' code' : '') + '">' + esc(text) + '</pre>') +
      '<div class="row-end"><button class="action-btn" data-action="copyCite" data-format="' + fmt + '">' + ICON['copy'] + '<span>Copy ' + citeLabel(fmt) + '</span></button></div>';
  }
  function fileBody(p) {
    if (!hasPdf(p)) return muted('No PDF attached — this paper was saved without one.');
    var ex = view.extras[p.id], st = view.stats[p.id] || {};
    var pdf = ex && ex.pdf;
    var html = kv('PDF', pdf
      ? '<span class="kv-line"><button class="link-btn" data-action="openPdf" title="' + esc(pdf.relPath) + '">${PDF_FILE}</button><span class="muted-text">' + fmtSize(pdf.size) + '</span>' +
        iconBtn('openPdfExternal', 'external', 'Open in the default PDF app') + iconBtn('openFolder', 'folder', 'Reveal in Explorer') + '</span>'
      : (ex ? '<span class="muted-text">Not on this device yet</span>' : '…'));
    html += kv('Text', '<span id="tlField">' + esc(textLayerSummary(p)) + '</span>');
    html += kv('Last read', st.lastRead
      ? '<span title="' + esc(fmtDate(st.lastRead)) + '">' + esc(fmtAgo(st.lastRead)) + (st.lastPage ? ' · page ' + st.lastPage : '') + '</span>'
      : '<span class="muted-text">Never opened</span>');
    return '<div class="kv-grid">' + html + '</div>';
  }
  function detailsTab(p) {
    var kwCount = (p.keywords || []).length;
    return section('abstract', 'Abstract', abstractBody(p), { actions: p.summary ? iconBtn('copyAbstract', 'copy', 'Copy abstract') : '' }) +
      (kwCount ? section('keywords', 'Keywords', keywordsBody(p), { count: kwCount }) : '') +
      section('info', 'Info', infoBody(p)) +
      section('cite', 'Cite', citeBody(p)) +
      section('file', 'File', fileBody(p));
  }

  // ── Annotations tab ───────────────────────────────────────────────────────
  var ANN_COLORS = ${JSON.stringify(ANNOTATION_COLORS)};
  function annText(a) { return String(a.content || '').trim(); }
  function filteredAnnotations(all) {
    var f = view.annFilter.toLowerCase(), c = view.annColor;
    return all.filter(function (a) { return (!c || a.color === c) && (!f || annText(a).toLowerCase().indexOf(f) !== -1); });
  }
  function annCard(a) {
    var isNote = a.type !== 'highlight';
    return '<div class="ann-card' + (a.color ? ' c-' + a.color : '') + (isNote ? ' is-note' : '') + '" data-action="openPdf" data-page="' + a.page + '" title="Open at page ' + a.page + '">' +
      (isNote ? '<span class="ann-kind">' + ICON['note'] + '</span>' : '') +
      '<div class="ann-text">' + esc(annText(a)) + '</div>' +
      '<div class="ann-meta"><span>p. ' + a.page + '</span><span class="muted-text">' + esc(fmtAgo(a.createdAt)) + '</span><span class="tb-spacer"></span>' +
        iconBtn('copyAnnotation', 'copy', 'Copy as a quote with its citation', ' data-id="' + esc(a.id) + '"') + '</div></div>';
  }
  function annListHtml(all) {
    var shown = filteredAnnotations(all);
    if (!shown.length) return muted('No annotation matches.');
    var html = '', page = null;
    shown.forEach(function (a) {
      if (a.page !== page) { page = a.page; html += '<div class="ann-page">Page ' + page + '</div>'; }
      html += annCard(a);
    });
    return html;
  }
  function updateAnnList() {
    var p = paperById(selIds()[0]), ex = p && view.extras[p.id], el = $('annList');
    if (el && ex) el.innerHTML = annListHtml(ex.annotations);
    document.querySelectorAll('.ann-color').forEach(function (b) { b.classList.toggle('on', b.dataset.color === view.annColor); });
  }
  function annotationsTab(p) {
    var ex = view.extras[p.id];
    if (!ex) return loading('Loading annotations…');
    var all = ex.annotations;
    if (!all.length) {
      return '<div class="tab-empty">' + ICON['highlighter'] + '<div>No annotations yet.</div><div class="muted-text">Highlights and notes you make in the reader appear here, by page.</div>' +
        (hasPdf(p) ? '<button class="action-btn primary" data-action="openPdf">' + ICON['book-open'] + '<span>Open PDF</span></button>' : '') + '</div>';
    }
    var colors = ANN_COLORS.filter(function (c) { return all.some(function (a) { return a.color === c; }); });
    return '<div class="tab-toolbar">' +
      (all.length > 4 ? '<input id="annFilter" class="mini-input" placeholder="Filter ' + all.length + ' annotations" value="' + esc(view.annFilter) + '" spellcheck="false"/>' : '<span class="muted-text">' + all.length + ' annotation' + (all.length === 1 ? '' : 's') + '</span><span class="tb-spacer"></span>') +
      (colors.length > 1 ? colors.map(function (c) {
        return '<button class="ann-color c-' + c + (view.annColor === c ? ' on' : '') + '" data-action="annColor" data-color="' + c + '" title="Only ' + c + ' highlights"></button>';
      }).join('') : '') +
      iconBtn('copyAnnotations', 'copy', 'Copy these as Markdown') + iconBtn('exportAnnotations', 'download', 'Export to a Markdown file…') +
      '</div><div id="annList" class="ann-list">' + annListHtml(all) + '</div>';
  }
  function quoteOf(a, ex) {
    var cite = ex && ex.cite ? ex.cite.inText : '';
    return a.type === 'highlight'
      ? '“' + annText(a) + '” (' + (cite ? cite + ', ' : '') + 'p. ' + a.page + ')'
      : annText(a) + ' (' + (cite ? cite + ', ' : '') + 'p. ' + a.page + ')';
  }
  function annotationsMarkdown(p, items, ex) {
    var head = '## ' + p.title + (ex && ex.cite ? ' (' + ex.cite.inText + ')' : '');
    return [head, ''].concat(items.map(function (a) {
      return a.type === 'highlight' ? '> ' + annText(a) + ' (p. ' + a.page + ')' + NL : '- **Note, p. ' + a.page + ':** ' + annText(a) + NL;
    })).join(NL);
  }

  // ── Notes tab ─────────────────────────────────────────────────────────────
  var noteTimer = null;
  function noteText(p) { return view.noteDraft[p.id] !== undefined ? view.noteDraft[p.id] : (p.note || ''); }
  function setNoteState(text) { var el = $('noteState'); if (el) el.textContent = text; }
  function noteChanged(id, text) {
    if (!id) return;
    view.noteDraft[id] = text;
    setNoteState('Editing…');
    clearTimeout(noteTimer);
    noteTimer = setTimeout(flushNote, 700);
  }
  // Saves any note still being typed; called on pause, blur, selection change, navigation and hide.
  function flushNote() {
    clearTimeout(noteTimer);
    var ids = Object.keys(view.noteDraft);
    if (!ids.length) return;
    ids.forEach(function (id) {
      var text = view.noteDraft[id], p = paperById(id);
      delete view.noteDraft[id];
      if (p) { p.note = text; indexPaper(p); }
      post('setNote', { paperId: id, note: text });
    });
    setNoteState('Saved');
    // Keep the tab's "has a note" dot honest without rebuilding the pane under the cursor.
    var p = paperById(selIds()[0]), tab = $('tab-notes');
    if (p && tab) tab.innerHTML = 'Notes' + ((p.note || '').trim() ? '<span class="tab-badge dot">•</span>' : '');
  }
  function notesTab(p) {
    var ex = view.extras[p.id];
    var pdfNotes = ex ? ex.annotations.filter(function (a) { return a.type !== 'highlight'; }) : [];
    var hasAnn = ex && ex.annotations.length;
    return '<div class="notes-tab">' +
      '<textarea id="noteInput" class="note-input" spellcheck="true" placeholder="Your notes on this paper: the key idea, how it relates to your work, what to follow up…">' + esc(noteText(p)) + '</textarea>' +
      '<div class="tab-toolbar"><span id="noteState" class="muted-text">' + ((p.note || '').trim() ? 'Saved with the paper · syncs with it' : 'Saved automatically with the paper') + '</span><span class="tb-spacer"></span>' +
        (hasAnn ? '<button class="action-btn" data-action="insertAnnotations" title="Append your highlights as quotes">' + ICON['highlighter'] + '<span>Insert highlights</span></button>' : '') +
        iconBtn('copyNote', 'copy', 'Copy note') +
      '</div></div>' +
      (pdfNotes.length ? section('pdfnotes', 'Notes in the PDF', pdfNotes.map(annCard).join(''), { count: pdfNotes.length }) : '');
  }

  // ── Related tab ───────────────────────────────────────────────────────────
  // "Family|G" so "Ashish Vaswani" and "Vaswani, A." are the same person.
  function authorKey(a) {
    a = String(a).trim();
    var c = a.indexOf(','), family, given;
    if (c !== -1) { family = a.slice(0, c); given = a.slice(c + 1); }
    else { var parts = a.split(' '); family = parts.pop(); given = parts.join(' '); }
    return family.trim().toLowerCase() + '|' + given.trim().charAt(0).toLowerCase();
  }
  function relatedGroups(p) {
    var lib = view.library.filter(function (q) { return q.id !== p.id; });
    var mine = {}; (p.authors || []).forEach(function (a) { mine[authorKey(a)] = 1; });
    var terms = {}; (p.tags || []).concat(p.keywords || []).forEach(function (t) { terms[t.toLowerCase()] = 1; });
    var venue = String(p.journal || p.publisher || '').toLowerCase();
    var byYear = function (a, b) { return (b.year || 0) - (a.year || 0); };
    var authors = lib.filter(function (q) { return (q.authors || []).some(function (a) { return mine[authorKey(a)]; }); }).sort(byYear);
    var shared = lib.map(function (q) {
      var seen = {}, common = (q.tags || []).concat(q.keywords || []).filter(function (t) {
        var k = t.toLowerCase(); if (!terms[k] || seen[k]) return false; seen[k] = 1; return true;
      });
      return { q: q, common: common };
    }).filter(function (x) { return x.common.length; }).sort(function (a, b) { return b.common.length - a.common.length; });
    var sameVenue = venue ? lib.filter(function (q) { return String(q.journal || q.publisher || '').toLowerCase() === venue; }).sort(byYear) : [];
    var sim = (view.similar[p.id] || []).map(function (s) { var q = libraryById(s.paperId); return q ? { q: q, score: s.score } : null; }).filter(Boolean);
    var ids = {};
    authors.concat(shared.map(function (x) { return x.q; }), sameVenue, sim.map(function (x) { return x.q; })).forEach(function (q) { ids[q.id] = 1; });
    return { authors: authors, shared: shared, venue: sameVenue, similar: sim, total: Object.keys(ids).length };
  }
  function relRow(q, extra) {
    var here = !!paperById(q.id);
    return '<div class="rel-row" data-action="openRelated" data-id="' + esc(q.id) + '" title="' + (here ? 'Select' : 'Go to') + ' this paper — double-click to open it">' +
      '<span class="status-dot s-' + q.status + '" title="' + STATUS_LABEL[q.status] + '"></span>' +
      '<div class="rel-main"><div class="rel-title">' + esc(q.title) + '</div>' +
        '<div class="rel-sub">' + esc([fmtCreator(q.authors), q.year].filter(Boolean).join(' · ')) + (extra || '') + '</div></div>' +
      iconBtn('openPdf', 'book-open', 'Open PDF', ' data-id="' + esc(q.id) + '"') + '</div>';
  }
  function relatedTab(p) {
    var g = relatedGroups(p), html = '';
    if (view.similar[p.id] === null) html += section('relSimilar', 'Similar content', loading('Searching the AI index…'));
    else if (g.similar.length) {
      html += section('relSimilar', 'Similar content', g.similar.map(function (x) {
        return relRow(x.q, '<span class="rel-why">' + Math.round(x.score * 100) + '% match</span>');
      }).join(''), { count: g.similar.length });
    }
    if (g.authors.length) html += section('relAuthors', 'Same authors', g.authors.map(function (q) { return relRow(q); }).join(''), { count: g.authors.length });
    if (g.shared.length) {
      html += section('relShared', 'Shared tags & keywords', g.shared.map(function (x) {
        return relRow(x.q, '<span class="rel-why">' + x.common.map(esc).join(', ') + '</span>');
      }).join(''), { count: g.shared.length });
    }
    if (g.venue.length) html += section('relVenue', 'Same venue', g.venue.map(function (q) { return relRow(q); }).join(''), { count: g.venue.length });
    if (!html) {
      return '<div class="tab-empty">' + ICON['link'] + '<div>No related papers yet.</div><div class="muted-text">Papers that share authors, tags or keywords, or the venue with this one appear here. Tagging papers helps.</div></div>';
    }
    return html;
  }

  // ── tab actions ───────────────────────────────────────────────────────────
  function tabAction(action, el, p) {
    var ex = p && view.extras[p.id];
    if (action === 'annColor') { view.annColor = view.annColor === el.dataset.color ? null : el.dataset.color; updateAnnList(); return; }
    if (action === 'copyAnnotation' && ex) {
      var a = ex.annotations.filter(function (x) { return x.id === el.dataset.id; })[0];
      if (a) post('copyText', { text: quoteOf(a, ex), label: 'quote' });
      return;
    }
    if (action === 'copyAnnotations' && ex) {
      var items = filteredAnnotations(ex.annotations);
      post('copyText', { text: annotationsMarkdown(p, items, ex), label: items.length + ' annotation' + (items.length === 1 ? '' : 's') });
      return;
    }
    if (action === 'insertAnnotations' && ex) {
      var input = $('noteInput'), add = annotationsMarkdown(p, ex.annotations.filter(function (x) { return x.type === 'highlight'; }), ex);
      if (!input) return;
      input.value = (input.value.trim() ? input.value.replace(/[ ]+$/, '') + NL + NL : '') + add;
      noteChanged(p.id, input.value);
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      input.scrollTop = input.scrollHeight;
      return;
    }
    if (action === 'copyNote' && p) {
      var text = noteText(p);
      if (text.trim()) post('copyText', { text: text, label: 'note' });
    }
  }
`;
}
