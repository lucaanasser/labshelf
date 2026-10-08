/**
 * Hover previews. Two ways in, one popup out:
 *  - a PDF link annotation under the pointer (born-digital papers): a citation shows the cited reference as text,
 *    anything else (figure, equation, table, section) shows a cropped render of the link's destination;
 *  - plain text under the pointer (scans with an OCR layer, papers typeset without hyperlinks): the visual line is
 *    re-joined from its text runs and searched for a numeric citation, an author–year citation or a figure/table/
 *    equation reference, which are resolved from the reference list and from captions found in the page text.
 *
 * @depends webview/logic/{destGeometry,inTextRefs}.ts, webview/ui/{citationResolver,floatResolver,destPreview,dom,icons,context}.ts
 * @dependents webview/reader.ts
 */
import { destPoint } from "../logic/destGeometry.js";
import { findInTextRefs, joinLineParts, refAtOffset, type FloatKind, type InTextRef, type JoinedLine, type LinePart } from "../logic/inTextRefs.js";
import type { CitationResolver } from "./citationResolver.js";
import type { ReaderContext } from "./context.js";
import type { DestPreview } from "./destPreview.js";
import { byId, clamp, h, iconButton } from "./dom.js";
import type { FloatResolver } from "./floatResolver.js";
import { icon } from "./icons.js";

const CLOSE_GRACE_MS = 150;
const MAX_MARKER_ENTRIES = 3;
const LINK_SELECTOR = "section.linkAnnotation[data-internal-link]";
const TEXT_RUN_SELECTOR = 'span[role="presentation"]';
const FLOAT_TITLES: Record<FloatKind, string> = { figure: "Figure", table: "Table", equation: "Equation" };
// Hovering a caption's own label ("Figure 3.") should not pop up a picture of itself.
const SAME_PLACE_POINTS = 16;
// OCR text is one run per word, and a reader points at the word, not at a character of it: on a run this short the
// whole box answers for the one reference it belongs to ("[1])," — the pointer may sit on the comma).
const WHOLE_RUN_MAX_CHARS = 14;

type ExplicitDest = Parameters<ReaderContext["linkService"]["goToDestination"]>[0];

interface VisualLine {
  spans: HTMLElement[];
  parts: LinePart[];
  joined: JoinedLine;
  refs: InTextRef[];
}

interface LinkAnnotationData { id: string; dest?: string | unknown[] | null }

/** What a pending or visible popup belongs to. */
interface HoverTarget {
  /** Every element of the target: a link, or the text runs of a reference — OCR text is one run per word, and crossing words must neither restart nor close the popup. */
  group: Element[];
  /** The reference inside those runs; tells two references in one long run apart. Null for a link annotation. */
  ref: InTextRef | null;
  /** Where the reference sits on screen, for placing the popup. */
  rect(): DOMRect;
}

interface PopupContent {
  title: string;
  body: HTMLElement;
  copyText: string | null;
  jump: () => void;
}

function sameTarget(a: HoverTarget | null, b: HoverTarget | null): boolean {
  return a !== null && b !== null && a.group[0] === b.group[0] && a.ref?.start === b.ref?.start && a.ref?.end === b.ref?.end;
}

export class HoverPreview {
  private readonly popup = byId("hover-popup");
  private readonly pageAnnotations = new Map<number, Promise<LinkAnnotationData[]>>();
  /** Lines are rebuilt from geometry; pointer movement inside one run must not pay for that again. Spans are replaced when a page re-renders, which drops their entries. */
  private readonly lines = new WeakMap<HTMLElement, VisualLine>();
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  /** Target of the visible popup, and the one whose delay is running. */
  private open: HoverTarget | null = null;
  private pending: HoverTarget | null = null;
  /** Identifies the current pending/visible popup; async work belonging to an older one is dropped. */
  private attempt = 0;
  private lastMove: { run: HTMLElement; x: number; y: number } | null = null;
  private moveFrame = 0;

