import "server-only";

import { getServerClient } from "@/lib/supabase";
import type { LinkedWalletSession } from "./auth";

export type LaunchIntentStatus =
  | "prepared"
  | "create_submitted"
  | "create_finalized"
  | "lock_submitted"
  | "completed";

export interface PreparedLaunchIntent {
  session: LinkedWalletSession;
  mintAddress: string;
  metadataUri: string;
  imageUri: string;
  config: Record<string, unknown>;
}

export class LaunchRecoveryError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function savePreparedLaunchIntent(
  input: PreparedLaunchIntent,
): Promise<void> {
  const supabase = getServerClient();
  const { data: existing, error: lookupError } = await supabase
    .from("launch_intents")
    .select("id, github_id, creator_wallet, status")
    .eq("mint_address", input.mintAddress)
    .maybeSingle();

  if (lookupError) throw new LaunchRecoveryError("Launch recovery is unavailable", 503);
  if (
    existing &&
    (existing.github_id !== input.session.identity_id ||
      existing.creator_wallet !== input.session.wallet_address)
  ) {
    throw new LaunchRecoveryError("Mint is already reserved", 409);
  }
  if (existing && existing.status !== "prepared") {
    throw new LaunchRecoveryError("Launch is already in progress", 409);
  }

  const values = {
    github_id: input.session.identity_id,
    creator_wallet: input.session.wallet_address,
    mint_address: input.mintAddress,
    metadata_uri: input.metadataUri,
    image_uri: input.imageUri,
    config: input.config,
    status: "prepared" satisfies LaunchIntentStatus,
    updated_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  };
  const query = existing
    ? supabase.from("launch_intents").update(values).eq("id", existing.id)
    : supabase.from("launch_intents").insert(values);
  const { error } = await query;
  if (error) throw new LaunchRecoveryError("Launch recovery is unavailable", 503);
}

export async function completeLaunchIntent(
  session: LinkedWalletSession,
  mintAddress: string,
): Promise<void> {
  const { data, error } = await getServerClient()
    .from("launch_intents")
    .update({ status: "completed", updated_at: new Date().toISOString() })
    .eq("github_id", session.identity_id)
    .eq("creator_wallet", session.wallet_address)
    .eq("mint_address", mintAddress)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    throw new LaunchRecoveryError("Failed to complete launch recovery state", 503);
  }
}
