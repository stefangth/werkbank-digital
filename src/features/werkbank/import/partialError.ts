import type { ImportResult } from "./types";

/** Thrown by an import run when a chunk fails after earlier chunks were already committed. A plain
 *  retry would duplicate those rows, so it carries what is known: `results` of the chunks that were
 *  committed and `notSentRows` (indexes into the rows given to the run) of the chunks never sent,
 *  including the one that failed. A failure in the first chunk commits nothing and is thrown as is. */
export class ImportPartialError extends Error {
  constructor(
    readonly results: ImportResult[],
    readonly notSentRows: number[],
    readonly cause: unknown,
  ) {
    super("Import interrupted after earlier chunks were saved");
    this.name = "ImportPartialError";
  }
}
