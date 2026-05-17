/**
 * Generates the inline JavaScript module injected into the PDF viewer webview, covering PDF.js initialization, toolbar controls, text-selection highlighting, annotation rendering, and host message handling.
 *
 * @depends none
 * @dependents pdf-viewer/renderer/PdfRenderer.ts
 */

export interface BuildJsParams {
  nonce: string;
  pdfjsUrl: string;
  viewerUrl: string;
  workerUrl: string;
  pdfUrl: string;
  cMapUrl: string;
  stdFontUrl: string;
  wasmUrl: string;
  iccUrl: string;
  zoomLevelsJson: string;
  themePreference: string;
  effectiveTheme: string;
  initialPage: number;
  initialZoom: number;
  annotationsJson: string;
  defaultZoom: number;
}

/**
 * Builds and returns a self-contained `<script type="module">` string that initializes the PDF.js viewer inside the webview.
 * @usedBy pdf-viewer/renderer/PdfRenderer.ts
 * @returns An HTML script tag string ready to be embedded in the webview document.
 */
export function buildJs(p: BuildJsParams): string {
  return `<script nonce="${p.nonce}" type="module">
${jsPolyfill()}
${jsConstants(p)}
${jsDomRefs()}
${jsState(p)}
${jsThemeAndNav()}
${jsAnnotations()}
${jsSelectionToolbar()}
${jsMessages()}
${jsToolbarControls()}
${jsPdfjsInit(p)}
applyTheme(${JSON.stringify(p.themePreference)}, ${JSON.stringify(p.effectiveTheme)});
renderAnnotationList();
</script>`;
}

function jsPolyfill(): string { return `/* ─── Polyfill (Map.getOrInsertComputed — TC39 stage 3) ─────── */
if (!Map.prototype.getOrInsertComputed) {
  Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
    value(key, fn) { if (this.has(key)) return this.get(key); const v = fn(key); this.set(key, v); return v; },
    configurable: true, writable: true,
  });
}`; }

function jsConstants(p: BuildJsParams): string { return `/* ─── Constants injected from host ─────────────────────────── */
const PDFJS_URL    = ${JSON.stringify(p.pdfjsUrl)};
const VIEWER_URL   = ${JSON.stringify(p.viewerUrl)};
const WORKER_URL   = ${JSON.stringify(p.workerUrl)};
const PDF_URL      = ${JSON.stringify(p.pdfUrl)};
const CMAP_URL     = ${JSON.stringify(p.cMapUrl)};
const STD_FONT_URL = ${JSON.stringify(p.stdFontUrl)};
const WASM_URL     = ${JSON.stringify(p.wasmUrl)};
const ICC_URL      = ${JSON.stringify(p.iccUrl)};
const ZOOM_LEVELS  = ${p.zoomLevelsJson};`; }

function jsDomRefs(): string { return `/* ─── DOM refs (cached once) ────────────────────────────────── */
const $  = (id) => document.getElementById(id);
const firstBtn = $('firstBtn'), prevBtn = $('prevBtn'), nextBtn = $('nextBtn'), lastBtn = $('lastBtn');
const pageInput = $('pageInput'), totalPagesEl = $('totalPages'), zoomSelect = $('zoomSelect');
const zoomInBtn = $('zoomInBtn'), zoomOutBtn = $('zoomOutBtn'), themeSelect = $('themeSelect');
const annotationsToggle = $('annotationsToggle'), sidebar = $('sidebar'), annotationList = $('annotation-list');
const loadingMsg = $('loading-msg'), errorMsg = $('error-msg'), selectionToolbar = $('selection-toolbar');
const bgColorPicker = $('bgColorPicker'), textColorPicker = $('textColorPicker');
const root = document.documentElement;`; }

function jsState(p: BuildJsParams): string { return `/* ─── State ─────────────────────────────────────────────────── */
const vscode = acquireVsCodeApi();
let _refreshTimer = null, currentTheme = ${JSON.stringify(p.themePreference)};
let currentEffectiveTheme = ${JSON.stringify(p.effectiveTheme)};
let currentPage = ${p.initialPage}, currentZoom = ${p.initialZoom};
let annotations = ${p.annotationsJson}, pdfDoc = null, pdfViewer = null;`; }

