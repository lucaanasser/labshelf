/**
 * The reader: boots pdf.js, builds the immersive chrome around it and connects everything to a host. Host-agnostic:
 * the VS Code webview and the browser extension page both call startReader with their own boot parameters and
 * transport, so the two products run the very same reader.
 */
import { type HostToWebview, type ReaderBootParams, clampPage } from "../index.js";
import type { ReaderAction } from "../logic/index.js";
import { installPolyfills } from "./polyfills.js";
import {
  AnnotationsTab,
  Cheatsheet,
  CitationResolver,
  type ReaderContext,
  DestPreview,
  byId,
  FindBar,
  FloatResolver,
  installTextLayerFocusGuard,
  HostBridge,
  type ReaderTransport,
  HoverPreview,
  Keyboard,
  NavHistory,
  OutlineTab,
  PageTextCache,
  describeLoadError,
  loadPdf,
  type PdfSourceHooks,
  type PerfMarks,
  closePopover,
  isPopoverOpen,
  ReadingStateReporter,
  SelectionBubble,
  Sidebar,
  StatusPill,
  ThemeController,
  openThemePopover,
  ThumbnailsTab,
  Toolbar,
  createViewer,
  ZoomController,
} from "./ui/index.js";

type InitMessage = Extract<HostToWebview, { type: "init" }>;

export interface ReaderStartOptions {
  boot: ReaderBootParams;
  transport: ReaderTransport;
  /** Created by the entry's first statement so `scriptStart` still measures the whole open. */
  perf: PerfMarks;
  /** How the paper's bytes and the pdf.js worker are obtained; VS Code uses the defaults. */
  pdf?: PdfSourceHooks;
}

/**
 * Builds the reader around the shell already in the document (READER_SHELL_BODY) and connects it to a host. Call once per document.
 * @returns resolves once the viewer is wired; on a load failure shows #error-msg and rejects so the host can log it.
 */