  constructor(
    private readonly ctx: ReaderContext,
    private readonly resolver: CitationResolver,
    private readonly floats: FloatResolver,
    private readonly preview: DestPreview,
  ) {
    const viewer = byId("viewer");
    viewer.addEventListener("mouseover", (e) => this.onOver(e));
    viewer.addEventListener("mouseout", (e) => this.onOut(e));
    viewer.addEventListener("mousemove", (e) => this.onTextMove(e), { passive: true });
    this.popup.addEventListener("mouseenter", () => this.cancelClose());
    this.popup.addEventListener("mouseleave", () => this.scheduleClose());
    ctx.container.addEventListener("scroll", () => this.close(), { passive: true });
    ctx.eventBus.on("scalechanging", () => this.close());
    document.addEventListener("keydown", () => this.close());
    document.addEventListener("mousedown", (e) => { if (!this.popup.contains(e.target as Node)) { this.close(); } });
  }

  /**
   * Cancels any pending open, hides the popup and discards in-flight preview work.
   * @usedBy webview/reader.ts
   * @returns void
   */
  close(): void {
    this.cancelPending();
    this.cancelClose();
    this.preview.cancel();
    this.hide();
  }

  private get enabled(): boolean { return this.ctx.prefs.hoverPreviews; }

  private hide(): void {
    this.open = null;
    this.popup.classList.remove("rd-visible");
    this.popup.replaceChildren();
  }

  private cancelPending(): void {
    this.attempt++;
    if (this.openTimer) { clearTimeout(this.openTimer); this.openTimer = null; }
    this.pending = null;
  }

  /**
   * Opens a popup for `target` once the reader has rested on it for the configured delay. The content is prepared
   * while the delay runs, so reference lookup and page rendering do not add to it.
   */
  private schedule(target: HoverTarget, prepare: (isCurrent: () => boolean) => Promise<PopupContent | null>): void {
    this.cancelPending();
    const attempt = this.attempt;
    const isCurrent = (): boolean => attempt === this.attempt;
    this.pending = target;
    const rested = new Promise<void>((resolve) => {
      this.openTimer = setTimeout(resolve, Math.max(0, this.ctx.prefs.hoverDelayMs));
    });
    // A broken destination or a failed extraction simply has no preview; the page itself is untouched.
    const content = prepare(isCurrent).catch(() => null);
    void Promise.all([rested, content]).then(([, ready]) => {
      if (!isCurrent()) { return; }
      this.openTimer = null;
      this.pending = null;
      if (ready) { this.show(target, ready); }
    });
  }

  private scheduleClose(): void {
    this.cancelClose();
    this.closeTimer = setTimeout(() => { this.closeTimer = null; this.hide(); }, CLOSE_GRACE_MS);
  }

  private cancelClose(): void {
    if (this.closeTimer) { clearTimeout(this.closeTimer); this.closeTimer = null; }
  }

  /** Leaving a target cancels its pending popup, or starts closing its open one; moving into the popup keeps it. */
  private onOut(e: MouseEvent): void {
    const from = e.target as Node;
    const to = e.relatedTarget as Node | null;
    const left = (target: HoverTarget | null): boolean =>
      target !== null && target.group.some((g) => g.contains(from))
      && !(to !== null && (this.popup.contains(to) || target.group.some((g) => g.contains(to))));
    if (left(this.pending)) { this.cancelPending(); }
    if (left(this.open)) { this.scheduleClose(); }
  }

  /* ── link annotations ─────────────────────────────────────────── */

  private onOver(e: MouseEvent): void {
    if (!this.enabled) { return; }
    const link = (e.target as Element).closest?.<HTMLElement>(LINK_SELECTOR);
    if (!link) { return; }
    const target: HoverTarget = { group: [link], ref: null, rect: () => link.getBoundingClientRect() };
    if (sameTarget(target, this.open)) { this.cancelClose(); return; }
    if (sameTarget(target, this.pending)) { return; }
    this.schedule(target, (isCurrent) => this.prepareLink(link, isCurrent));
  }

