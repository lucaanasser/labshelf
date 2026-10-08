/**
 * The icon every LabShelf editor tab carries (list, reader, settings): the extension's ">" mark in blue. Webview tabs
 * take no ThemeIcon or currentColor, so the colour is baked into a light- and a dark-theme SVG.
 *
 * @depends none
 * @dependents ui/list/listWebviewPanel.ts, ui/settings/settingsWebviewPanel.ts, pdf-viewer/PdfViewerPanel.ts
 */
import * as vscode from 'vscode';

/**
 * The light/dark icon pair to assign to a WebviewPanel's iconPath.
 * @usedBy ui/list/listWebviewPanel.ts, ui/settings/settingsWebviewPanel.ts, pdf-viewer/PdfViewerPanel.ts
 * @returns URIs of the blue chevron SVGs under media/
 */
export function labshelfTabIcon(extensionUri: vscode.Uri): { light: vscode.Uri; dark: vscode.Uri } {
  return {
    light: vscode.Uri.joinPath(extensionUri, 'media', 'labshelf-tab-light.svg'),
    dark: vscode.Uri.joinPath(extensionUri, 'media', 'labshelf-tab-dark.svg'),
  };
}
