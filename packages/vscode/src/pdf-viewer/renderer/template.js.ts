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
/* ─── Polyfill (Map.getOrInsertComputed — TC39 stage 3) ─────── */
if (!Map.prototype.getOrInsertComputed) {
  Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
    value(key, fn) {
      if (this.has(key)) return this.get(key);
      const v = fn(key); this.set(key, v); return v;
    },
    configurable: true, writable: true,
  });
}

/* ─── Constants injected from host ─────────────────────────── */
const PDFJS_URL    = ${JSON.stringify(p.pdfjsUrl)};
const VIEWER_URL   = ${JSON.stringify(p.viewerUrl)};
const WORKER_URL   = ${JSON.stringify(p.workerUrl)};
const PDF_URL      = ${JSON.stringify(p.pdfUrl)};
const CMAP_URL     = ${JSON.stringify(p.cMapUrl)};
const STD_FONT_URL = ${JSON.stringify(p.stdFontUrl)};
const WASM_URL     = ${JSON.stringify(p.wasmUrl)};
const ICC_URL      = ${JSON.stringify(p.iccUrl)};
const ZOOM_LEVELS  = ${p.zoomLevelsJson};

/* ─── DOM refs (cached once) ────────────────────────────────── */
const $  = (id) => document.getElementById(id);
const firstBtn        = $('firstBtn');
const prevBtn         = $('prevBtn');
const nextBtn         = $('nextBtn');
const lastBtn         = $('lastBtn');
const pageInput       = $('pageInput');
const totalPagesEl    = $('totalPages');
const zoomSelect      = $('zoomSelect');
const zoomInBtn       = $('zoomInBtn');
const zoomOutBtn      = $('zoomOutBtn');
const themeSelect     = $('themeSelect');
const annotationsToggle = $('annotationsToggle');
const sidebar         = $('sidebar');
const annotationList  = $('annotation-list');
const loadingMsg      = $('loading-msg');
const errorMsg        = $('error-msg');
const selectionToolbar = $('selection-toolbar');
const bgColorPicker   = $('bgColorPicker');
const textColorPicker = $('textColorPicker');
const root            = document.documentElement;

/* ─── State ─────────────────────────────────────────────────── */
const vscode          = acquireVsCodeApi();
let   _refreshTimer   = null;
let currentTheme    = ${JSON.stringify(p.themePreference)};
let currentEffectiveTheme = ${JSON.stringify(p.effectiveTheme)};
let currentPage     = ${p.initialPage};
let currentZoom     = ${p.initialZoom};
let annotations     = ${p.annotationsJson};
let pdfDoc          = null;
let pdfViewer       = null;

/* ─── pageColors presets ─────────────────────────────────────── */
// bg  = the colour that replaces the PDF's white page background
// text = the colour that replaces black text / dark vector strokes
const THEME_PRESETS = {
  'light':         { bg: '#ffffff', text: '#000000' },
  'dark':          { bg: '#1e1e1e', text: '#e8e8e8' },
  'sepia':         { bg: '#faf6ee', text: '#3a2a1a' },
  'high-contrast': { bg: '#000000', text: '#ffffff' },
};

function applyPageColors(bg, text) {
  $('viewerContainer').style.background = bg;
  if (!pdfViewer) return;
  // null = PDF's own colours (light mode); otherwise remap via HCM.
  const colors = (bg === '#ffffff' && text === '#000000')
    ? null
    : { background: bg, foreground: text };
  // Skip refresh when colours haven't changed — avoids cancelling an
  // in-progress render (the initial applyTheme call uses the same values
  // already set in the PDFViewer constructor, so no re-render is needed).
  const cur = pdfViewer.pageColors;
  const same = (colors === null && cur === null)
    || (colors !== null && cur !== null
        && cur.background === colors.background
        && cur.foreground === colors.foreground);
  if (same) return;
  pdfViewer.pageColors = colors;
  for (const pv of (pdfViewer._pages ?? [])) { pv.pageColors = colors; }
  // Debounce: if multiple theme/color messages arrive quickly (e.g. DB
  // preference + VS Code theme change), only issue one refresh.
  clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(() => pdfViewer?.refresh(), 80);
}

