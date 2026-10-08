/**
 * Colors of the TUI. Only the 16 ANSI colors and SGR attributes are used, so the app takes the palette of the user's
 * terminal theme, light or dark, the way yazi's default theme does. NO_COLOR (https://no-color.org) drops colors and
 * keeps attributes.
 *
 * @depends tui/screen
 * @dependents ui/render, ui/preview, ui/overlays
 */
import type { PaperStatus } from "@labshelf/core";

import type { Style } from "../tui/screen.js";

const noColor = Boolean(process.env["NO_COLOR"]);

function c(style: Style): Style {
  if (!noColor) { return style; }
  const { fg: _fg, bg: _bg, ...rest } = style;
  return rest;
}

export const theme = {
  text: c({}),
  dim: c({ dim: true }),
  bold: c({ bold: true }),
  title: c({ bold: true }),
  brand: c({ fg: 4, bold: true }),
  crumb: c({ fg: 4 }),
  crumbCurrent: c({ fg: 4, bold: true }),
  separator: c({ dim: true }),
  collection: c({ fg: 4, bold: true }),
  count: c({ dim: true }),
  year: c({ dim: true }),
  noPdf: c({ italic: true }),
  hover: c({ reverse: true }),
  hoverParent: c({ reverse: true, dim: true }),
  selectedMark: c({ fg: 5, bold: true }),
  cutMark: c({ fg: 1, bold: true }),
  label: c({ dim: true }),
  tag: c({ fg: 6 }),
  link: c({ fg: 4, underline: true }),
  tabActive: c({ reverse: true, bold: true }),
  tabInactive: c({ dim: true }),
  error: c({ fg: 1, bold: true }),
  warn: c({ fg: 3 }),
  info: c({ fg: 2 }),
  key: c({ fg: 3, bold: true }),
  popupBorder: c({ fg: 4 }),
  popupTitle: c({ fg: 4, bold: true }),
  match: c({ fg: 3, bold: true }),
  mode: {
    NORMAL: c({ fg: 4, reverse: true, bold: true }),
    VISUAL: c({ fg: 5, reverse: true, bold: true }),
    FILTER: c({ fg: 3, reverse: true, bold: true }),
    SEARCH: c({ fg: 2, reverse: true, bold: true }),
    INPUT: c({ fg: 6, reverse: true, bold: true }),
  } as Record<string, Style>,
  status: {
    unread: c({ dim: true }),
    reading: c({ fg: 3, bold: true }),
    done: c({ fg: 2 }),
  } as Record<PaperStatus, Style>,
  annotation: {
    yellow: c({ fg: 3 }),
    green: c({ fg: 2 }),
    blue: c({ fg: 4 }),
    red: c({ fg: 1 }),
    pink: c({ fg: 5 }),
  } as Record<string, Style>,
  sync: {
    ok: c({ fg: 2 }),
    busy: c({ fg: 3 }),
    off: c({ dim: true }),
    error: c({ fg: 1 }),
  },
};

/** Status glyphs: shape and color both carry the state, so it reads without color too. */
export const STATUS_GLYPH: Record<PaperStatus, string> = { unread: "○", reading: "◐", done: "●" };
