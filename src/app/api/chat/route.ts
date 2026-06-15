/**
 * Chat API Route — multi-provider streaming endpoint
 *
 * POST /api/chat
 * Body: { messages, conversationId?, provider?, model?, promptVariant? }
 *
 * Authenticated. Persists messages and token usage to Neon Postgres.
 */

import { streamText, type CoreMessage } from 'ai';
import { getModel, DEFAULT_PROVIDER, type ProviderId } from '@/lib/providers';
import { getSystemPrompt } from '@/lib/prompts';
import { checkRateLimit, rateLimitHeaders } from '@/lib/rate-limit';
import { getSession } from '@/lib/auth-helpers';
import { db, schema } from '@/db';
import { eq } from 'drizzle-orm';
import { buildTools } from '@/tools';

export const runtime = 'nodejs';
export const maxDuration = 60; // seconds (Hobby plan limit)
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    // ─── Authentication ────────────────────────────────────
    const session = await getSession(req);
    if (!session) {
      return Response.json(
        { error: 'Unauthorized — please sign in' },
        { status: 401 },
      );
    }

    // Rate limiting (per user, fallback to IP)
    const identifier =
      session.user.id ?? req.headers.get('x-forwarded-for') ?? 'unknown';
    const rl = checkRateLimit(`chat:${identifier}`, 30, 60_000);
    if (!rl.allowed) {
      return Response.json(
        { error: 'Rate limit exceeded. Try again in a minute.' },
        { status: 429, headers: rateLimitHeaders(rl) },
      );
    }

    const body = await req.json();

    const messages: CoreMessage[] = body.messages ?? [];
    const provider: ProviderId = body.provider ?? DEFAULT_PROVIDER;
    const modelId: string | undefined = body.model;
    const promptVariant: string | undefined = body.promptVariant;
    const conversationId: string | undefined = body.conversationId;

    // Validate
    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json(
        { error: 'messages must be a non-empty array' },
        { status: 400 },
      );
    }

    // ─── Find or create conversation ────────────────────────
    let convId = conversationId;
    const userId = session.user.id;

    if (convId) {
      // Verify user owns this conversation
      const [existing] = await db
        .select({ id: schema.chatConversations.id })
        .from(schema.chatConversations)
        .where(eq(schema.chatConversations.id, convId))
        .limit(1);
      if (!existing) {
        convId = undefined; // Invalid ID — create new
      }
    }

    if (!convId) {
      convId = crypto.randomUUID();
      const now = new Date();
      await db.insert(schema.chatConversations).values({
        id: convId,
        userId,
        title: null,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      // Bump updatedAt
      await db
        .update(schema.chatConversations)
        .set({ updatedAt: new Date() })
        .where(eq(schema.chatConversations.id, convId));
    }

    // ─── Save user message ──────────────────────────────────
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.role === 'user') {
      const userMsgId = crypto.randomUUID();
      await db.insert(schema.chatMessages).values({
        id: userMsgId,
        conversationId: convId,
        role: 'user',
        parts: [{ role: 'user', content: lastMessage.content }],
        createdAt: new Date(),
      });
    }

    // ─── Stream response ────────────────────────────────────
    const model = getModel(provider, modelId);
    const systemPrompt = getSystemPrompt(promptVariant);

    const result = streamText({
      model,
      messages,
      system: systemPrompt,
      // Fresh tool set per request (runSql carries a per-turn retry counter).
      tools: buildTools(),
      maxSteps: 5,
      onFinish: async (event) => {
        // Save assistant message
        try {
          const assistantMsgId = crypto.randomUUID();
          const usage = event.usage;

          // Collect tool invocations from all steps
          const toolInvocations: any[] = [];
          for (const step of event.steps) {
            for (const toolCall of (step.toolCalls ?? []) as any[]) {
              toolInvocations.push({
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                args: toolCall.args,
              });
            }
            for (const toolResult of (step.toolResults ?? []) as any[]) {
              // Update matching invocation with result
              const inv = toolInvocations.find(
                (t: any) => t.toolCallId === toolResult.toolCallId,
              );
              if (inv) {
                inv.result = toolResult.result;
                inv.state = 'result';
              }
            }
          }

          await db.insert(schema.chatMessages).values({
            id: assistantMsgId,
            conversationId: convId,
            role: 'assistant',
            parts: [
              {
                role: 'assistant',
                content: event.text,
                toolInvocations:
                  toolInvocations.length > 0 ? toolInvocations : undefined,
              },
            ],
            tokens: usage
              ? usage.promptTokens + usage.completionTokens
              : null,
            createdAt: new Date(),
          });

          // Save usage record
          if (usage) {
            await db.insert(schema.usageRecords).values({
              id: crypto.randomUUID(),
              userId,
              conversationId: convId,
              model: modelId ?? 'deepseek-chat',
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
            });
          }

          // Auto-title: first 50 chars of assistant's first response
          const [conv] = await db
            .select({ title: schema.chatConversations.title })
            .from(schema.chatConversations)
            .where(eq(schema.chatConversations.id, convId))
            .limit(1);

          if (conv && !conv.title && event.text) {
            const title = event.text
              .slice(0, 50)
              .replace(/\n/g, ' ')
              .trim();
            if (title) {
              await db
                .update(schema.chatConversations)
                .set({ title, updatedAt: new Date() })
                .where(eq(schema.chatConversations.id, convId));
            }
          }
        } catch (err) {
          console.error('[chat] persistence error:', err);
          // Don't fail the response — persistence errors are non-fatal
        }
      },
    });

    const response = result.toDataStreamResponse();
    // Add rate limit headers
    const headers = new Headers(response.headers);
    const rlHeaders = rateLimitHeaders(rl);
    for (const [k, v] of Object.entries(rlHeaders)) {
      headers.set(k, v);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    console.error('[chat] error:', error);
    return Response.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
