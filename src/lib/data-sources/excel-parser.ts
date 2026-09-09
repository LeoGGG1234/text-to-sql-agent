import { readSheet } from 'read-excel-file/node';

export type ExcelTableParseResult =
  | { ok: true; headers: string[]; rows: string[][] }
  | { ok: false; error: string };

function cellToString(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) {
    const iso = cell.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
  }
  return String(cell);
}

/**
 * Parse the first worksheet from an OOXML `.xlsx` file.
 *
 * Numbers are kept as their source decimal strings to avoid introducing
 * JavaScript floating-point rounding before values reach the TEXT-backed
 * analytical table. Cell text is preserved until an explicit cleaning recipe.
 */
export async function parseXlsxTable(
  input: Buffer,
): Promise<ExcelTableParseResult> {
  try {
    const data = await readSheet<string>(input, {
      trim: false,
      parseNumber: (value) => value,
    });

    if (data.length === 0) {
      return { ok: false, error: 'Empty Excel sheet.' };
    }

    const headers = data[0].map(cellToString);
    const rows = data
      .slice(1)
      .map((row) => row.map(cellToString))
      .filter((row) => row.some((cell) => cell !== ''));

    return { ok: true, headers, rows };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