function applyTheme(theme, effectiveTheme) {
  if (theme) { currentTheme = theme; themeSelect.value = theme; }
  if (!effectiveTheme) return;
  currentEffectiveTheme = effectiveTheme;
  root.dataset.pdfTheme = effectiveTheme;
  // Reset pickers to the preset for this theme, then apply.
  const preset = THEME_PRESETS[effectiveTheme] ?? THEME_PRESETS['light'];
  bgColorPicker.value   = preset.bg;
  textColorPicker.value = preset.text;
  applyPageColors(preset.bg, preset.text);
}

/* ─── Navigation state ───────────────────────────────────────── */
function updateNavState() {
  if (!pdfDoc || !pdfViewer) return;
  currentPage = pdfViewer.currentPageNumber;
  pageInput.value         = String(currentPage);
  totalPagesEl.textContent = String(pdfDoc.numPages);
  firstBtn.disabled = prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled  = lastBtn.disabled = currentPage >= pdfDoc.numPages;
  zoomSelect.value  = String(currentZoom);
}

/* ─── Annotation list ────────────────────────────────────────── */
function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderAnnotationList() {
  if (!annotations.length) {
    annotationList.innerHTML =
      '<div style="padding:12px 10px;font-size:11px;opacity:.6">No annotations yet</div>';
    return;
  }
  const byPage = Object.groupBy
    ? Object.groupBy(annotations, (a) => a.pageNumber)
    : annotations.reduce((acc, a) => {
        (acc[a.pageNumber] ??= []).push(a); return acc;
      }, {});

  const frag = document.createDocumentFragment();
  Object.keys(byPage)
    .sort((a, b) => Number(a) - Number(b))
    .forEach((pageNum) => {
      const hdr = document.createElement('div');
      hdr.className = 'ann-group-header';
      hdr.textContent = 'Page ' + pageNum;
      frag.appendChild(hdr);

      byPage[pageNum].forEach((ann) => {
        const item = document.createElement('div');
        item.className = 'ann-item';
        const color   = ann.color || 'note';
        const preview = (ann.content || '').slice(0, 60) +
                        ((ann.content || '').length > 60 ? '…' : '');
        item.innerHTML =
          '<div class="ann-item-header">' +
            '<div class="ann-color-dot ' + esc(color) + '"></div>' +
            '<span style="font-size:11px;font-weight:500">' + esc(ann.type || 'note') + '</span>' +
          '</div>' +
          '<div class="ann-preview">' + esc(preview) + '</div>' +
          '<div class="ann-actions">' +
            '<button class="ann-act-btn delete" data-ann-id="' + esc(ann.id) + '">Delete</button>' +
          '</div>';

        item.addEventListener('click', (e) => {
          if (e.target.classList.contains('delete')) {
            e.stopPropagation();
            vscode.postMessage({ command: 'deleteAnnotation', id: ann.id });
            return;
          }
          if (pdfViewer) {
            pdfViewer.currentPageNumber = ann.pageNumber;
            updateNavState();
            vscode.postMessage({ command: 'pageChanged', pageNumber: ann.pageNumber });
          }
        });
        frag.appendChild(item);
      });
    });

  annotationList.replaceChildren(frag);
}

/* ─── Text selection / highlight toolbar ────────────────────── */
let selectedText = '';
let hideTimer    = null;

document.addEventListener('mouseup', () => {
  const sel  = window.getSelection();
  const text = sel?.toString().trim() ?? '';
  if (!text) {
    selectionToolbar.classList.remove('visible');
    selectedText = '';
    return;
  }
  selectedText = text;
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  selectionToolbar.style.top  = (rect.top  + window.scrollY - 40) + 'px';
  selectionToolbar.style.left = (rect.left + window.scrollX)       + 'px';
  selectionToolbar.classList.add('visible');
});

