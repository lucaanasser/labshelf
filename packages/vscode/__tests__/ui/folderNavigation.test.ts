import {
  breadcrumbFor,
  buildListState,
  countPapersUnder,
  relativeFolder,
  rootNode,
  ROOT_LABEL,
} from '../../src/ui/library/folderNavigation';
import type { PaperRecord } from '@labshelf/core';

const ROOT = '/lib/papers';

function paper(id: string, dir: string): PaperRecord {
  return { id, title: id, path: `${dir}/${id}`, citeKey: id, authors: [], status: 'unread' } as unknown as PaperRecord;
}

describe('breadcrumbFor', () => {
  it('returns only the root for papers/ itself', () => {
    expect(breadcrumbFor(ROOT, ROOT, '/')).toEqual([{ label: ROOT_LABEL, dirPath: ROOT, isRoot: true }]);
  });

  it('lists every ancestor root-first for a nested folder', () => {
    const chain = breadcrumbFor(ROOT, `${ROOT}/Project/Refs`, '/');
    expect(chain.map((c) => c.label)).toEqual([ROOT_LABEL, 'Project', 'Refs']);
    expect(chain.map((c) => c.dirPath)).toEqual([ROOT, `${ROOT}/Project`, `${ROOT}/Project/Refs`]);
  });

  it('falls back to the root for a path outside papers/', () => {
    expect(breadcrumbFor(ROOT, '/elsewhere/x', '/')).toHaveLength(1);
  });

  it('does not treat a sibling with a shared prefix as inside the root', () => {
    expect(breadcrumbFor(ROOT, '/lib/papers-old/x', '/')).toHaveLength(1);
  });

  it('honours a Windows separator', () => {
    const chain = breadcrumbFor('C:\\lib\\papers', 'C:\\lib\\papers\\A\\B', '\\');
    expect(chain.map((c) => c.label)).toEqual([ROOT_LABEL, 'A', 'B']);
  });
});

describe('countPapersUnder', () => {
  it('counts papers at any depth and ignores prefix look-alikes', () => {
    const paths = [`${ROOT}/A/p1`, `${ROOT}/A/B/p2`, `${ROOT}/AB/p3`, `${ROOT}/p4`];
    expect(countPapersUnder(paths, `${ROOT}/A`, '/')).toBe(2);
    expect(countPapersUnder(paths, ROOT, '/')).toBe(4);
  });
});

describe('relativeFolder', () => {
  it('is empty for a paper directly in the folder', () => {
    expect(relativeFolder(`${ROOT}/A/p1`, `${ROOT}/A`, '/')).toBe('');
  });

  it('names the holding folder relative to the open one', () => {
    expect(relativeFolder(`${ROOT}/A/B/C/p1`, `${ROOT}/A`, '/')).toBe('B / C');
  });
});

describe('buildListState', () => {
  const papers = [paper('p1', `${ROOT}/A`), paper('p2', `${ROOT}/A/B`), paper('p3', `${ROOT}/Z`), paper('p4', ROOT)];

  it('opens a non-leaf folder with its own papers, nested papers, and counted subfolders', () => {
    const folder = { label: 'A', dirPath: `${ROOT}/A` };
    const state = buildListState(papers, folder, ROOT, [{ label: 'B', dirPath: `${ROOT}/A/B` }], '/');

    expect(state.type).toBe('state');
    expect(state.papers.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(state.papers.map((p) => p.relFolder)).toEqual(['', 'B']);
    expect(state.papers[1]?.folderPath).toBe(`${ROOT}/A/B`);
    expect(state.subfolders).toEqual([{ label: 'B', dirPath: `${ROOT}/A/B`, count: 1 }]);
    expect(state.breadcrumb.map((c) => c.label)).toEqual([ROOT_LABEL, 'A']);
  });

  it('shows the whole library, including unfiled papers, at the root', () => {
    const state = buildListState(papers, rootNode(ROOT), ROOT, [], '/');
    expect(state.papers).toHaveLength(4);
    expect(state.papers.find((p) => p.id === 'p4')?.relFolder).toBe('');
    expect(state.papers.find((p) => p.id === 'p2')?.relFolder).toBe('A / B');
  });
});
