/**
 * Barrel export for the ui/list module, exposing the list panel class and the HTML shell builder.
 *
 * @depends ui/list/listWebviewPanel.ts, ui/list/template.ts
 * @dependents ui/index.ts, extension.ts
 */
export { ListWebviewPanel } from './listWebviewPanel.js';
export type { ListPanelDeps } from './listWebviewPanel.js';
export { buildListPanelHtml } from './template.js';