document.addEventListener('mousedown', (e) => {
  if (selectionToolbar.contains(e.target)) return;
  hideTimer = setTimeout(() => selectionToolbar.classList.remove('visible'), 150);
});

selectionToolbar.addEventListener('mousedown', (e) => {
  e.preventDefault(); // prevent selection loss
  clearTimeout(hideTimer);
  const btn = e.target.closest('.color-btn');
  if (!btn || !selectedText || !pdfViewer) return;
  vscode.postMessage({
    command: 'createAnnotation',
    type: 'highlight',
    pageNumber: pdfViewer.currentPageNumber,
    content: selectedText,
    color: btn.dataset.color,
  });
  window.getSelection()?.removeAllRanges();
  selectionToolbar.classList.remove('visible');
  selectedText = '';
});

/* ─── Messages from extension host ──────────────────────────── */
window.addEventListener('message', ({ data: msg }) => {
  switch (msg.type) {
    case 'updateAnnotations':
      annotations = msg.annotations ?? [];
      renderAnnotationList();
      break;
    case 'applyTheme':
      applyTheme(msg.theme, msg.effectiveTheme);
      break;
    case 'scrollToPage':
      if (pdfViewer && msg.pageNumber) {
        pdfViewer.currentPageNumber = msg.pageNumber;
        updateNavState();
      }
      break;
  }
});

/* ─── Toolbar controls ───────────────────────────────────────── */
annotationsToggle.addEventListener('click', () => sidebar.classList.toggle('hidden'));

themeSelect.addEventListener('change', () => {
  currentTheme = themeSelect.value;
  vscode.postMessage({ command: 'selectTheme', theme: currentTheme });
});

bgColorPicker.addEventListener('change', () => {
  applyPageColors(bgColorPicker.value, textColorPicker.value);
});
textColorPicker.addEventListener('change', () => {
  applyPageColors(bgColorPicker.value, textColorPicker.value);
});

pageInput.addEventListener('change', () => {
  if (!pdfDoc || !pdfViewer) return;
  const num = parseInt(pageInput.value, 10);
  if (num >= 1 && num <= pdfDoc.numPages) {
    pdfViewer.currentPageNumber = num;
    updateNavState();
    vscode.postMessage({ command: 'pageChanged', pageNumber: num });
  }
});

firstBtn.addEventListener('click', () => {
  if (!pdfViewer) return;
  pdfViewer.currentPageNumber = 1;
  updateNavState();
  vscode.postMessage({ command: 'pageChanged', pageNumber: 1 });
});

prevBtn.addEventListener('click', () => {
  if (!pdfViewer) return;
  const p = Math.max(1, pdfViewer.currentPageNumber - 1);
  pdfViewer.currentPageNumber = p;
  updateNavState();
  vscode.postMessage({ command: 'pageChanged', pageNumber: p });
});

nextBtn.addEventListener('click', () => {
  if (!pdfViewer || !pdfDoc) return;
  const p = Math.min(pdfDoc.numPages, pdfViewer.currentPageNumber + 1);
  pdfViewer.currentPageNumber = p;
  updateNavState();
  vscode.postMessage({ command: 'pageChanged', pageNumber: p });
});

lastBtn.addEventListener('click', () => {
  if (!pdfViewer || !pdfDoc) return;
  pdfViewer.currentPageNumber = pdfDoc.numPages;
  updateNavState();
  vscode.postMessage({ command: 'pageChanged', pageNumber: pdfDoc.numPages });
});

function setZoom(level) {
  currentZoom = level;
  pdfViewer.currentScaleValue = String(level / 100);
  zoomSelect.value = String(level);
  vscode.postMessage({ command: 'zoomChanged', zoomLevel: level });
}

zoomSelect.addEventListener('change', () => {
  if (pdfViewer) setZoom(parseInt(zoomSelect.value, 10));
});

