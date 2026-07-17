import "server-only";

import { apiError } from "./helpers";
import { requireLinkedWallet } from "./auth";
import { arePublicLaunchesEnabled, canCreateLaunch } from "../launchAvailability";

const PAUSED_MESSAGE = "Public launches are temporarily paused";

export async function requireLaunchCreationAccess() {
  const auth = await requireLinkedWallet();
  if (auth.error) {
    return arePublicLaunchesEnabled()
      ? auth
      : { session: null, error: apiError(PAUSED_MESSAGE, 503) };
  }
  if (!canCreateLaunch(auth.session.github_id)) {
    return { session: null, error: apiError(PAUSED_MESSAGE, 503) };
  }
  return auth;
}
