/**
 * The reader's DOM skeleton: every container the reader UI looks up by id. Both hosts emit exactly this markup inside
 * <body> (VS Code from PdfRenderer, the browser from its static reader/index.html), so the UI sees the same document.
 */

/** Markup of <body> before the boot block and scripts. */
export const READER_SHELL_BODY = `<div id="app">
  <aside id="sidebar" aria-label="Sidebar" hidden></aside>
  <div id="sidebar-resizer" hidden></div>
  <main id="pdf-shell">
    <div id="toolbar" role="toolbar" aria-label="Reader"></div>
    <div id="find-bar" role="search"></div>
    <div id="viewerContainer" tabindex="0"><div id="viewer" class="pdfViewer"></div></div>
    <div id="status-pill"></div>
    <div id="loading-msg">Loading PDF...</div>
    <div id="error-msg" role="alert" hidden></div>
  </main>
</div>
<div id="selection-toolbar" role="toolbar" aria-label="Selection"></div>
<div id="hover-popup" role="tooltip"></div>
<div id="cheatsheet"></div>`;
