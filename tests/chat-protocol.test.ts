import { describe, expect, it } from 'vitest';
import {
  CHAT_CONVERSATION_ID_HEADER,
  readConversationIdHeader,
} from '../src/lib/chat-protocol';

describe('streaming chat conversation protocol', () => {
  it('reads a non-empty conversation id from the response header', () => {
    const response = new Response(null, {
      headers: { [CHAT_CONVERSATION_ID_HEADER]: ' conversation-a ' },
    });

    expect(readConversationIdHeader(response)).toBe('conversation-a');
  });

  it('returns null when the response does not identify a conversation', () => {
    expect(readConversationIdHeader(new Response())).toBeNull();
  });
});
