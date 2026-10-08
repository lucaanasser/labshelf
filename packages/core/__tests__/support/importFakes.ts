/** A fake PDF parser and app index for tests of the import mutations. */
import { doiLookup, type ImportDeps, type ParsedImport, type PaperRecord } from "@labshelf/core";

export const ATTENTION: ParsedImport = {
  title: "Attention Is All You Need",
  citeKey: "vaswani2017attention",
  confidence: "high",
  source: "xmp",
  year: 2017,
  authors: ["Ashish Vaswani", "Noam Shazeer"],
  journal: "NeurIPS",
  doi: "10.5555/3295222.3295349",
};

export interface FakeImportDeps extends ImportDeps {
  parse: jest.Mock<Promise<ParsedImport>, [Uint8Array, string]>;
}

/** @returns deps whose index holds `known` and whose parser returns ATTENTION unless mocked otherwise */
export function makeImportDeps(known: Array<Pick<PaperRecord, "id" | "doi">> = []): FakeImportDeps {
  const findByDoi = doiLookup(known);
  return {
    parse: jest.fn(async (_bytes: Uint8Array, _stem: string): Promise<ParsedImport> => ({ ...ATTENTION })),
    findByDoi,
    takenIds: () => known.map((paper) => paper.id),
  };
}
