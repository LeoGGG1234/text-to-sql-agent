import { describe, expect, it } from 'vitest';
import { inspectStream, scoreApplicationOutcome } from '../eval/run-eval';

describe('eval stream inspection', () => {
  it('records successful application execution and a complete final answer', () => {
    const result = inspectStream([
      '9:{"toolCallId":"schema-1","toolName":"getSchema","args":{}}',
      'a:{"toolCallId":"schema-1","result":{"tables":[]}}',
      '9:{"toolCallId":"sql-1","toolName":"runSql","args":{"sql":"SELECT bad"}}',
      'a:{"toolCallId":"sql-1","result":{"success":false,"code":"SYNTAX_ERROR"}}',
      '9:{"toolCallId":"sql-2","toolName":"runSql","args":{"sql":"SELECT 1"}}',
      'a:{"toolCallId":"sql-2","result":{"success":true,"rows":[{"value":1}]}}',
      '0:"The answer is 1."',
      'd:{"finishReason":"stop","usage":{"promptTokens":20,"completionTokens":5}}',
    ].join('\n'));
    expect(result).toEqual({
      generatedSql: 'SELECT 1', toolStepCount: 3, runSqlCount: 2,
      runSqlResultCount: 2,
      retryCount: 1,
      lastRunSqlSucceeded: true,
      finalAnswerText: 'The answer is 1.',
      finishReason: 'stop',
      streamFinished: true,
      errors: [],
      malformedPartCount: 0,
      promptTokens: 20, completionTokens: 5,
    });
    expect(scoreApplicationOutcome(result, 1)).toEqual({
      applicationExecutionSuccess: 1,
      answerCompleteness: 1,
      taskSuccess: 1,
    });
  });

  it('does not treat a successful tool result without a final explanation as complete', () => {
    const result = inspectStream([
      '9:{"toolCallId":"sql-1","toolName":"runSql","args":{"sql":"SELECT 1"}}',
      'a:{"toolCallId":"sql-1","result":{"success":true,"rows":[{"value":1}]}}',
      'd:{"finishReason":"tool-calls","usage":{"promptTokens":10,"completionTokens":2}}',
    ].join('\n'));

    expect(result.lastRunSqlSucceeded).toBe(true);
    expect(result.retryCount).toBe(0);
    expect(result.finalAnswerText).toBe('');
    expect(result.finishReason).toBe('tool-calls');
    expect(scoreApplicationOutcome(result, 1)).toEqual({
      applicationExecutionSuccess: 1,
      answerCompleteness: 0,
      taskSuccess: 0,
    });
  });

  it('requires the last runSql call to have a matching result', () => {
    const result = inspectStream([
      '9:{"toolCallId":"sql-1","toolName":"runSql","args":{"sql":"SELECT 1"}}',
      'a:{"toolCallId":"sql-1","result":{"success":true,"rows":[]}}',
      '9:{"toolCallId":"sql-2","toolName":"runSql","args":{"sql":"SELECT 2"}}',
      '0:"I will finish later."',
      'd:{"finishReason":"stop","usage":{"promptTokens":10,"completionTokens":2}}',
    ].join('\n'));

    expect(result.generatedSql).toBe('SELECT 2');
    expect(result.retryCount).toBe(0);
    expect(result.lastRunSqlSucceeded).toBeNull();
    expect(result.finalAnswerText).toBe('');
  });

  it('surfaces stream errors and malformed protocol parts', () => {
    const result = inspectStream([
      '3:"provider failed"',
      'not-a-stream-part',
    ].join('\n'));

    expect(result.errors).toEqual(['provider failed']);
    expect(result.malformedPartCount).toBe(1);
    expect(result.streamFinished).toBe(false);
  });
});