  private async prepareLink(link: HTMLElement, isCurrent: () => boolean): Promise<PopupContent | null> {
    const pageNumber = Number(link.closest<HTMLElement>(".page")?.dataset["pageNumber"]);
    const id = link.dataset["annotationId"];
    if (!pageNumber || !id) { return null; }
    const dest = (await this.annotationsFor(pageNumber)).find((a) => a.id === id)?.dest;
    if (!dest) { return null; }
    const doc = this.ctx.pdfDocument;
    const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit)) { return null; }
    const ref = explicit[0] as unknown;
    const targetPage = ref && typeof ref === "object"
      ? (await doc.getPageIndex(ref as Parameters<typeof doc.getPageIndex>[0])) + 1
      : typeof ref === "number" ? ref + 1 : 0;
    if (!targetPage || !isCurrent()) { return null; }
    const point = destPoint(explicit) ?? { x: null, y: null, kind: "Fit" };
    const jump = (): void => { void this.ctx.linkService.goToDestination(dest as ExplicitDest); };

    if (point.y !== null && await this.resolver.isInReferences(targetPage, point.y, point.x)) {
      const text = await this.resolver.entryAt(targetPage, point.y, point.x);
      if (text) { return textContent([text], jump); }
      // No reliable entry boundaries: a picture of the destination is never wrong, extracted text could be.
    }
    if (!isCurrent()) { return null; }
    const canvas = await this.preview.render(targetPage, point.x, point.y);
    return canvas ? { title: `Page ${targetPage}`, body: canvas, copyText: null, jump } : null;
  }

  private annotationsFor(pageNumber: number): Promise<LinkAnnotationData[]> {
    let p = this.pageAnnotations.get(pageNumber);
    if (!p) {
      p = this.ctx.pdfDocument.getPage(pageNumber)
        .then((page) => page.getAnnotations({ intent: "display" }))
        .then((list) => (list as Array<LinkAnnotationData & { subtype?: string }>).filter((a) => a.subtype === "Link"));
      this.pageAnnotations.set(pageNumber, p);
    }
    return p;
  }

  /* ── references in plain text (no link annotation under the pointer) ── */

  private onTextMove(e: MouseEvent): void {
    // A pressed button means the reader is selecting text, not pointing at it.
    if (!this.enabled || e.buttons !== 0) { return; }
    const run = (e.target as Element).closest?.<HTMLElement>(TEXT_RUN_SELECTOR);
    if (!run || !run.closest(".textLayer") || !(run.textContent ?? "").trim()) { return; }
    this.lastMove = { run, x: e.clientX, y: e.clientY };
    // One probe per frame, however many move events the frame carried.
    if (this.moveFrame) { return; }
    this.moveFrame = requestAnimationFrame(() => { this.moveFrame = 0; this.probeText(); });
  }

  /**
   * Decides what the pointer is on. The delay belongs to the REFERENCE, not to the pointer position: a hand never
   * holds still, and restarting the timer on every tremor made the popup wait for a stillness that does not come.
   */
  private probeText(): void {
    const move = this.lastMove;
    if (!move || !move.run.isConnected) { return; }
    const target = this.textTargetAt(move.run, move.x, move.y);
    if (target && sameTarget(target, this.open)) { this.cancelClose(); return; }
    // Inside a long run the pointer can leave a reference without leaving the element, so no mouseout says so.
    if (this.open?.ref && this.open.group.includes(move.run) && !this.closeTimer) { this.scheduleClose(); }
    if (!target) {
      if (this.pending?.ref) { this.cancelPending(); }
      return;
    }
    if (sameTarget(target, this.pending)) { return; }
    this.schedule(target, (isCurrent) => this.prepareText(target, isCurrent));
  }

  private textTargetAt(run: HTMLElement, clientX: number, clientY: number): HoverTarget | null {
    const layer = run.closest<HTMLElement>(".textLayer");
    if (!layer) { return null; }
    const line = this.lineOf(layer, run);
    const index = line.spans.indexOf(run);
    if (index < 0 || line.refs.length === 0) { return null; }
    const runStart = line.joined.starts[index] ?? 0;
    const runEnd = runStart + (line.parts[index]?.text.length ?? 0);

    let ref: InTextRef | null = null;
    const caret = document.caretRangeFromPoint(clientX, clientY);
    if (caret && run.contains(caret.startContainer)) {
      // Characters of this run that precede the pointer (the run may hold nested find-highlight spans).
      const before = document.createRange();
      before.setStart(run, 0);
      before.setEnd(caret.startContainer, caret.startOffset);
      ref = refAtOffset(line.refs, runStart + before.toString().length);
    }
    if (!ref && runEnd - runStart <= WHOLE_RUN_MAX_CHARS) {
      const touching = line.refs.filter((r) => r.start < runEnd && r.end > runStart);
      if (touching.length === 1) { ref = touching[0]!; }
    }
    if (!ref) { return null; }

    const found = ref;
    const pieces: Array<{ span: HTMLElement; from: number; to: number }> = [];
    line.spans.forEach((span, i) => {
      const start = line.joined.starts[i] ?? 0;
      const length = line.parts[i]?.text.length ?? 0;
      if (start < found.end && start + length > found.start) {
        pieces.push({ span, from: Math.max(0, found.start - start), to: Math.min(length, found.end - start) });
      }
    });
    if (pieces.length === 0) { return null; }
    return { group: pieces.map((p) => p.span), ref: found, rect: () => unionRect(pieces.map((p) => charRangeRect(p.span, p.from, p.to))) };
  }

  private lineOf(layer: HTMLElement, run: HTMLElement): VisualLine {
    const cached = this.lines.get(run);
    if (cached && cached.spans.every((s) => s.isConnected)) { return cached; }
    const line = visualLine(layer, run);
    // Kept for this run only: membership is judged from the probed run's own height, so it is not symmetric.
    this.lines.set(run, line);
    return line;
  }

  private async prepareText(target: HoverTarget, isCurrent: () => boolean): Promise<PopupContent | null> {
    const ref = target.ref;
    const pageEl = target.group[0]?.closest<HTMLElement>(".page");
    const pageNumber = Number(pageEl?.dataset["pageNumber"]);
    if (!ref || !pageEl || !pageNumber) { return null; }
    return ref.kind === "float"
      ? this.prepareFloat(target, ref, pageEl, pageNumber, isCurrent)
      : this.prepareCitation(ref);
  }

  private async prepareCitation(ref: Exclude<InTextRef, { kind: "float" }>): Promise<PopupContent | null> {
    const hits: Array<{ text: string; pageNumber: number; y: number }> = [];
    let missing = 0;
    if (ref.kind === "numeric") {
      for (const n of ref.numbers.slice(0, MAX_MARKER_ENTRIES)) {
        const hit = await this.resolver.entryNumbered(n);
        if (hit) { hits.push(hit); }
      }
      missing = ref.numbers.length - hits.length;
    } else {
      hits.push(...await this.resolver.entriesByAuthorYear(ref));
    }
    const first = hits[0];
    if (!first) { return null; }
    const texts = hits.map((hit) => hit.text);
    if (ref.kind === "numeric" && missing > 0 && ref.numbers.length > MAX_MARKER_ENTRIES) { texts.push(`+${missing} more`); }
    return textContent(texts, () => this.jumpTo(first.pageNumber, null, first.y));
  }

  private async prepareFloat(
    target: HoverTarget,
    ref: Extract<InTextRef, { kind: "float" }>,
    pageEl: HTMLElement,
    pageNumber: number,
    isCurrent: () => boolean,
  ): Promise<PopupContent | null> {
    const found = await this.floats.find(ref.floatKind, ref.label);
    if (!found || !isCurrent()) { return null; }
    if (found.pageNumber === pageNumber) {
      const view = this.ctx.pdfViewer.getPageView(pageNumber - 1) as { viewport?: { convertToPdfPoint(x: number, y: number): number[] } } | undefined;
      const at = target.rect();
      const pdfY = view?.viewport?.convertToPdfPoint(0, at.top + at.height / 2 - pageEl.getBoundingClientRect().top - pageEl.clientTop)[1];
      if (pdfY !== undefined && Math.abs(pdfY - found.captionY) < SAME_PLACE_POINTS) { return null; }
    }
    const canvas = await this.preview.renderRegion(found.pageNumber, found.region);
    if (!canvas) { return null; }
    return {
      title: `${FLOAT_TITLES[ref.floatKind]} ${ref.label.toUpperCase()} · Page ${found.pageNumber}`,
      body: canvas,
      copyText: null,
      jump: () => this.jumpTo(found.pageNumber, found.region.x0, found.region.yTop),
    };
  }

  /** Goes through the link service so the jump lands in the back/forward history like a followed link. */
  private jumpTo(pageNumber: number, x: number | null, y: number | null): void {
    const dest = [pageNumber - 1, { name: "XYZ" }, x, y, null] as unknown as ExplicitDest;
    void this.ctx.linkService.goToDestination(dest);
  }

  /* ── rendering ────────────────────────────────────────────────── */

  private show(target: HoverTarget, content: PopupContent): void {
    this.cancelClose();
    const actions = h("div", { class: "rd-hover-actions" });
    const { copyText } = content;
    if (copyText) {
      const copy = iconButton(icon("copy"), "Copy reference", "rd-btn-sm");
      copy.addEventListener("click", () => { this.ctx.host.post({ command: "copyText", text: copyText }); this.close(); });
      actions.append(copy);
    }
    const go = iconButton(icon("arrow-right"), "Jump to destination", "rd-btn-sm");
    go.addEventListener("click", () => { this.close(); content.jump(); });
    actions.append(go);

    this.open = target;
    this.popup.replaceChildren(h("div", { class: "rd-hover-header" }, h("span", {}, content.title), actions), content.body);
    this.popup.classList.add("rd-visible");
    const a = target.rect();
    const p = this.popup.getBoundingClientRect();
    const below = a.bottom + 8;
    const top = below + p.height <= window.innerHeight - 8 ? below : a.top - p.height - 8;
    this.popup.style.top = `${clamp(top, 8, Math.max(8, window.innerHeight - p.height - 8))}px`;
    this.popup.style.left = `${clamp(a.left + a.width / 2 - p.width / 2, 8, Math.max(8, window.innerWidth - p.width - 8))}px`;
  }
}