zoomInBtn.addEventListener('click', () => {
  if (!pdfViewer) return;
  const next = ZOOM_LEVELS.find((l) => l > currentZoom);
  if (next !== undefined) setZoom(next);
});

zoomOutBtn.addEventListener('click', () => {
  if (!pdfViewer) return;
  const prev = [...ZOOM_LEVELS].reverse().find((l) => l < currentZoom);
  if (prev !== undefined) setZoom(prev);
});

/* ─── PDF.js initialisation ──────────────────────────────────── */
// Kick off BOTH module imports immediately before awaiting either.
// viewerLib doesn't depend on pdfjsLib, so they can fetch in parallel.
// After pdfjsLib resolves we set workerSrc and start getDocument while
// viewerLib may still be loading in the background.
try {
  if (!PDFJS_URL || !VIEWER_URL) {
    throw new Error('PDF.js viewer assets are unavailable.');
  }

  // pdf_viewer.mjs destructures globalThis.pdfjsLib at evaluation time,
  // so pdfjsLib MUST be set before the viewer module is imported.
  console.time('pdfjs-import');
  const pdfjsLib = await import(PDFJS_URL);
  console.timeEnd('pdfjs-import');
  globalThis.pdfjsLib = pdfjsLib;

  // VSCode webviews reject new Worker() for vscode-webview-resource: URIs,
  // causing pdf.js to use a synchronous fake worker (30s+ for any real PDF).
  // Fix: fetch the worker bundle source and create a self-contained blob: worker.
  // pdf.worker.min.mjs has zero external imports, so the blob runs standalone.
  // Fetch worker source and import viewer in parallel — both are independent.
  console.time('worker-fetch + viewer-import');
  const [workerSrc, viewerLib] = await Promise.all([
    WORKER_URL ? fetch(WORKER_URL).then(r => r.text()) : Promise.resolve(null),
    import(VIEWER_URL),
  ]);
  console.timeEnd('worker-fetch + viewer-import');

  if (workerSrc) {
    const workerBlob = new Blob([workerSrc], { type: 'text/javascript' });
    const workerBlobUrl = URL.createObjectURL(workerBlob);
    const pdfjsWorker = new Worker(workerBlobUrl, { type: 'module' });
    pdfjsLib.GlobalWorkerOptions.workerPort = pdfjsWorker;
  }

  console.time('doc-load');
  const loadedDoc = await pdfjsLib.getDocument({
    url: PDF_URL,
    disableAutoFetch: false,
    rangeChunkSize: 65536,
    fontExtraProperties: true,
    // Loading cmaps + standard fonts + wasm + icc lets the worker render
    // CJK glyphs, Type-1 fonts, JBIG2/JPEG2000 images, and ICC colour
    // profiles at full quality instead of falling back to bitmap approximations.
    cMapUrl: CMAP_URL || undefined,
    cMapPacked: true,
    standardFontDataUrl: STD_FONT_URL || undefined,
    wasmUrl: WASM_URL || undefined,
    iccUrl:  ICC_URL  || undefined,
    useSystemFonts: true,
    isEvalSupported: true,
    enableHWA: true,
  }).promise;
  console.timeEnd('doc-load');

  pdfDoc = loadedDoc;
  totalPagesEl.textContent = String(pdfDoc.numPages);

  const eventBus    = new viewerLib.EventBus();
  const linkService = new viewerLib.PDFLinkService({ eventBus });

  const _p = THEME_PRESETS[currentEffectiveTheme] ?? THEME_PRESETS['light'];
  pdfViewer = new viewerLib.PDFViewer({
    container:      $('viewerContainer'),
    viewer:         $('viewer'),
    eventBus,
    linkService,
    textLayerMode:  1,
    annotationMode: 2,
    removePageBorders: false,
    // ── Sharpness fix (pdf.js v5) ──────────────────────────────────
    // pdf.js v5 caps the canvas resolution via *three* knobs that
    // interact non-obviously. Setting only maxCanvasPixels:-1 is not
    // enough because capCanvasAreaFactor silently overrides it:
    //
    //   capPixels(maxPixels, capAreaFactor) {
    //     if (capAreaFactor >= 0) {                     // default 200
    //       const winPixels = screen*dpr²*(1+200/100);  // ~screen×3
    //       return maxPixels > 0 ? min(maxPixels, winPixels) : winPixels;
    //     }                            //                       ^^^^^^^^^
    //     return maxPixels;            //   maxPixels:-1 is IGNORED here
    //   }
    //
    // So with the defaults, the canvas is capped at ~3× screen pixels.
    // Zoom past that and the canvas is rendered at lower-than-CSS
    // resolution → browser bilinear-upscales it → blur.
    //
    //  1. capCanvasAreaFactor:-1 → short-circuits the screen-area cap
    //                              entirely (THE fix vs tomoki1207)
    //  2. maxCanvasPixels:    -1 → no absolute pixel cap
    //  3. maxCanvasDim:    32767 → the GPU/browser hard limit; explicit
    //                              so a future default change can't lower it
    //  4. enableDetailCanvas:false → never half-res the base canvas with
    //                                an overlay on the visible slice
    //  5. enableHWA:true → GPU-composited canvas
    capCanvasAreaFactor: -1,
    maxCanvasPixels:     -1,
    maxCanvasDim:        32767,
    enableDetailCanvas:  false,
    enableHWA:           true,
    pageColors: (_p.bg === '#ffffff' && _p.text === '#000000')
      ? null
      : { background: _p.bg, foreground: _p.text },
  });

  linkService.setViewer(pdfViewer);
  linkService.setDocument(pdfDoc, null);
  pdfViewer.setDocument(pdfDoc);

  eventBus.on('pagechanging', ({ pageNumber }) => {
    currentPage = pageNumber;
    updateNavState();
    vscode.postMessage({ command: 'pageChanged', pageNumber });
  });

  eventBus.on('scalechanging', ({ scale }) => {
    const scaled = Math.round(Number(scale) * 100);
    if (!Number.isFinite(scaled) || scaled <= 0) return;
    currentZoom = scaled;
    if (![...zoomSelect.options].some((o) => o.value === String(scaled))) {
      zoomSelect.appendChild(new Option(scaled + '%', String(scaled)));
    }
    zoomSelect.value = String(scaled);
    vscode.postMessage({ command: 'zoomChanged', zoomLevel: scaled });
  });

  console.time('pagesinit');
  eventBus.on('pagesinit', () => {
    console.timeEnd('pagesinit');
    // page-width on first open (stored zoom is the default); restore explicit zoom otherwise.
    pdfViewer.currentScaleValue = ${p.initialZoom} === ${p.defaultZoom}
      ? 'page-width'
      : String(${p.initialZoom} / 100);
    pdfViewer.currentPageNumber = ${p.initialPage};
    updateNavState();
    loadingMsg.style.display = 'none';
    vscode.postMessage({ command: 'ready', totalPages: pdfDoc.numPages });
  });

  eventBus.on('pagerendered', ({ source, pageNumber }) => {
    if (pageNumber !== 1) return;
    const cv = source?.canvas;
    if (cv) {
      console.log('[labshelf] DPR:', window.devicePixelRatio,
        '| canvas px:', cv.width, '×', cv.height,
        '| CSS:', cv.style.width, '×', cv.style.height,
        '| zoom %:', currentZoom);
    }
  }, { once: true });

} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  loadingMsg.style.display = 'none';
  errorMsg.style.display   = 'block';
  errorMsg.textContent     = 'Failed to initialize PDF viewer: ' + msg;
}

/* ─── Apply initial theme & render annotation list ───────────── */
applyTheme(${JSON.stringify(p.themePreference)}, ${JSON.stringify(p.effectiveTheme)});
renderAnnotationList();
</script>`;
}
