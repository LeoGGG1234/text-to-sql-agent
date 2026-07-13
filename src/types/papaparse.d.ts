declare module 'papaparse' {
  interface ParseResult<T> {
    data: T[];
    errors: { message: string; row: number }[];
    meta: Record<string, unknown>;
  }
  export function parse<T>(input: string, config?: Record<string, unknown>): ParseResult<T>;
}
