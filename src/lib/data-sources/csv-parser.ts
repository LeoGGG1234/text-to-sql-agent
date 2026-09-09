import * as Papa from 'papaparse';

export type CsvTableParseResult =
  | { ok: true; headers: string[]; rows: string[][] }
  | { ok: false; error: string };

/**
 * Parse an uploaded CSV while treating Papa Parse's delimiter fallback as the
 * non-fatal warning it is. Papa still returns correctly comma-parsed data for
 * small, valid files that do not meet its delimiter auto-detection threshold.
 */
export function parseCsvTable(text: string): CsvTableParseResult {
  const parsed = Papa.parse<string[]>(text, { header: false });
  const fatalError = parsed.errors.find(
    (error) =>
      (error as typeof error & { code?: string }).code !==
      'UndetectableDelimiter',
  );

  if (parsed.data.length === 0 || fatalError) {
    return {
      ok: false,
      error: fatalError?.message ?? 'Empty CSV',
    };
  }

  const headers = parsed.data[0] as string[];
  const rows: string[][] = [];
  for (const [index, row] of (parsed.data.slice(1) as string[][]).entries()) {
    // Papa Parse emits a one-cell empty record for a trailing newline. Preserve
    // the existing behavior of ignoring fully blank records, but fail closed
    // when a real record does not match the header width. Otherwise the upload
    // route would persist only the header-aligned cells and silently discard
    // any extra values.
    if (!row.some((cell) => cell !== '')) continue;

    if (row.length !== headers.length) {
      return {
        ok: false,
        error: `Row ${index + 2} has ${row.length} fields; expected ${headers.length} based on the header.`,
      };
    }

    rows.push(row);
  }

  return { ok: true, headers, rows };
}
