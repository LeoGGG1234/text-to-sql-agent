/**
 * GET /api/providers — list providers that have API keys configured.
 *
 * Called by the frontend provider selector to show only available providers.
 */

import { PROVIDERS, getAvailableProviders } from '@/lib/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const available = getAvailableProviders();
    const list = available.map((id) => ({
      id,
      label: PROVIDERS[id].label,
      defaultModel: PROVIDERS[id].defaultModel,
    }));
    return Response.json({ providers: list });
  } catch (error) {
    console.error('[providers] error:', error);
    return Response.json(
      { error: 'Failed to list providers' },
      { status: 500 },
    );
  }
}
