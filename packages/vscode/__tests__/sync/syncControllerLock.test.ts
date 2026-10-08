import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { EventBus } from '@labshelf/core';
import { FakeRemoteProvider } from '@labshelf/core/test-support/sync-fakes';

const provider = new FakeRemoteProvider();

// The real Drive auth needs the gitignored OAuth credentials and the keychain; a signed-in stand-in is enough here.
jest.mock('../../src/sync/auth/googleDriveAuth', () => ({
  GoogleDriveAuth: class {
    async loadPersistedState(): Promise<void> {}
    isAuthenticated(): boolean { return true; }
    async getAccessToken(): Promise<string> { return 'token'; }
    async authenticate(): Promise<void> {}
    async revoke(): Promise<void> {}
  },
}));

jest.mock('@labshelf/core', () => ({
  ...jest.requireActual('@labshelf/core'),
  createGoogleDriveProvider: () => provider,
}));

import { SyncController } from '../../src/sync/adapter/syncController';
import { LibraryPaths } from '../../src/storage/paths/libraryPaths';

function context(): vscode.ExtensionContext {
  return { subscriptions: [], secrets: { get: async () => undefined } } as unknown as vscode.ExtensionContext;
}

function makeController(root: string): SyncController {
  return new SyncController(context(), new LibraryPaths(vscode.Uri.file(root)), new EventBus(), async () => new Map());
}

function lockFile(root: string): string {
  return path.join(root, '.research', 'sync', 'google-drive.lock');
}

describe('SyncController and the cross-app sync lock', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'labshelf-lock-'));
    fs.mkdirSync(path.join(root, '.research', 'sync'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function holdLockAsTerminal(): void {
    const now = new Date().toISOString();
    fs.writeFileSync(lockFile(root), JSON.stringify({
      app: 'terminal', pid: process.pid, host: os.hostname(), token: 'terminal-token', acquiredAt: now, heartbeatAt: now,
    }));
  }

  it('does not sync while the terminal app holds the lock, and says so on a manual sync', async () => {
    holdLockAsTerminal();
    const listSpy = jest.spyOn(provider, 'list');
    const controller = makeController(root);

    await controller.sync('manual');

    expect(listSpy).not.toHaveBeenCalled();
    expect(vscode.window.setStatusBarMessage).toHaveBeenCalledWith(
      expect.stringContaining('terminal app is syncing'), expect.any(Number),
    );
    expect(JSON.parse(fs.readFileSync(lockFile(root), 'utf8')).token).toBe('terminal-token');
    expect(controller.isSyncing()).toBe(false);
    controller.dispose();
  });

  it('syncs against the new library after setPaths, not the one it was built with', async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'labshelf-lock-other-'));
    fs.mkdirSync(path.join(other, '.research', 'sync'), { recursive: true });
    try {
      holdLockAsTerminal();
      const listSpy = jest.spyOn(provider, 'list');
      const controller = makeController(root);

      controller.setPaths(new LibraryPaths(vscode.Uri.file(other)));
      await controller.sync('manual');

      expect(listSpy).toHaveBeenCalled();
      expect(JSON.parse(fs.readFileSync(lockFile(root), 'utf8')).token).toBe('terminal-token');
      controller.dispose();
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  it('stays quiet when an automatic sync finds the lock taken', async () => {
    holdLockAsTerminal();
    const controller = makeController(root);
    await controller.sync('auto');
    expect(vscode.window.setStatusBarMessage).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('syncs, records the run for the other apps and releases the lock', async () => {
    const controller = makeController(root);
    await controller.sync('manual');

    expect(fs.existsSync(lockFile(root))).toBe(false);
    const lastRun = (vscode.workspace.fs.writeFile as jest.Mock).mock.calls
      .find(([uri]) => (uri as vscode.Uri).fsPath.endsWith('google-drive.last.json'));
    expect(lastRun).toBeDefined();
    expect(JSON.parse(Buffer.from(lastRun![1] as Uint8Array).toString('utf8'))).toMatchObject({ app: 'vscode', providerId: 'fake' });
    controller.dispose();
  });

  it('takes over a lock left by a process that is gone', async () => {
    const stale = new Date(Date.now() - 10 * 60_000).toISOString();
    fs.writeFileSync(lockFile(root), JSON.stringify({
      app: 'terminal', pid: 999_999, host: 'another-host', token: 'old', acquiredAt: stale, heartbeatAt: stale,
    }));
    const listSpy = jest.spyOn(provider, 'list');
    const controller = makeController(root);
    await controller.sync('manual');
    expect(listSpy).toHaveBeenCalled();
    expect(fs.existsSync(lockFile(root))).toBe(false);
    controller.dispose();
  });
});
