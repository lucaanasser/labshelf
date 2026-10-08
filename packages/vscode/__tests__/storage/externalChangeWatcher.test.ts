import * as vscode from 'vscode';

import { libraryLayout, type PaperRecord } from '@labshelf/core';
import { ExternalChangeWatcher, findMissingPapers } from '../../src/storage/data/externalChangeWatcher';

const watchers = (vscode as unknown as { _fileWatchers: Array<{ pattern: { base: vscode.Uri; pattern: string }; _fire(kind: string, uri: vscode.Uri): void; dispose: jest.Mock }> })._fileWatchers;

function paper(id: string, folder: string): PaperRecord {
  return { id, title: id, path: folder, citeKey: id, status: 'unread' };
}

beforeEach(() => {
  watchers.length = 0;
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('ExternalChangeWatcher', () => {
  it('watches the papers folder and the sidecars', () => {
    const watcher = new ExternalChangeWatcher(libraryLayout(vscode.Uri.file('/lib'), vscode.Uri.joinPath), jest.fn());
    expect(watchers.map((w) => [w.pattern.base.fsPath, w.pattern.pattern])).toEqual([
      ['/lib/papers', '**'],
      ['/lib/.research/papers', '**/data.json'],
    ]);
    watcher.dispose();
    expect(watchers.every((w) => w.dispose.mock.calls.length === 1)).toBe(true);
  });

  it('coalesces a burst of file events into one callback', () => {
    const onChange = jest.fn();
    const watcher = new ExternalChangeWatcher(libraryLayout(vscode.Uri.file('/lib'), vscode.Uri.joinPath), onChange, 500);
    for (let i = 0; i < 20; i++) {
      watchers[0]!._fire('create', vscode.Uri.file(`/lib/papers/ml/p${i}/metadata.yaml`));
    }
    watchers[1]!._fire('change', vscode.Uri.file('/lib/.research/papers/p1/data.json'));
    jest.advanceTimersByTime(499);
    expect(onChange).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    watcher.dispose();
  });

  it('ignores the hidden temp files of atomic writes', () => {
    const onChange = jest.fn();
    const watcher = new ExternalChangeWatcher(libraryLayout(vscode.Uri.file('/lib'), vscode.Uri.joinPath), onChange, 10);
    watchers[0]!._fire('create', vscode.Uri.file('/lib/papers/p/.metadata.yaml.123.tmp'));
    watchers[0]!._fire('change', vscode.Uri.file('/lib/papers/.DS_Store'));
    jest.advanceTimersByTime(50);
    expect(onChange).not.toHaveBeenCalled();
    watcher.dispose();
  });

  it('stops calling back after dispose', () => {
    const onChange = jest.fn();
    const watcher = new ExternalChangeWatcher(libraryLayout(vscode.Uri.file('/lib'), vscode.Uri.joinPath), onChange, 10);
    watchers[0]!._fire('delete', vscode.Uri.file('/lib/papers/p/metadata.yaml'));
    watcher.dispose();
    jest.advanceTimersByTime(50);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('findMissingPapers', () => {
  it('returns the ids whose folder lost its metadata.yaml', async () => {
    const present = new Set(['/lib/papers/a']);
    const missing = await findMissingPapers(
      [paper('a', '/lib/papers/a'), paper('b', '/lib/papers/b')],
      async (folder) => present.has(folder),
    );
    expect(missing).toEqual(['b']);
  });
});
