import * as vscode from 'vscode';
import { FileSystemService } from '../../src/storage/fileSystemService';

function makeUri(fsPath: string): vscode.Uri {
  return vscode.Uri.file(fsPath);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('FileSystemService.ensureDirectory', () => {
  it('calls vscode.workspace.fs.createDirectory with the given URI', async () => {
    const svc = new FileSystemService();
    const uri = makeUri('/tmp/test-dir');
    (vscode.workspace.fs.createDirectory as jest.Mock).mockResolvedValue(undefined);

    await svc.ensureDirectory(uri);

    expect(vscode.workspace.fs.createDirectory).toHaveBeenCalledWith(uri);
  });

  it('throws a descriptive error when createDirectory fails', async () => {
    const svc = new FileSystemService();
    const uri = makeUri('/tmp/no-perm');
    (vscode.workspace.fs.createDirectory as jest.Mock).mockRejectedValue(new Error('EACCES'));

    await expect(svc.ensureDirectory(uri)).rejects.toThrow('Failed to ensure directory');
  });
});

describe('FileSystemService.writeText', () => {
  it('writes UTF-8 encoded buffer to the given URI', async () => {
    const svc = new FileSystemService();
    const uri = makeUri('/tmp/file.txt');
    (vscode.workspace.fs.writeFile as jest.Mock).mockResolvedValue(undefined);

    await svc.writeText(uri, 'hello');

    expect(vscode.workspace.fs.writeFile).toHaveBeenCalledWith(
      uri,
      Buffer.from('hello', 'utf8'),
    );
  });
});

describe('FileSystemService.readText', () => {
  it('reads file and decodes UTF-8', async () => {
    const svc = new FileSystemService();
    const uri = makeUri('/tmp/file.txt');
    (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(Buffer.from('world', 'utf8'));

    const result = await svc.readText(uri);

    expect(result).toBe('world');
  });
});
