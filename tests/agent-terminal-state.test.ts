import { describe, expect, it, vi } from 'vitest';

import {
  createTerminalNoticeTransform,
  ensureTerminalText,
  finiteTokenUsage,
  RUNTIME_LIMIT_NOTICE,
  TOOL_LIMIT_NOTICE,
} from '../src/lib/agent-terminal-state';

describe('agent terminal state', () => {
  it('rejects incomplete usage emitted by a deliberately stopped stream', () => {
    expect(
      finiteTokenUsage({ promptTokens: Number.NaN, completionTokens: Number.NaN }),
    ).toBeNull();
    expect(finiteTokenUsage({ promptTokens: 10, completionTokens: 5 })).toEqual({
      promptTokens: 10,
      completionTokens: 5,
    });
  });

  it('preserves normal completed text', () => {
    expect(ensureTerminalText('\u5171 30 \u884c\u3002', 'stop')).toBe('\u5171 30 \u884c\u3002');
  });

  it('adds an explicit notice when the tool loop exhausts its step budget', () => {
    expect(ensureTerminalText('\u5df2\u83b7\u53d6 SQL \u7ed3\u679c\u3002  ', 'tool-calls')).toBe(
      `\u5df2\u83b7\u53d6 SQL \u7ed3\u679c\u3002${TOOL_LIMIT_NOTICE}`,
    );
  });

  it('emits the notice before the final tool-call finish event', async () => {
    const transform = createTerminalNoticeTransform();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          type: 'finish' as const,
          finishReason: 'tool-calls' as const,
          usage: { promptTokens: 1, completionTokens: 1 },
          providerMetadata: undefined,
          response: {
            id: 'response-id',
            timestamp: new Date(),
            modelId: 'test',
          },
        });
        controller.close();
      },
    }).pipeThrough(transform({ tools: {}, stopStream: () => undefined }));

    const parts = [];
    for await (const part of stream) parts.push(part);

    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({
      type: 'text-delta',
      textDelta: TOOL_LIMIT_NOTICE,
    });
    expect(parts[1]).toMatchObject({
      type: 'finish',
      finishReason: 'tool-calls',
    });
  });

  it('stops a slow stream before the platform timeout and preserves a notice', async () => {
    let sourceController: ReadableStreamDefaultController | undefined;
    const stopStream = vi.fn(() => sourceController?.close());
    const transform = createTerminalNoticeTransform(5);
    const stream = new ReadableStream({
      start(controller) {
        sourceController = controller;
        controller.enqueue({
          type: 'text-delta' as const,
          textDelta: '\u5df2\u83b7\u53d6 SQL \u7ed3\u679c\u3002',
        });
      },
    }).pipeThrough(transform({ tools: {}, stopStream }));

    const parts = [];
    for await (const part of stream) parts.push(part);

    expect(stopStream).toHaveBeenCalledOnce();
    expect(parts).toEqual([
      { type: 'text-delta', textDelta: '\u5df2\u83b7\u53d6 SQL \u7ed3\u679c\u3002' },
      { type: 'text-delta', textDelta: RUNTIME_LIMIT_NOTICE },
    ]);
  });
});
