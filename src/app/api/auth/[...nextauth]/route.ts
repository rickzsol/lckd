import NextAuth, { type AuthOptions } from "next-auth";
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
  providers: [
    GitHubProvider({ clientId: clientId ?? "", clientSecret: clientSecret ?? "" }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ profile, account }) {
      if (account?.provider !== "github" || !profile) return true;

      const gh = profile as unknown as GitHubOAuthProfile;
      if (!gh.id || !gh.login || !gh.avatar_url || !gh.created_at) return false;

      try {
        const supabase = getServerClient();
        const { error } = await supabase.from("github_profiles").upsert(
          {
            github_id: String(gh.id),
            github_username: gh.login,
            github_avatar: gh.avatar_url,
            account_created_at: gh.created_at,
            public_repos: Number.isFinite(gh.public_repos) ? gh.public_repos : 0,
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
        const gh = profile as unknown as GitHubOAuthProfile;
        token.github_id = String(gh.id);
        token.github_username = gh.login;
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

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