function textContent(texts: string[], jump: () => void): PopupContent {
  return { title: "Reference", body: h("div", { class: "rd-hover-text" }, ...texts.map((t) => h("p", {}, t))), copyText: texts.join("\n\n"), jump };
}

function unionRect(rects: DOMRect[]): DOMRect {
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  return new DOMRect(left, top, Math.max(...rects.map((r) => r.right)) - left, Math.max(...rects.map((r) => r.bottom)) - top);
}

/** Screen box of characters [from, to) of a run, which may hold nested find-highlight spans. */
function charRangeRect(run: HTMLElement, from: number, to: number): DOMRect {
  const range = document.createRange();
  const walker = document.createTreeWalker(run, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!started && from <= seen + length) { range.setStart(node, Math.max(0, from - seen)); started = true; }
    if (started && to <= seen + length) { range.setEnd(node, Math.max(0, to - seen)); break; }
    seen += length;
  }
  const rect = started && !range.collapsed ? range.getBoundingClientRect() : null;
  return rect && rect.width > 0 ? rect : run.getBoundingClientRect();
}

/** A run of several characters that is taller than wide is set sideways. */
function isSideways(text: string, rect: DOMRect): boolean {
  return text.trim().length > 3 && rect.height > rect.width * 1.5;
}

/**
 * The text runs that share the hovered run's visual line, left to right. pdf.js positions every run absolutely, so the
 * line is recovered from geometry rather than from DOM order.
 */