function jsThemeAndNav(): string { return `/* ─── Theme presets ─────────────────────────────────────────── */
const THEME_PRESETS = {
  'light': { bg: '#ffffff', text: '#000000' },
  'dark':  { bg: '#1e1e1e', text: '#e8e8e8' },
  'sepia': { bg: '#faf6ee', text: '#3a2a1a' },
  'high-contrast': { bg: '#000000', text: '#ffffff' },
};
function applyPageColors(bg, text) {
  $('viewerContainer').style.background = bg;
  if (!pdfViewer) return;
  const colors = (bg === '#ffffff' && text === '#000000') ? null : { background: bg, foreground: text };
  const cur = pdfViewer.pageColors;
  const same = (colors === null && cur === null) || (colors !== null && cur !== null && cur.background === colors.background && cur.foreground === colors.foreground);
  if (same) return;
  pdfViewer.pageColors = colors;
  for (const pv of (pdfViewer._pages ?? [])) { pv.pageColors = colors; }
  clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(() => pdfViewer?.refresh(), 80);
}
function applyTheme(theme, effectiveTheme) {
  if (theme) { currentTheme = theme; themeSelect.value = theme; }
  if (!effectiveTheme) return;
  currentEffectiveTheme = effectiveTheme;
  root.dataset.pdfTheme = effectiveTheme;
  const preset = THEME_PRESETS[effectiveTheme] ?? THEME_PRESETS['light'];
  bgColorPicker.value = preset.bg; textColorPicker.value = preset.text;
  applyPageColors(preset.bg, preset.text);
}
function updateNavState() {
  if (!pdfDoc || !pdfViewer) return;
  currentPage = pdfViewer.currentPageNumber;
  pageInput.value = String(currentPage);
  totalPagesEl.textContent = String(pdfDoc.numPages);
  firstBtn.disabled = prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = lastBtn.disabled = currentPage >= pdfDoc.numPages;
  zoomSelect.value = String(currentZoom);
}`; }

function jsAnnotations(): string { return `/* ─── Annotations ───────────────────────────────────────────── */
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function renderAnnotationList() {
  if (!annotations.length) { annotationList.innerHTML = '<div style="padding:12px 10px;font-size:11px;opacity:.6">No annotations yet</div>'; return; }
  const byPage = Object.groupBy ? Object.groupBy(annotations, (a) => a.pageNumber)
    : annotations.reduce((acc, a) => { (acc[a.pageNumber] ??= []).push(a); return acc; }, {});
  const frag = document.createDocumentFragment();
  Object.keys(byPage).sort((a, b) => Number(a) - Number(b)).forEach((pageNum) => {
    const hdr = document.createElement('div'); hdr.className = 'ann-group-header'; hdr.textContent = 'Page ' + pageNum; frag.appendChild(hdr);
    byPage[pageNum].forEach((ann) => {
      const item = document.createElement('div'); item.className = 'ann-item';
      const color = ann.color || 'note', preview = (ann.content || '').slice(0, 60) + ((ann.content || '').length > 60 ? '…' : '');
      item.innerHTML = '<div class="ann-item-header"><div class="ann-color-dot ' + esc(color) + '"></div><span style="font-size:11px;font-weight:500">' + esc(ann.type || 'note') + '</span></div><div class="ann-preview">' + esc(preview) + '</div><div class="ann-actions"><button class="ann-act-btn delete" data-ann-id="' + esc(ann.id) + '">Delete</button></div>';
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('delete')) { e.stopPropagation(); vscode.postMessage({ command: 'deleteAnnotation', id: ann.id }); return; }
        if (pdfViewer) { pdfViewer.currentPageNumber = ann.pageNumber; updateNavState(); vscode.postMessage({ command: 'pageChanged', pageNumber: ann.pageNumber }); }
      });
      frag.appendChild(item);
    });
  });
  annotationList.replaceChildren(frag);
}`; }

