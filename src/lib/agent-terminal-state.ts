import type { FinishReason, StreamTextTransform, ToolSet } from 'ai';

export const TOOL_LIMIT_NOTICE =
  '\n\n\u26a0\ufe0f \u672c\u8f6e\u5df2\u8fbe\u5230\u5de5\u5177\u8c03\u7528\u4e0a\u9650\uff1b\u67e5\u8be2\u7ed3\u679c\u5df2\u4fdd\u7559\uff0c\u4f46\u5c1a\u672a\u751f\u6210\u6700\u7ec8\u7ed3\u8bba\u3002\u8bf7\u7ee7\u7eed\u63d0\u95ee\u6216\u7f29\u5c0f\u95ee\u9898\u8303\u56f4\u3002 / Tool-call limit reached; results are preserved, but no final conclusion was generated.';

export const AGENT_STREAM_DEADLINE_MS = 45_000;

export const RUNTIME_LIMIT_NOTICE =
  '\n\n\u26a0\ufe0f \u672c\u8f6e\u5206\u6790\u63a5\u8fd1\u8fd0\u884c\u65f6\u95f4\u4e0a\u9650\uff1b\u5df2\u5b8c\u6210\u7684\u5de5\u5177\u7ed3\u679c\u5df2\u4fdd\u7559\uff0c\u4f46\u5c1a\u672a\u751f\u6210\u6700\u7ec8\u7ed3\u8bba\u3002\u8bf7\u7ee7\u7eed\u63d0\u95ee\u6216\u7f29\u5c0f\u95ee\u9898\u8303\u56f4\u3002 / Runtime limit approached; completed tool results are preserved, but no final conclusion was generated.';

export function ensureTerminalText(
  text: string,
  finishReason: FinishReason,
): string {
  if (finishReason !== 'tool-calls') return text;
  if (text.includes(TOOL_LIMIT_NOTICE.trim())) return text;
  return `${text.trimEnd()}${TOOL_LIMIT_NOTICE}`;
}

export function finiteTokenUsage(
  usage: { promptTokens: number; completionTokens: number } | undefined,
): { promptTokens: number; completionTokens: number } | null {
  if (
    !usage ||
    !Number.isFinite(usage.promptTokens) ||
    !Number.isFinite(usage.completionTokens)
  ) {
    return null;
  }
  return usage;
}

export function createTerminalNoticeTransform<
  TOOLS extends ToolSet,
>(deadlineMs = AGENT_STREAM_DEADLINE_MS): StreamTextTransform<TOOLS> {
  return ({ stopStream }) => {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let finished = false;

    return new TransformStream({
      start(controller) {
        deadline = setTimeout(() => {
          if (finished) return;
          finished = true;
          try {
            controller.enqueue({
              type: 'text-delta',
              textDelta: RUNTIME_LIMIT_NOTICE,
            });
          } catch {
            // The client may already have cancelled the response stream.
          }
          stopStream();
        }, deadlineMs);
      },
      transform(part, controller) {
        if (part.type === 'finish') {
          finished = true;
          if (deadline) clearTimeout(deadline);
          if (part.finishReason === 'tool-calls') {
            controller.enqueue({
              type: 'text-delta',
              textDelta: TOOL_LIMIT_NOTICE,
            });
          }
        }
        controller.enqueue(part);
      },
      flush() {
        finished = true;
        if (deadline) clearTimeout(deadline);
      },
    });
  };
}
