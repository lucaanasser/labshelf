/** Imports picked PDFs and folders through the core import, putting each added paper in the index as it lands. */
import { EVENTS, doiLookup, importPaths } from "@labshelf/core";
import type {
  EventBus,
  IResearchDatabase,
  ImportDeps,
  ImportOutcome,
  ImportProgress,
  MutationContext,
  PdfParse,
} from "@labshelf/core";

export class PaperImporter {
  constructor(
    private readonly ctx: MutationContext,
    private readonly database: IResearchDatabase,
    private readonly eventBus: EventBus,
    private readonly parse: PdfParse,
  ) {}

  /**
   * Imports files and folders into targetDir (papers/ when absent); a PDF whose DOI is already in the library is not
   * imported again.
   * @returns one outcome per PDF found, then one per input that is neither file nor folder
   */
  async importPaths(
    inputs: string[],
    targetDir: string = this.ctx.papersRoot,
    onProgress?: (progress: ImportProgress) => void,
  ): Promise<ImportOutcome[]> {
    const papers = await this.database.listPapers();
    const deps: ImportDeps = {
      parse: this.parse,
      findByDoi: doiLookup(papers),
      takenIds: () => papers.map((paper) => paper.id),
    };
    return importPaths(this.ctx, deps, inputs, targetDir, {
      ...(onProgress ? { onProgress } : {}),
      onOutcome: async (outcome) => {
        if (outcome.status !== "added") { return; }
        await this.database.upsertPaper(outcome.record);
        this.eventBus.emit(EVENTS.PAPER_ADDED, outcome.record);
      },
    });
  }
}
