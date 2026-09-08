declare module 'papaparse' {
  type CsvValue = string | number | boolean | null | undefined | Date;

  interface ParseResult<T> {
    data: T[];
    errors: { message: string; row: number }[];
    meta: Record<string, unknown>;
  }

  interface UnparseConfig {
    quotes?: boolean | boolean[] | ((value: CsvValue, column: number) => boolean);
    quoteChar?: string;
    escapeChar?: string;
    delimiter?: string;
    header?: boolean;
    newline?: '\r' | '\n' | '\r\n';
    skipEmptyLines?: boolean | 'greedy';
    columns?: string[];
    escapeFormulae?: boolean | RegExp;
  }

  export function parse<T>(input: string, config?: Record<string, unknown>): ParseResult<T>;
  export function unparse(
    data: CsvValue[][] | Record<string, CsvValue>[] | { fields: string[]; data: CsvValue[][] },
    config?: UnparseConfig,
  ): string;
}
