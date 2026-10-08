/**
 * Context-menu portion of the list webview script: a keyboard-navigable menu styled like VS Code's, and the paper
 * actions it offers (open, copy citations, status, tags, move, OCR, metadata, export, remove) for one paper or a selection.
 *
 * Returned as a source fragment that template.script.ts splices into its IIFE, so it shares that scope (view, ICON, STATUSES, STATUS_LABEL, IS_MAC, MOD, ALT, esc, post, selIds, paperById, hasPdf, setStatus, fixable, requestTextLayers, focusTagInput).
 *
 * @depends none
 * @dependents ui/list/template.script.ts
 */

/**
 * Returns the context-menu JavaScript source. Like its host script it avoids template literals and backslashes.
 * @usedBy ui/list/template.script.ts
 * @returns JavaScript source text, without a surrounding script tag
 */
export function menuScriptFragment(): string {
  return `
  // ── context menu ──────────────────────────────────────────────────────────
  var menuEl = null, menuReturnFocus = null;
  function closeMenu() {
    if (!menuEl) return;
    menuEl.remove(); menuEl = null;
    if (menuReturnFocus && document.body.contains(menuReturnFocus)) menuReturnFocus.focus();
    menuReturnFocus = null;
  }
  function menuItems() { return menuEl ? Array.prototype.slice.call(menuEl.querySelectorAll('.ctx-item:not([disabled])')) : []; }
  // items: { label, icon | iconHtml, key, checked, disabled, danger, run } or '-' for a separator.
  function openMenu(x, y, items) {
    closeMenu();
    menuReturnFocus = document.activeElement;
    menuEl = document.createElement('div');
    menuEl.className = 'ctx-menu';
    menuEl.setAttribute('role', 'menu');
    items.forEach(function (it, i) {
      if (it === '-') {
        if (i > 0 && items[i - 1] !== '-') { var sep = document.createElement('div'); sep.className = 'ctx-sep'; menuEl.appendChild(sep); }
        return;
      }
      var b = document.createElement('button');
      b.className = 'ctx-item' + (it.danger ? ' danger' : '') + (it.checked ? ' checked' : '');
      b.setAttribute('role', 'menuitem');
      b.disabled = !!it.disabled;
      b.innerHTML = '<span class="ctx-icon">' + (it.checked ? ICON['check'] : it.iconHtml || (it.icon ? ICON[it.icon] : '')) + '</span>' +
        '<span class="ctx-label">' + esc(it.label) + '</span><span class="ctx-key">' + esc(it.key || '') + '</span>';
      b.addEventListener('click', function (e) { e.stopPropagation(); closeMenu(); it.run(); });
      b.addEventListener('mouseenter', function () { b.focus(); });
      menuEl.appendChild(b);
    });
    document.body.appendChild(menuEl);
    var r = menuEl.getBoundingClientRect();
    menuEl.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4)) + 'px';
    menuEl.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + 'px';
    var first = menuItems()[0];
    if (first) first.focus();
  }
  // Arrow keys, Home/End, Enter and Escape drive an open menu; returns true when it took the key.
  function menuKeydown(e) {
    if (!menuEl) return false;
    var items = menuItems(), at = items.indexOf(document.activeElement);
    if (e.key === 'Escape' || e.key === 'Tab') { closeMenu(); }
    else if (e.key === 'ArrowDown') { (items[(at + 1) % items.length] || items[0]).focus(); }
    else if (e.key === 'ArrowUp') { (items[at <= 0 ? items.length - 1 : at - 1] || items[0]).focus(); }
    else if (e.key === 'Home') { if (items[0]) items[0].focus(); }
    else if (e.key === 'End') { if (items.length) items[items.length - 1].focus(); }
    else if (e.key === 'Enter' || e.key === ' ') { if (at !== -1) items[at].click(); }
    else return true;
    e.preventDefault();
    return true;
  }
  document.addEventListener('mousedown', function (e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);
  window.addEventListener('blur', closeMenu);
  window.addEventListener('resize', closeMenu);
  list.addEventListener('scroll', closeMenu);

  // Everything you can do to one paper or a selection, in the order you reach for it.
  function paperMenu(ids) {
    var one = ids.length === 1 ? paperById(ids[0]) : null;
    var many = ids.length > 1, items = [];
    if (one) {
      var st = view.stats[one.id] || {};
      items.push({ icon: 'book-open', label: st.lastPage > 1 ? 'Continue Reading (p. ' + st.lastPage + ')' : 'Open PDF', key: '↵', disabled: !hasPdf(one),
        run: function () { post('openPdf', { paperId: one.id }); } });
      items.push({ icon: 'external', label: 'Open in Default PDF App', disabled: !hasPdf(one), run: function () { post('openPdfExternal', { paperId: one.id }); } });
      items.push('-');
    }
    items.push({ icon: 'key', label: many ? 'Copy ' + ids.length + ' Cite Keys' : 'Copy Cite Key', key: MOD + 'C',
      run: function () { post('copyCitation', { paperIds: ids, format: 'key' }); } });
    items.push({ icon: 'quote', label: 'Copy BibTeX', run: function () { post('copyCitation', { paperIds: ids, format: 'bibtex' }); } });
    items.push({ label: 'Copy APA Reference', run: function () { post('copyCitation', { paperIds: ids, format: 'apa' }); } });
    items.push('-');
    STATUSES.forEach(function (s, i) {
      var all = ids.every(function (id) { var p = paperById(id); return p && p.status === s; });
      items.push({ iconHtml: '<span class="status-dot s-' + s + '"></span>', checked: all, label: 'Mark as ' + STATUS_LABEL[s], key: ALT + (i + 1),
        run: function () { setStatus(ids, s); } });
    });
    items.push('-');
    items.push({ icon: 'tag', label: many ? 'Tag ' + ids.length + ' Papers…' : 'Add Tag…', run: focusTagInput });
    items.push({ icon: 'folder-move', label: 'Move to…', run: function () { post('pickMoveTarget', { paperIds: ids }); } });
    if (one) items.push({ icon: 'folder', label: 'Reveal in Explorer', run: function () { post('openFolder', { paperId: one.id }); } });
    var fix = fixable(ids);
    if (fix.length) items.push({ icon: 'file-no-text', label: many ? 'Make ' + fix.length + ' Searchable' : 'Make Searchable (OCR)', run: function () { requestTextLayers(fix); } });
    if (one) {
      items.push({ icon: 'refresh', label: 'Fetch Metadata Online', run: function () { post('fetchMetadata', { paperId: one.id }); } });
      if ((view.stats[one.id] || {}).annotations) {
        items.push({ icon: 'download', label: 'Export Annotations…', run: function () { post('exportAnnotations', { paperId: one.id }); } });
      }
    }
    items.push('-');
    items.push({ icon: 'trash', danger: true, label: many ? 'Remove ' + ids.length + ' Papers…' : 'Remove from Library…', key: IS_MAC ? '⌘⌫' : 'Delete',
      run: function () { post('deletePaper', { paperIds: ids }); } });
    return items;
  }
`;
}
