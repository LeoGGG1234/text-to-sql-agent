import { describe, expect, it } from 'vitest';
import { inspectStream } from '../eval/run-eval';

describe('eval stream inspection', () => {
  it('records the final SQL, tool count, retries and usage', () => {
    const result = inspectStream([
      '9:{"toolName":"getSchema","args":{}}',
      '9:{"toolName":"runSql","args":{"sql":"SELECT bad"}}',
      '9:{"toolName":"runSql","args":{"sql":"SELECT 1"}}',
      'd:{"finishReason":"stop","usage":{"promptTokens":20,"completionTokens":5}}',
    ].join('\n'));
    expect(result).toEqual({
      generatedSql: 'SELECT 1', toolStepCount: 3, runSqlCount: 2,
      promptTokens: 20, completionTokens: 5,
    });
  });
});
