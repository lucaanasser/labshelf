const nodePath = require('path');

// ─── Uri ─────────────────────────────────────────────────────────────────────

class Uri {
  constructor(scheme, authority, path, query, fragment) {
    this.scheme = scheme || 'file';
    this.authority = authority || '';
    this.path = path || '';
    this.query = query || '';
    this.fragment = fragment || '';
    this.fsPath = path || '';
  }

  static file(fsPath) {
    const u = new Uri('file', '', fsPath, '', '');
    u.fsPath = fsPath;
    return u;
  }

  static parse(raw, strict) {
    try {
      const url = new URL(raw);
      const fsPath = decodeURIComponent(url.pathname);
      const u = new Uri(url.protocol.replace(':', ''), url.host, fsPath, url.search, url.hash);
      u.fsPath = fsPath;
      return u;
    } catch {
      const u = new Uri('file', '', raw, '', '');
      u.fsPath = raw;
      return u;
    }
  }

  static joinPath(base, ...segments) {
    const joined = nodePath.join(base.fsPath, ...segments);
    return Uri.file(joined);
  }

  toString() {
    return `${this.scheme}://${this.authority}${this.path}`;
  }
}

// ─── FileType ─────────────────────────────────────────────────────────────────

const FileType = {
  Unknown: 0,
  File: 1,
  Directory: 2,
  SymbolicLink: 64,
};

// ─── workspace.fs ─────────────────────────────────────────────────────────────

const fs = require('fs');

const workspaceFs = {
  readFile: jest.fn(async (uri) => Buffer.from(fs.readFileSync(uri.fsPath))),
  writeFile: jest.fn(async () => {}),
  stat: jest.fn(async (uri) => ({ type: FileType.File, ctime: 0, mtime: 0, size: 0 })),
  readDirectory: jest.fn(async (_uri) => []),
  createDirectory: jest.fn(async () => {}),
  delete: jest.fn(async () => {}),
};

const workspace = {
  fs: workspaceFs,
  workspaceFolders: undefined,
};

// ─── ColorThemeKind ───────────────────────────────────────────────────────────

const ColorThemeKind = {
  Light: 1,
  Dark: 2,
  HighContrast: 3,
  HighContrastLight: 4,
};

// ─── WebviewPanel mock ────────────────────────────────────────────────────────

function makeWebviewPanel(viewType, title, column, options) {
  const messageListeners = [];
  const disposeListeners = [];
  const webview = {
    html: '',
    cspSource: 'vscode-resource:',
    options: options || {},
    asWebviewUri: jest.fn((uri) => ({
      toString: () => `vscode-resource:${uri.fsPath || uri.path || uri}`,
    })),
    postMessage: jest.fn(async () => true),
    onDidReceiveMessage: jest.fn((handler) => {
      messageListeners.push(handler);
      return { dispose: () => {} };
    }),
    _fireMessage: (msg) => messageListeners.forEach(l => l(msg)),
  };
  const panel = {
    viewType,
    title,
    webview,
    active: true,
    visible: true,
    viewColumn: column,
    options: options || {},
    reveal: jest.fn(),
    dispose: jest.fn(() => disposeListeners.forEach(l => l())),
    onDidDispose: jest.fn((handler) => {
      disposeListeners.push(handler);
      return { dispose: () => {} };
    }),
    onDidChangeViewState: jest.fn(() => ({ dispose: () => {} })),
    _disposeListeners: disposeListeners,
  };
  return panel;
}

// ─── Theme change emitter ─────────────────────────────────────────────────────

const _themeChangeListeners = [];

// ─── window ───────────────────────────────────────────────────────────────────

const window = {
  showOpenDialog: jest.fn(async () => undefined),
  showWarningMessage: jest.fn(async () => undefined),
  showInformationMessage: jest.fn(async () => undefined),
  showErrorMessage: jest.fn(async () => undefined),
  setStatusBarMessage: jest.fn(() => ({ dispose: () => {} })),
  withProgress: jest.fn(async (_options, task) => task({ report: jest.fn() }, { isCancellationRequested: false })),
  registerTreeDataProvider: jest.fn(() => ({ dispose: () => {} })),
  createTreeView: jest.fn(() => ({ dispose: () => {}, onDidChangeSelection: jest.fn() })),
  showInputBox: jest.fn(async () => undefined),
  showQuickPick: jest.fn(async () => undefined),
  createWebviewPanel: jest.fn((viewType, title, column, options) => makeWebviewPanel(viewType, title, column, options)),
  activeColorTheme: { kind: ColorThemeKind.Dark },
  onDidChangeActiveColorTheme: jest.fn((handler) => {
    _themeChangeListeners.push(handler);
    return { dispose: () => {
      const idx = _themeChangeListeners.indexOf(handler);
      if (idx >= 0) _themeChangeListeners.splice(idx, 1);
    }};
  }),
  _fireThemeChange: (kind) => _themeChangeListeners.forEach(l => l({ kind })),
};

// ─── commands ─────────────────────────────────────────────────────────────────

const commands = {
  registerCommand: jest.fn((id, handler) => ({ command: id, handler, dispose: () => {} })),
  executeCommand: jest.fn(async () => undefined),
};

// ─── env ──────────────────────────────────────────────────────────────────────

const env = {
  clipboard: { writeText: jest.fn(async () => {}), readText: jest.fn(async () => '') },
};

// ─── ProgressLocation ─────────────────────────────────────────────────────────

const ProgressLocation = {
  Notification: 15,
  Window: 10,
  SourceControl: 1,
};

// ─── TreeItem ─────────────────────────────────────────────────────────────────

class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
};

// ─── ThemeIcon ────────────────────────────────────────────────────────────────

class ThemeIcon {
  constructor(id) { this.id = id; }
}

// ─── EventEmitter ─────────────────────────────────────────────────────────────

class EventEmitter {
  constructor() { this._listeners = []; this.event = (cb) => this._listeners.push(cb); }
  fire(data) { this._listeners.forEach(l => l(data)); }
  dispose() { this._listeners = []; }
}

// ─── DataTransfer (for DnD tests) ─────────────────────────────────────────────

class DataTransferItem {
  constructor(value) { this._value = value; }
  async asString() { return this._value; }
  asFile() { return null; }
  get value() { return this._value; }
}

class DataTransfer {
  constructor(entries) { this._map = new Map(Object.entries(entries || {})); }
  get(mimeType) { return this._map.has(mimeType) ? new DataTransferItem(this._map.get(mimeType)) : undefined; }
  set(mimeType, value) { this._map.set(mimeType, value); }
  [Symbol.iterator]() { return this._map.entries(); }
}

// ─── CancellationToken ────────────────────────────────────────────────────────

const CancellationToken = { None: { isCancellationRequested: false } };

module.exports = {
  Uri,
  FileType,
  workspace,
  window,
  commands,
  env,
  ProgressLocation,
  TreeItem,
  TreeItemCollapsibleState,
  ThemeIcon,
  EventEmitter,
  DataTransfer,
  DataTransferItem,
  CancellationToken,
  ColorThemeKind,
  ViewColumn: { One: 1, Two: 2, Active: -1 },
  WebviewPanel: class {},
  makeWebviewPanel,
  _themeChangeListeners,
};