function jsSelectionToolbar(): string { return `/* ─── Text selection / highlight toolbar ────────────────────── */
let selectedText = '', hideTimer = null;
document.addEventListener('mouseup', () => {
  const sel = window.getSelection(), text = sel?.toString().trim() ?? '';
  if (!text) { selectionToolbar.classList.remove('visible'); selectedText = ''; return; }
  selectedText = text;
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  selectionToolbar.style.top = (rect.top + window.scrollY - 40) + 'px';
  selectionToolbar.style.left = (rect.left + window.scrollX) + 'px';
  selectionToolbar.classList.add('visible');
});
document.addEventListener('mousedown', (e) => { if (selectionToolbar.contains(e.target)) return; hideTimer = setTimeout(() => selectionToolbar.classList.remove('visible'), 150); });
selectionToolbar.addEventListener('mousedown', (e) => {
  e.preventDefault(); clearTimeout(hideTimer);
  const btn = e.target.closest('.color-btn');
  if (!btn || !selectedText || !pdfViewer) return;
  vscode.postMessage({ command: 'createAnnotation', type: 'highlight', pageNumber: pdfViewer.currentPageNumber, content: selectedText, color: btn.dataset.color });
  window.getSelection()?.removeAllRanges(); selectionToolbar.classList.remove('visible'); selectedText = '';
});`; }

function jsMessages(): string { return `/* ─── Messages from extension host ──────────────────────────── */
window.addEventListener('message', ({ data: msg }) => {
  switch (msg.type) {
    case 'updateAnnotations': annotations = msg.annotations ?? []; renderAnnotationList(); break;
    case 'applyTheme': applyTheme(msg.theme, msg.effectiveTheme); break;
    case 'scrollToPage': if (pdfViewer && msg.pageNumber) { pdfViewer.currentPageNumber = msg.pageNumber; updateNavState(); } break;
  }
});`; }

function jsToolbarControls(): string { return `/* ─── Toolbar controls ───────────────────────────────────────── */
annotationsToggle.addEventListener('click', () => sidebar.classList.toggle('hidden'));
themeSelect.addEventListener('change', () => { currentTheme = themeSelect.value; vscode.postMessage({ command: 'selectTheme', theme: currentTheme }); });
bgColorPicker.addEventListener('change', () => applyPageColors(bgColorPicker.value, textColorPicker.value));
textColorPicker.addEventListener('change', () => applyPageColors(bgColorPicker.value, textColorPicker.value));
pageInput.addEventListener('change', () => {
  if (!pdfDoc || !pdfViewer) return;
  const num = parseInt(pageInput.value, 10);
  if (num >= 1 && num <= pdfDoc.numPages) { pdfViewer.currentPageNumber = num; updateNavState(); vscode.postMessage({ command: 'pageChanged', pageNumber: num }); }
});
firstBtn.addEventListener('click', () => { if (!pdfViewer) return; pdfViewer.currentPageNumber = 1; updateNavState(); vscode.postMessage({ command: 'pageChanged', pageNumber: 1 }); });
prevBtn.addEventListener('click', () => { if (!pdfViewer) return; const p = Math.max(1, pdfViewer.currentPageNumber - 1); pdfViewer.currentPageNumber = p; updateNavState(); vscode.postMessage({ command: 'pageChanged', pageNumber: p }); });
nextBtn.addEventListener('click', () => { if (!pdfViewer || !pdfDoc) return; const p = Math.min(pdfDoc.numPages, pdfViewer.currentPageNumber + 1); pdfViewer.currentPageNumber = p; updateNavState(); vscode.postMessage({ command: 'pageChanged', pageNumber: p }); });
lastBtn.addEventListener('click', () => { if (!pdfViewer || !pdfDoc) return; pdfViewer.currentPageNumber = pdfDoc.numPages; updateNavState(); vscode.postMessage({ command: 'pageChanged', pageNumber: pdfDoc.numPages }); });
function setZoom(level) { currentZoom = level; pdfViewer.currentScaleValue = String(level / 100); zoomSelect.value = String(level); vscode.postMessage({ command: 'zoomChanged', zoomLevel: level }); }
zoomSelect.addEventListener('change', () => { if (pdfViewer) setZoom(parseInt(zoomSelect.value, 10)); });
zoomInBtn.addEventListener('click', () => { if (!pdfViewer) return; const next = ZOOM_LEVELS.find((l) => l > currentZoom); if (next !== undefined) setZoom(next); });
zoomOutBtn.addEventListener('click', () => { if (!pdfViewer) return; const prev = [...ZOOM_LEVELS].reverse().find((l) => l < currentZoom); if (prev !== undefined) setZoom(prev); });`; }

