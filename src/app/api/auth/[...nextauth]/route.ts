import NextAuth, { type AuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import { createServerClient } from "@/lib/supabase";

interface GitHubOAuthProfile {
  id: number;
  login: string;
  avatar_url: string;
  created_at: string;
  public_repos: number;
}

export const authOptions: AuthOptions = {
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ profile, account }) {
      if (account?.provider !== "github" || !profile) return true;

      const gh = profile as unknown as GitHubOAuthProfile;
      const supabase = createServerClient();

      const { data: existing } = await supabase
        .from("github_profiles")
        .select("id")
        .eq("github_id", String(gh.id))
        .single();

      if (existing) {
        await supabase
          .from("github_profiles")
          .update({
            github_username: gh.login,
            github_avatar: gh.avatar_url,
            public_repos: gh.public_repos,
            last_refreshed: new Date().toISOString(),
          })
          .eq("github_id", String(gh.id));
      } else {
        await supabase.from("github_profiles").insert({
          github_id: String(gh.id),
          github_username: gh.login,
          github_avatar: gh.avatar_url,
          account_created_at: gh.created_at,
          public_repos: gh.public_repos,
          wallet_address: "",
        });
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
