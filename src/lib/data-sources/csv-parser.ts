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
  const rows = (parsed.data.slice(1) as string[][]).filter((row) =>
    row.some((cell) => cell !== ''),
  );

  return { ok: true, headers, rows };
}
