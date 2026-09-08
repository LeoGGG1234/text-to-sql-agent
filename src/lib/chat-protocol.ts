/**
 * Shared protocol details for the streaming chat endpoint and its client.
 */

export const CHAT_CONVERSATION_ID_HEADER = 'x-conversation-id';

export function readConversationIdHeader(response: Response): string | null {
  const value = response.headers.get(CHAT_CONVERSATION_ID_HEADER)?.trim();
  return value || null;
}
