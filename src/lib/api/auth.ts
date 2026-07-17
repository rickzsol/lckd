import "server-only";

import { getServerSession } from "next-auth";
import { authOptions } from "./authOptions";
import { getServerClient } from "@/lib/supabase";
import { apiError } from "./helpers";

export interface AuthSession {
  github_id: string;
  github_username: string;
}

export interface LinkedWalletSession extends AuthSession {
  wallet_address: string;
}

/**
 * Require an authenticated session. Returns the session or an error response.
 */
export async function requireAuth(): Promise<
  { session: AuthSession; error: null } | { session: null; error: ReturnType<typeof apiError> }
> {
  const raw = await getServerSession(authOptions);

  if (!raw?.github_id || !raw?.github_username) {
    return { session: null, error: apiError("Unauthorized", 401) };
  }

  return {
    session: { github_id: raw.github_id, github_username: raw.github_username },
    error: null,
  };
}

/** Require auth plus a wallet linked to the authenticated GitHub identity. */
export async function requireLinkedWallet(): Promise<
  | { session: LinkedWalletSession; error: null }
  | { session: null; error: ReturnType<typeof apiError> }
> {
  const auth = await requireAuth();
  if (auth.error) return auth;

  try {
    const { data, error } = await getServerClient()
      .from("github_profiles")
      .select("github_username, wallet_address")
      .eq("github_id", auth.session.github_id)
      .maybeSingle();

    if (error) {
      console.error("[auth] Linked wallet query failed:", error.message);
      return { session: null, error: apiError("Unable to verify linked wallet", 503) };
    }
    if (!data?.wallet_address) {
      return { session: null, error: apiError("Link a wallet before recording tokens", 403) };
    }

    return {
      session: {
        ...auth.session,
        github_username: data.github_username,
        wallet_address: data.wallet_address,
      },
      error: null,
    };
  } catch (error) {
    console.error("[auth] Linked wallet verification failed:", error);
    return { session: null, error: apiError("Unable to verify linked wallet", 503) };
  }
}
