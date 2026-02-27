import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { apiError } from "./helpers";

export interface AuthSession {
  github_id: string;
  github_username: string;
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
