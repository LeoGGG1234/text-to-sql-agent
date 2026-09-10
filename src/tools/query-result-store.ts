/**
 * Per-request registry for successful SQL results that may be visualized.
 *
 * The registry is created by buildTools(), so result ids never cross chat
 * requests or users. renderChart receives only an id and column names; it
 * cannot accept model-authored chart values.
 */

export interface QueryResultSnapshot {
  resultId: string;
  rowCount: number;
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
}

export interface QueryResultStore {
  save(result: Omit<QueryResultSnapshot, 'resultId'>): QueryResultSnapshot;
  get(resultId: string): QueryResultSnapshot | undefined;
}

export function createQueryResultStore(): QueryResultStore {
  const results = new Map<string, QueryResultSnapshot>();
  let sequence = 0;

  return {
    save(result) {
      sequence += 1;
      const snapshot: QueryResultSnapshot = {
        resultId: `query_${sequence}`,
        rowCount: result.rowCount,
        columns: [...result.columns],
        rows: result.rows.map((row) => ({ ...row })),
        truncated: result.truncated,
      };
      results.set(snapshot.resultId, snapshot);
      return snapshot;
    },
    get(resultId) {
      return results.get(resultId);
    },
  };
}
