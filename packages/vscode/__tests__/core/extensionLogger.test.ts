import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { LogEntry } from '@labshelf/core';
import { createExtensionLogger } from '../../src/core/extensionLogger';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'labshelf-logger-'));
});

afterEach(async () => {
  jest.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('createExtensionLogger', () => {
  it('keeps every entry of parallel log calls in the file and the database', async () => {
    const file = path.join(dir, 'logs', 'app.log');
    const stored: LogEntry[] = [];
    const logger = createExtensionLogger(file, { append: async (entry) => { stored.push(entry); } });

    await Promise.all(Array.from({ length: 30 }, (_, i) => logger.log('INFO', 'test', `m${i}`)));

    const lines = (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as LogEntry);
    expect(lines.map((e) => e.message)).toEqual(Array.from({ length: 30 }, (_, i) => `m${i}`));
    expect(stored).toHaveLength(30);
  });

  it('appends to an existing log instead of rewriting it', async () => {
    const file = path.join(dir, 'app.log');
    await fs.writeFile(file, 'previous line\n');
    await createExtensionLogger(file, { append: async () => {} }).log('INFO', 'test', 'next');
    const text = await fs.readFile(file, 'utf8');
    expect(text.startsWith('previous line\n')).toBe(true);
    expect(text.trim().split('\n')).toHaveLength(2);
  });

  it('still reaches the database when the file cannot be written, and reports to the console', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const blocker = path.join(dir, 'blocker');
    await fs.writeFile(blocker, '');
    const stored: LogEntry[] = [];
    const logger = createExtensionLogger(path.join(blocker, 'app.log'), { append: async (entry) => { stored.push(entry); } });

    await expect(logger.log('WARN', 'test', 'lost on disk')).resolves.toBeUndefined();

    expect(stored.map((e) => e.message)).toEqual(['lost on disk']);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it('does not reject when the database fails and the file still gets the entry', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const file = path.join(dir, 'app.log');
    const logger = createExtensionLogger(file, { append: async () => { throw new Error('db closed'); } });
    await expect(logger.log('INFO', 'test', 'hello')).resolves.toBeUndefined();
    expect(await fs.readFile(file, 'utf8')).toContain('"message":"hello"');
  });
});
