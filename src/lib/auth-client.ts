/**
 * Client-side auth SDK.
 *
 * Usage in React components:
 *   import { authClient } from '@/lib/auth-client';
 *   const { data: session } = authClient.useSession();
 */

import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient();

// Re-export commonly used hooks for convenience
export const { signIn, signUp, signOut, useSession } = authClient;
