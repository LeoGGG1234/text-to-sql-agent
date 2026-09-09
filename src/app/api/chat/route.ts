/**
 * Chat API Route — multi-provider streaming endpoint
 *
 * POST /api/chat
 * Body: { messages, conversationId?, provider?, model?, promptVariant? }
 *
 * Authenticated. Persists messages and token usage to Neon Postgres.
 */

import { streamText, type CoreMessage } from 'ai';
import {
  getModel,
  isValidProvider,
  DEFAULT_PROVIDER,
  type ProviderId,
} from '@/lib/providers';
import { getSystemPrompt } from '@/lib/prompts';
import { checkRateLimit, rateLimitHeaders } from '@/lib/rate-limit';
import { getSession } from '@/lib/auth-helpers';
import { db, schema } from '@/db';
import { and, eq } from 'drizzle-orm';
import { buildTools } from '@/tools';
import {
  SCHEMA_TABLES,
  RELATIONSHIPS,
  buildSchemaPromptText,
  type TableDef,
} from '@/lib/schema-description';
import type { SchemaJson, QualityProfile } from '@/lib/data-sources/types';
import { buildQualityNote, buildTableQualityNote } from '@/lib/data-sources/quality-analyzer';
import type { ExecOptions } from '@/lib/sql-executor';
import { getOwnedConversation } from '@/lib/conversation-manager';
import { getOwnedDataSource } from '@/lib/data-sources/schema-manager';
import { CHAT_CONVERSATION_ID_HEADER } from '@/lib/chat-protocol';
import {
  createTerminalNoticeTransform,
  ensureTerminalText,
} from '@/lib/agent-terminal-state';

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
    const modelId: string | undefined = body.model;
    const promptVariant: string | undefined = body.promptVariant;
    const conversationId: string | undefined = body.conversationId;
    const frontendDataSourceId: string | undefined = body.dataSourceId ?? undefined;

    // Validate
    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json(
        { error: 'messages must be a non-empty array' },
        { status: 400 },
      );
    }

    // Resolve the provider from the (untrusted) body. A missing value falls
    // back to the default; an unrecognized value is a client error (400) — not
    // a 500 from getModel choking on an unknown id (e.g. a stale persisted
    // choice whose API key was since removed).
    let provider: ProviderId = DEFAULT_PROVIDER;
    if (body.provider !== undefined && body.provider !== null) {
      if (!isValidProvider(body.provider)) {
        return Response.json(
          { error: `Unknown provider: ${String(body.provider)}` },
          { status: 400 },
        );
      }
      provider = body.provider;
    }

    // ─── Authorize conversation + data source ───────────────
    const userId = session.user.id;
    const existingConversation = conversationId
      ? await getOwnedConversation(conversationId, userId)
      : null;

    if (conversationId && !existingConversation) {
      return Response.json(
        { error: 'Conversation not found' },
        { status: 404 },
      );
    }

    const convId = existingConversation?.id ?? crypto.randomUUID();
    const requestedDataSourceId =
      frontendDataSourceId === undefined
        ? undefined
        : frontendDataSourceId || null;
    const effectiveDataSourceId =
      requestedDataSourceId !== undefined
        ? requestedDataSourceId
        : existingConversation?.dataSourceId ?? null;
    const ownedDataSource = effectiveDataSourceId
      ? await getOwnedDataSource(effectiveDataSourceId, userId)
      : null;

    if (effectiveDataSourceId && !ownedDataSource) {
      return Response.json(
        { error: 'Data source not found' },
        { status: 404 },
      );
    }

    if (
      ownedDataSource?.type === 'upload' &&
      !process.env.USERDATA_DATABASE_URL
    ) {
      return Response.json(
        { error: 'User-data querying is not configured.' },
        { status: 503 },
      );
    }

    // No persistence occurs until every supplied or stored resource has been
    // authorized for the current user.
    if (!existingConversation) {
      const now = new Date();
      await db.insert(schema.chatConversations).values({
        id: convId,
        userId,
        title: null,
        dataSourceId: effectiveDataSourceId,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      const updates: {
        updatedAt: Date;
        dataSourceId?: string | null;
      } = { updatedAt: new Date() };
      if (requestedDataSourceId !== undefined) {
        updates.dataSourceId = requestedDataSourceId;
      }

      await db
        .update(schema.chatConversations)
        .set(updates)
        .where(
          and(
            eq(schema.chatConversations.id, convId),
            eq(schema.chatConversations.userId, userId),
          ),
        );
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

    // ─── Resolve active data source ─────────────────────────
    let resolvedTables: TableDef[] = SCHEMA_TABLES;
    let resolvedRelationships: string[] = RELATIONSHIPS;
    let execOptions: ExecOptions | undefined;

    if (ownedDataSource) {
      const schemaJson = ownedDataSource.schemaJson as unknown as SchemaJson | null;
      const qualityProfile =
        ownedDataSource.profileStatus === 'fresh'
          ? (schemaJson?.qualityProfile as QualityProfile | undefined)
          : undefined;
      if (schemaJson?.tables) {
        // Convert DiscoveredTable[] → TableDef[] for prompt + getSchema tool.
        resolvedTables = schemaJson.tables.map((t) => {
          const tableQualityNote =
            qualityProfile?.table
              ? buildTableQualityNote(qualityProfile.table)
              : '';
          return {
            name: `userdata."${t.name}"`,
            description:
              `${t.displayName}. ${t.rowCount} rows. All columns are TEXT — use CAST for math/dates.` +
              (tableQualityNote ? ` ${tableQualityNote}` : ''),
            columns: t.columns.map((c) => {
              const colProfile = qualityProfile?.columns?.[c.name];
              const qualityNote = buildQualityNote(c, colProfile);
              return {
                name: c.name,
                type: 'TEXT',
                nullable: c.nullable,
                description:
                  `${c.displayName} (semantic: ${c.semanticType}). ${c.hint ?? ''}` +
                  qualityNote,
              };
            }),
            foreignKeys: [],
          };
        });
        resolvedRelationships = schemaJson.relationships;
      }

      // Set exec options for user-uploaded data sources.
      if (ownedDataSource.type === 'upload') {
        execOptions = {
          connectionString: process.env.USERDATA_DATABASE_URL!,
          searchPath: 'userdata',
          accessScope: {
            schema: 'userdata',
            tables: schemaJson?.tables.map((table) => table.name) ?? [],
          },
        };
      }
    }

    // ─── Stream response ────────────────────────────────────
    const model = getModel(provider, modelId);
    const schemaText = buildSchemaPromptText(resolvedTables, resolvedRelationships);
    const systemPrompt = getSystemPrompt(promptVariant, schemaText);

    const result = streamText({
      model,
      messages,
      system: systemPrompt,
      tools: buildTools({ execOptions, schemaTables: resolvedTables, schemaRelationships: resolvedRelationships }),
      maxSteps: 5,
      experimental_transform: createTerminalNoticeTransform(),
      onFinish: async (event) => {
        // Save assistant message
        try {
          const assistantMsgId = crypto.randomUUID();
          const usage = event.usage;

          // Collect tool invocations from all steps
          const toolInvocations: Array<{
            toolCallId: string;
            toolName: string;
            args: unknown;
            result?: unknown;
            state?: 'result';
          }> = [];
          for (const step of event.steps) {
            for (const toolCall of step.toolCalls ?? []) {
              toolInvocations.push({
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                args: toolCall.args,
              });
            }
            for (const toolResult of step.toolResults ?? []) {
              // Update matching invocation with result
              const inv = toolInvocations.find(
                (t) => t.toolCallId === toolResult.toolCallId,
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
                content: ensureTerminalText(event.text, event.finishReason),
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
              model: modelId ?? 'deepseek-v4-flash',
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
            });
          }

          // Auto-title: first 50 chars of assistant's first response
          const [conv] = await db
            .select({ title: schema.chatConversations.title })
            .from(schema.chatConversations)
            .where(
              and(
                eq(schema.chatConversations.id, convId),
                eq(schema.chatConversations.userId, userId),
              ),
            )
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
                .where(
                  and(
                    eq(schema.chatConversations.id, convId),
                    eq(schema.chatConversations.userId, userId),
                  ),
                );
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
    headers.set(CHAT_CONVERSATION_ID_HEADER, convId);
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