function visualLine(layer: HTMLElement, run: HTMLElement): VisualLine {
  const ref = run.getBoundingClientRect();
  if (isSideways(run.textContent ?? "", ref)) {
    // Its box spans the page's height: every run of the page would count as sharing its "line".
    const parts: LinePart[] = [{ text: run.textContent ?? "", left: ref.left, right: ref.right, height: ref.height }];
    return { spans: [run], parts, joined: joinLineParts(parts), refs: [] };
  }
  const centre = ref.top + ref.height / 2;
  const tolerance = Math.max(ref.height, 4) * 0.6;
  const spans: HTMLElement[] = [];
  const rects = new Map<HTMLElement, DOMRect>();
  for (const el of layer.querySelectorAll<HTMLElement>(TEXT_RUN_SELECTOR)) {
    const text = (el.textContent ?? "").trim();
    if (!text) { continue; }
    const r = el.getBoundingClientRect();
    // A publisher's stamp up the margin would otherwise join whichever line crosses its middle.
    if (el !== run && isSideways(text, r)) { continue; }
    if (Math.abs(r.top + r.height / 2 - centre) <= tolerance) { spans.push(el); rects.set(el, r); }
  }
  spans.sort((a, b) => rects.get(a)!.left - rects.get(b)!.left);
  const parts = spans.map((el): LinePart => {
    const r = rects.get(el)!;
    return { text: el.textContent ?? "", left: r.left, right: r.right, height: r.height };
  });
  const joined = joinLineParts(parts);
  return { spans, parts, joined, refs: findInTextRefs(joined.text) };
}
