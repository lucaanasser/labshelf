import { validateFolderNameInput } from '../../../src/ui/library/folderNameInput';

describe('validateFolderNameInput', () => {
  it('accepts an ordinary name', () => {
    expect(validateFolderNameInput('Reading group')).toBeNull();
  });

  it.each(['', '  ', '.', '..', '.hidden', 'a/b', 'a\\b', 'bad\u0001name', 'a'.repeat(256)])('rejects %j with a message', (name) => {
    expect(validateFolderNameInput(name)).toEqual(expect.any(String));
  });
});