function jsPdfjsInit(p: BuildJsParams): string { return `/* ─── PDF.js initialisation ──────────────────────────────────── */
try {
  if (!PDFJS_URL || !VIEWER_URL) throw new Error('PDF.js viewer assets are unavailable.');
  console.time('pdfjs-import');
  const pdfjsLib = await import(PDFJS_URL);
  console.timeEnd('pdfjs-import');
  globalThis.pdfjsLib = pdfjsLib;
  console.time('worker-fetch + viewer-import');
  const [workerSrc, viewerLib] = await Promise.all([
    WORKER_URL ? fetch(WORKER_URL).then(r => r.text()) : Promise.resolve(null),
    import(VIEWER_URL),
  ]);
  console.timeEnd('worker-fetch + viewer-import');
  if (workerSrc) {
    const workerBlob = new Blob([workerSrc], { type: 'text/javascript' });
    pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(URL.createObjectURL(workerBlob), { type: 'module' });
  }
  console.time('doc-load');
  const loadedDoc = await pdfjsLib.getDocument({
    url: PDF_URL, disableAutoFetch: false, rangeChunkSize: 65536, fontExtraProperties: true,
    cMapUrl: CMAP_URL || undefined, cMapPacked: true, standardFontDataUrl: STD_FONT_URL || undefined,
    wasmUrl: WASM_URL || undefined, iccUrl: ICC_URL || undefined, useSystemFonts: true, isEvalSupported: true, enableHWA: true,
  }).promise;
  console.timeEnd('doc-load');
  pdfDoc = loadedDoc;
  totalPagesEl.textContent = String(pdfDoc.numPages);
  const eventBus = new viewerLib.EventBus();
  const linkService = new viewerLib.PDFLinkService({ eventBus });
  const _p = THEME_PRESETS[currentEffectiveTheme] ?? THEME_PRESETS['light'];
  pdfViewer = new viewerLib.PDFViewer({
    container: $('viewerContainer'), viewer: $('viewer'), eventBus, linkService,
    textLayerMode: 1, annotationMode: 2, removePageBorders: false,
    capCanvasAreaFactor: -1, maxCanvasPixels: -1, maxCanvasDim: 32767, enableDetailCanvas: false, enableHWA: true,
    pageColors: (_p.bg === '#ffffff' && _p.text === '#000000') ? null : { background: _p.bg, foreground: _p.text },
  });
  linkService.setViewer(pdfViewer); linkService.setDocument(pdfDoc, null); pdfViewer.setDocument(pdfDoc);
  eventBus.on('pagechanging', ({ pageNumber }) => { currentPage = pageNumber; updateNavState(); vscode.postMessage({ command: 'pageChanged', pageNumber }); });
  eventBus.on('scalechanging', ({ scale }) => {
    const scaled = Math.round(Number(scale) * 100);
    if (!Number.isFinite(scaled) || scaled <= 0) return;
    currentZoom = scaled;
    if (![...zoomSelect.options].some((o) => o.value === String(scaled))) zoomSelect.appendChild(new Option(scaled + '%', String(scaled)));
    zoomSelect.value = String(scaled); vscode.postMessage({ command: 'zoomChanged', zoomLevel: scaled });
  });
  console.time('pagesinit');
  eventBus.on('pagesinit', () => {
    console.timeEnd('pagesinit');
    pdfViewer.currentScaleValue = ${p.initialZoom} === ${p.defaultZoom} ? 'page-width' : String(${p.initialZoom} / 100);
    pdfViewer.currentPageNumber = ${p.initialPage}; updateNavState();
    loadingMsg.style.display = 'none'; vscode.postMessage({ command: 'ready', totalPages: pdfDoc.numPages });
  });
  eventBus.on('pagerendered', ({ source, pageNumber }) => {
    if (pageNumber !== 1) return;
    const cv = source?.canvas;
    if (cv) console.log('[labshelf] DPR:', window.devicePixelRatio, '| canvas px:', cv.width, '×', cv.height, '| CSS:', cv.style.width, '×', cv.style.height, '| zoom %:', currentZoom);
  }, { once: true });
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  loadingMsg.style.display = 'none'; errorMsg.style.display = 'block'; errorMsg.textContent = 'Failed to initialize PDF viewer: ' + msg;
}`; }
