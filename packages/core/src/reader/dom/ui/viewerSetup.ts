/**
 * Wires pdf.js' EventBus, link service, find controller and PDFViewer around the shell's #viewerContainer.
 */
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { EventBus, PDFFindController, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs" with { "resolution-mode": "import" };
import { presetFor, toPageColors } from "../../index.js";
import { decideMatchScroll, freshOrigin, type FindOrigin } from "../../logic/index.js";
import type { ViewerLib } from "./context.js";

export interface ViewerParts {
  eventBus: EventBus;
  linkService: PDFLinkService;
  findController: PDFFindController;
  pdfViewer: PDFViewer;
  /** Must be called right before a `find` event is dispatched; see ReaderFindController. */
  markFindOrigin(): void;
}

/**
 * @returns the constructed viewer parts with the document already attached.
 */
export function createViewer(
  viewerLib: ViewerLib,
  pdfDocument: PDFDocumentProxy,
  container: HTMLDivElement,
  viewer: HTMLDivElement,
  effectiveTheme: string,
): ViewerParts {
  const eventBus = new viewerLib.EventBus();
  // A link's stored zoom ("XYZ ... 0.8") would silently undo the reader's chosen zoom on every click.
  const linkService = new viewerLib.PDFLinkService({ eventBus, ignoreDestinationZoom: true });
  type ScrollMatchArgs = Parameters<PDFFindController["scrollMatchIntoView"]>[0];
  // pdf.js handles a find step in two scrolls: first the hit's page is scrolled to its top, then (once that page's
  // text layer exists) the hit is parked 50px below the container top — underneath this reader's overlay toolbar
  // and find bar. It does both even when the hit was already on screen. So: remember where the reader was when the
  // command was issued, let pdf.js finish, then either go back there (hit was readable) or place the hit properly.
  let findOrigin: FindOrigin | null = null;
  class ReaderFindController extends viewerLib.PDFFindController {
    override scrollMatchIntoView(args: ScrollMatchArgs): void {
      const element = args?.element;
      const startTop = container.scrollTop;
      super.scrollMatchIntoView(args);
      // Unchanged scroll position means pdf.js declined to scroll (not the selected hit).
      if (!element || container.scrollTop === startTop) { return; }
      const origin = freshOrigin(findOrigin, performance.now());
      findOrigin = null;
      const containerTop = container.getBoundingClientRect().top;
      const rect = element.getBoundingClientRect();
      const yNow = rect.top - containerTop;
      // Where the hit sat on screen when the command was issued.
      const shift = origin ? container.scrollTop - origin.top : 0;
      const before = origin ? { top: yNow + shift, bottom: yNow + rect.height + shift } : null;
      const decision = decideMatchScroll(before, container.clientHeight);
      if (decision.kind === "stay" && origin) {
        container.scrollTop = origin.top;
        container.scrollLeft = origin.left;
      } else if (decision.kind === "place") {
        container.scrollTop += yNow - decision.top;
      }
    }
  }
  const findController = new ReaderFindController({
    linkService,
    eventBus,
    updateMatchesCountOnProgress: true,
  });
  const preset = presetFor(effectiveTheme);
  const pdfViewer = new viewerLib.PDFViewer({
    container,
    viewer,
    eventBus,
    linkService,
    findController,
    textLayerMode: 1,
    annotationMode: 2,
    removePageBorders: false,
    // pdf.js defaults: bounded canvases, with a detail canvas keeping the visible region sharp at high zoom.
    // Uncapped canvases reach hundreds of megapixels at 8x on a HiDPI display.
    maxCanvasPixels: 2 ** 25,
    capCanvasAreaFactor: 200,
    maxCanvasDim: 32767,
    enableDetailCanvas: true,
    enableHWA: true,
    pageColors: toPageColors(preset.bg, preset.text),
  } as ConstructorParameters<ViewerLib["PDFViewer"]>[0]);
  linkService.setViewer(pdfViewer);
  linkService.setDocument(pdfDocument, null);
  // Also hands the document to the find controller.
  pdfViewer.setDocument(pdfDocument);
  const markFindOrigin = (): void => {
    findOrigin = { top: container.scrollTop, left: container.scrollLeft, at: performance.now() };
  };
  return { eventBus, linkService, findController, pdfViewer, markFindOrigin };
}
