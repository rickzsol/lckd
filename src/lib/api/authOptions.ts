import "server-only";

import type { AuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import { getServerClient } from "@/lib/supabase";

interface GitHubOAuthProfile {
  id: number;
  login: string;
  avatar_url: string;
  created_at: string;
  public_repos: number;
}

const clientId = process.env.GITHUB_CLIENT_ID;
const clientSecret = process.env.GITHUB_CLIENT_SECRET;

export const authOptions: AuthOptions = {
  providers: [GitHubProvider({ clientId: clientId ?? "", clientSecret: clientSecret ?? "" })],
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ profile, account }) {
      if (account?.provider !== "github" || !profile) return true;
      const github = profile as unknown as GitHubOAuthProfile;
      if (!github.id || !github.login || !github.avatar_url || !github.created_at) return false;
      try {
        const { error } = await getServerClient().from("github_profiles").upsert(
          {
            github_id: String(github.id),
            github_username: github.login,
            github_avatar: github.avatar_url,
            account_created_at: github.created_at,
            public_repos: Number.isFinite(github.public_repos) ? github.public_repos : 0,
            last_refreshed: new Date().toISOString(),
          },
          { onConflict: "github_id" },
        );
        if (error) {
          console.error("[auth/signIn] Profile upsert failed:", error.message);
          return false;
        }
      } catch (error) {
        console.error("[auth/signIn] Profile persistence failed:", error);
        return false;
      }
      return true;
    },
    async jwt({ token, profile, account }) {
      if (account?.provider === "github" && profile) {
        const github = profile as unknown as GitHubOAuthProfile;
        token.github_id = String(github.id);
        token.github_username = github.login;
      }
      return token;
    },
    async session({ session, token }) {
      session.github_id = token.github_id as string;
      session.github_username = token.github_username as string;
      return session;
    },
  },
};
