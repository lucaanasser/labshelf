/**
 * Barrel export for the ui/library module, exposing the tree data provider, drag-and-drop controller, folder helpers, and the LibraryNode type.
 *
 * @depends ui/library/libraryTreeDataProvider.ts, ui/library/folderNavigation.ts, ui/library/collectionFolders.ts
 * @dependents ui/index.ts, extension.ts
 */
export { LibraryTreeDataProvider, LibraryDragAndDropController } from './libraryTreeDataProvider.js';
export { readCollectionFolders, listAllCollectionFolders } from './collectionFolders.js';
export { buildListState, breadcrumbFor, countPapersUnder, rootNode, ROOT_LABEL } from './folderNavigation.js';
export type { LibraryNode, ListPanelState, ListPaper, SubfolderEntry } from './folderNavigation.js';