export function startReader({ boot, transport, perf, pdf }: ReaderStartOptions): Promise<void> {
  installPolyfills();
  installTextLayerFocusGuard();

  const host = new HostBridge(transport);
  const container = byId<HTMLDivElement>("viewerContainer");
  const loadingMsg = byId("loading-msg");
  const errorMsg = byId("error-msg");

  // Asked for before anything loads, so the stored position and annotations are usually here by `pagesinit`.
  let init: InitMessage | null = null;
  let onInit: ((msg: InitMessage) => void) | null = null;
  host.on("init", (msg) => { init = msg; onInit?.(msg); });
  host.post({ command: "ready-for-init" });

  const theme = new ThemeController(container, boot.themePreference, boot.effectiveTheme);
  host.on("applyTheme", (msg) => theme.apply(msg.theme, msg.effectiveTheme));

  async function start(): Promise<void> {
    const loaded = await loadPdf(boot.assets, perf, pdf);
    const parts = createViewer(loaded.viewerLib, loaded.pdfDocument, container, byId<HTMLDivElement>("viewer"), theme.effective);
    const ctx: ReaderContext = { boot, host, container, prefs: boot.prefs, ...loaded, ...parts };
    const { pdfViewer, pdfDocument, eventBus } = ctx;
    theme.attach(pdfViewer);

    const history = new NavHistory(ctx);
    const zoom = new ZoomController(ctx);
    const goToPage = (page: number): void => {
      const target = clampPage(page, pdfDocument.numPages);
      if (target === pdfViewer.currentPageNumber) { return; }
      history.recordDeparture();
      pdfViewer.currentPageNumber = target;
    };

    const annotationsTab = new AnnotationsTab(host, goToPage);
    const sidebar = new Sidebar({
      thumbnails: new ThumbnailsTab(ctx, theme, goToPage),
      outline: new OutlineTab(ctx),
      annotations: annotationsTab,
    });
    const findBar = new FindBar(ctx, history);
    const cheatsheet = new Cheatsheet(ctx);
    const pill = new StatusPill(ctx, zoom, goToPage);
    const bubble = new SelectionBubble(ctx);
    const reporter = new ReadingStateReporter(ctx, sidebar);
    const toolbar = new Toolbar(container, boot.paperTitle, boot.isMac, ctx.prefs.toolbarAutoHide, {
      toggleSidebar: () => sidebar.toggle(),
      historyBack: () => history.back(),
      historyForward: () => history.forward(),
      openFind: () => findBar.show(),
      openTheme: (anchor) => openThemePopover(anchor, theme, host),
      openCheatsheet: () => cheatsheet.toggle(),
    });
    history.onChange(() => toolbar.setHistoryState(history.canGoBack, history.canGoForward));
    sidebar.onChange((s) => toolbar.setSidebarOpen(s.open));
    findBar.onToggle((open) => toolbar.setFindOpen(open));
    let hover: HoverPreview | null = null;

    const pageStep = (fraction: number): void => {
      container.scrollBy({ top: container.clientHeight * fraction, behavior: "smooth" });
    };
    const run = (action: ReaderAction): void => {
      switch (action) {
        case "pageDown": pageStep(0.9); break;
        case "pageUp": pageStep(-0.9); break;
        case "halfPageDown": pageStep(0.5); break;
        case "halfPageUp": pageStep(-0.5); break;
        case "nextPage": pdfViewer.nextPage(); break;
        case "prevPage": pdfViewer.previousPage(); break;
        case "firstPage": goToPage(1); break;
        case "lastPage": goToPage(pdfDocument.numPages); break;
        case "find": findBar.show(); break;
        case "findNext": findBar.again(false); break;
        case "findPrev": findBar.again(true); break;
        case "zoomIn": zoom.zoomIn(); break;
        case "zoomOut": zoom.zoomOut(); break;
        case "zoomReset": zoom.setPreset(ctx.prefs.defaultZoom); break;
        case "fitWidth": zoom.setPreset("page-width"); break;
        case "fitPage": zoom.setPreset("page-fit"); break;
        case "historyBack": history.back(); break;
        case "historyForward": history.forward(); break;
        case "goToPage": pill.focusPageInput(); break;
        case "toggleSidebar": sidebar.toggle(); break;
        case "cheatsheet": cheatsheet.toggle(); break;
        case "copyWithCitation": bubble.copyWithCitation(); break;
        case "escape":
          // Innermost transient surface first.
          if (cheatsheet.isOpen) { cheatsheet.close(); }
          else if (isPopoverOpen()) { closePopover(); }
          else if (findBar.isOpen) { findBar.close(); }
          else { bubble.hide(); hover?.close(); }
          break;
        // Held-key scrolling is driven by Keyboard itself.
        case "scrollDown": case "scrollUp": case "scrollLeft": case "scrollRight": break;
      }
    };
    const keyboard = new Keyboard(ctx, run);

    host.on("command", (msg) => keyboard.dispatch(msg.id, "host"));
    host.on("scrollToPage", (msg) => goToPage(msg.pageNumber));
    host.on("updateAnnotations", (msg) => annotationsTab.setAnnotations(msg.annotations ?? []));
    host.on("prefsChanged", (msg) => {
      ctx.prefs = msg.prefs;
      toolbar.setAutoHide(msg.prefs.toolbarAutoHide);
      if (!msg.prefs.hoverPreviews) { hover?.close(); }
    });

    // External links go through the host's scheme allow-list instead of the webview's default navigation.
    byId("viewer").addEventListener("click", (e) => {
      const a = (e.target as Element).closest?.("a[href]");
      const href = a?.getAttribute("href") ?? "";
      if (!/^(https?:|mailto:)/i.test(href)) { return; }
      e.preventDefault();
      e.stopPropagation();
      host.post({ command: "openExternalLink", url: href });
    }, true);

    eventBus.on("pagechanging", ({ pageNumber }: { pageNumber: number }) => {
      host.post({ command: "pageChanged", pageNumber });
    });

    // Restore waits for both the laid-out pages and the host's init; whichever arrives second triggers it.
    let pagesReady = false;
    let restored = false;
    // If the host answers late and the reader has already started moving, restoring would yank the page from under them.
    let readerMoved = false;
    const markMoved = (): void => { readerMoved = true; };
    for (const type of ["wheel", "touchmove", "pointerdown"] as const) {
      container.addEventListener(type, markMoved, { passive: true, once: true });
    }
    document.addEventListener("keydown", markMoved, { passive: true, once: true });
    const applyInit = (msg: InitMessage): void => {
      ctx.prefs = msg.prefs;
      toolbar.setAutoHide(msg.prefs.toolbarAutoHide);
      theme.apply(msg.theme, msg.effectiveTheme);
      annotationsTab.setAnnotations(msg.annotations);
      if (!pagesReady || restored) { return; }
      restored = true;
      const reading = msg.prefs.restorePosition && !readerMoved ? msg.reading : null;
      if (reading) {
        pdfViewer.currentScaleValue = reading.scaleValue;
        const pageNumber = clampPage(reading.page, pdfDocument.numPages);
        pdfViewer.scrollPageIntoView(reading.top !== undefined
          ? { pageNumber, destArray: [null, { name: "XYZ" }, reading.left ?? null, reading.top, null], allowNegativeOffset: true }
          : { pageNumber });
        if (reading.sidebar) {
          sidebar.restore(reading.sidebar);
          toolbar.setSidebarOpen(reading.sidebar.open);
        }
      }
      reporter.start();
    };
    onInit = applyInit;

    eventBus.on("pagesinit", () => {
      perf.mark("pagesInit");
      pagesReady = true;
      pdfViewer.currentScaleValue = ctx.prefs.defaultZoom;
      // pdf.js aligns page one with the container's top edge, i.e. underneath the overlay toolbar; start above it instead.
      container.scrollTop = 0;
      loadingMsg.hidden = true;
      container.focus({ preventScroll: true });
      host.post({ command: "ready", totalPages: pdfDocument.numPages });
      if (init) { applyInit(init); }
    });

    // Report the open timeline to the host once the first page is on screen, so
    // slow opens can be diagnosed from app.log without opening DevTools.
    let firstRenderReported = false;
    eventBus.on("pagerendered", ({ source, pageNumber }: { source?: { canvas?: HTMLCanvasElement }; pageNumber: number }) => {
      if (firstRenderReported) { return; }
      firstRenderReported = true;
      perf.mark("firstPageRendered");
      const cv = source?.canvas;
      host.post({
        command: "perf",
        timeline: perf.timeline,
        pageNumber,
        theme: theme.effective,
        dpr: window.devicePixelRatio,
        canvas: cv ? `${cv.width}x${cv.height}` : null,
      });
      // Nothing below is needed to read page one.
      requestIdleCallback(() => {
        const pageText = new PageTextCache(ctx);
        const floats = new FloatResolver(pageText);
        const citations = new CitationResolver(pageText);
        hover = new HoverPreview(ctx, citations, floats, new DestPreview(ctx, theme));
        // The reference list is located and captions are indexed in the background, so the first hover answers at once.
        if (ctx.prefs.hoverPreviews) { citations.warmUp(); floats.warmUp(); }
      });
    });
  }

  return start().catch((err: unknown) => {
    loadingMsg.hidden = true;
    errorMsg.hidden = false;
    errorMsg.textContent = describeLoadError(err);
    throw err;
  });
}
