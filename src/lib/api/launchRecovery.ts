import "server-only";

import { getServerClient } from "@/lib/supabase";
import type { LinkedWalletSession } from "./auth";

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
  const { error } = await getServerClient().rpc("prepare_launch_intent", {
    p_github_id: input.session.github_id,
    p_creator_wallet: input.session.wallet_address,
    p_mint_address: input.mintAddress,
    p_metadata_uri: input.metadataUri,
    p_image_uri: input.imageUri,
    p_config: input.config,
    p_expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  });
  if (error) {
    throw new LaunchRecoveryError(
      error.code === "23505"
        ? "An existing launch must be completed or safely abandoned"
        : "Launch recovery is unavailable",
      error.code === "23505" ? 409 : 503,
    );
  }
}
