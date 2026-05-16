/**
 * Barrel export for the ui/library module, exposing the tree data provider, drag-and-drop controller, and the LibraryNode type.
 *
 * @depends ui/library/libraryTreeDataProvider.ts
 * @dependents ui/index.ts, extension.ts
 */
export { LibraryTreeDataProvider, LibraryDragAndDropController } from './libraryTreeDataProvider.js';
export type { LibraryNode } from './libraryTreeDataProvider.js';
