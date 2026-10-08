/** Public API of the library tree: data provider, drag-and-drop, folder helpers and the folder-name input check. */
export { LibraryTreeDataProvider, LibraryDragAndDropController } from './libraryTreeDataProvider.js';
export { readCollectionFolders, listAllCollectionFolders } from './collectionFolders.js';
export { buildListState, breadcrumbFor, countPapersUnder, rootNode, ROOT_LABEL } from './folderNavigation.js';
export type { LibraryNode, ListPanelState, ListPaper, SubfolderEntry } from './folderNavigation.js';
export { validateFolderNameInput } from './folderNameInput.js';
