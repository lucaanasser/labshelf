/**
 * Top-level barrel export for all UI components: the library tree, list panel, settings panel, and placeholder sidebar sections.
 *
 * @depends ui/library/index.ts, ui/list/index.ts, ui/settings/index.ts, ui/sidebar/index.ts
 * @dependents none (extension.ts imports each submodule barrel directly)
 */
export { LibraryTreeDataProvider, LibraryDragAndDropController } from './library/index.js';
export type { LibraryNode } from './library/index.js';
export { ListWebviewPanel } from './list/index.js';
export { SettingsWebviewPanel } from './settings/index.js';
export {
  WritingTreeDataProvider,
  ReadingTreeDataProvider,
  InsightsTreeDataProvider,
  AssistTreeDataProvider,
  AgentsTreeDataProvider,
} from './sidebar/index.js';
