/**
 * Inline images in the terminal, used for the first-page thumbnail in the preview pane. Supports the kitty graphics
 * protocol (kitty, Ghostty) and the iTerm2 inline image protocol (iTerm2, WezTerm, VS Code's terminal with
 * terminal.integrated.enableImages). Anything else gets no image and the preview falls back to text.
 *
 * @depends none
 * @dependents ui/app, ui/views/preview
 */

export type ImageProtocol = "kitty" | "iterm" | "none";

export interface CellRect {
  x: number;
  y: number;
  cols: number;
  rows: number;
}

/**
 * Picks the image protocol for this terminal; `preference` ("auto", "kitty", "iterm", "off") comes from
 * LABSHELF_IMAGES or the config file.
 * @usedBy app/context
 * @returns the protocol to use
 */
export function detectImageProtocol(env: NodeJS.ProcessEnv, preference = "auto"): ImageProtocol {
  if (preference === "off" || preference === "none") { return "none"; }
  if (preference === "kitty" || preference === "iterm") { return preference; }
  // Inside tmux or screen the escapes would need passthrough wrapping; stay safe unless forced.
  if (env["TMUX"] || (env["TERM"] ?? "").startsWith("screen")) { return "none"; }
  const term = env["TERM"] ?? "";
  const program = env["TERM_PROGRAM"] ?? "";
  if (term === "xterm-kitty" || env["KITTY_WINDOW_ID"] || program === "ghostty" || term === "xterm-ghostty") {
    return "kitty";
  }
  if (program === "iTerm.app" || env["LC_TERMINAL"] === "iTerm2" || program === "WezTerm") { return "iterm"; }
  return "none";
}

/**
 * Width and height of a PNG from its IHDR chunk.
 * @usedBy fitImage callers
 * @returns pixel size, or undefined for something that is not a PNG
 */
export function pngSize(png: Uint8Array): { width: number; height: number } | undefined {
  if (png.length < 24 || png[0] !== 0x89 || png[1] !== 0x50 || png[2] !== 0x4e || png[3] !== 0x47) { return undefined; }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * The largest cell box inside `box` that keeps the image's aspect ratio, centered horizontally.
 * cellAspect is a cell's height divided by its width (about 2 in most fonts).
 * @usedBy ui/app
 * @returns the target rectangle
 */
export function fitImage(image: { width: number; height: number }, box: CellRect, cellAspect = 2.1): CellRect {
  if (box.cols <= 0 || box.rows <= 0 || image.width <= 0 || image.height <= 0) {
    return { ...box, cols: 0, rows: 0 };
  }
  // Work in "cell widths": a row is cellAspect widths tall.
  const scale = Math.min(box.cols / image.width, (box.rows * cellAspect) / image.height);
  const cols = Math.max(1, Math.min(box.cols, Math.floor(image.width * scale)));
  const rows = Math.max(1, Math.min(box.rows, Math.floor((image.height * scale) / cellAspect)));
  return { x: box.x + Math.floor((box.cols - cols) / 2), y: box.y, cols, rows };
}

const KITTY_CHUNK = 4096;

/**
 * Escape sequence that draws a PNG at a cell rectangle.
 * @usedBy ui/app
 * @returns the bytes to write after the frame
 */
export function drawImage(protocol: ImageProtocol, png: Uint8Array, rect: CellRect, imageId = 1): string {
  if (protocol === "none" || rect.cols <= 0 || rect.rows <= 0) { return ""; }
  const move = `\x1b[${rect.y + 1};${rect.x + 1}H`;
  const data = Buffer.from(png).toString("base64");
  if (protocol === "iterm") {
    return `${move}\x1b]1337;File=inline=1;size=${png.length};width=${rect.cols};height=${rect.rows};preserveAspectRatio=1:${data}\x07`;
  }
  // kitty: transmit and display in one go, chunked; C=1 keeps the cursor where it is, q=2 silences replies.
  let out = move;
  for (let offset = 0; offset < data.length; offset += KITTY_CHUNK) {
    const chunk = data.slice(offset, offset + KITTY_CHUNK);
    const more = offset + KITTY_CHUNK < data.length ? 1 : 0;
    const head = offset === 0
      ? `a=T,f=100,t=d,i=${imageId},p=1,c=${rect.cols},r=${rect.rows},C=1,q=2,m=${more}`
      : `m=${more},q=2`;
    out += `\x1b_G${head};${chunk}\x1b\\`;
  }
  return out;
}

/**
 * Escape sequence that removes images. kitty images live on their own layer and are deleted; iTerm2 images are plain
 * cell content, which the caller clears by repainting the cells (see Terminal.invalidate).
 * @usedBy ui/app
 * @returns the bytes to write
 */
export function clearImages(protocol: ImageProtocol): string {
  return protocol === "kitty" ? "\x1b_Ga=d,d=A,q=2\x1b\\" : "";
}
