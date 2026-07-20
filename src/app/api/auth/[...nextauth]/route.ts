import NextAuth, { type AuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import TwitterProvider from "next-auth/providers/twitter";
import { getServerClient } from "@/lib/supabase";

interface GitHubOAuthProfile {
  id: number;
  login: string;
  avatar_url: string;
  created_at: string;
  public_repos: number;
}

interface TwitterOAuthProfile {
  data?: {
    id?: string;
    username?: string;
    profile_image_url?: string;
  };
}

type IdentityProvider = "github" | "twitter";

interface OAuthIdentity {
  provider: IdentityProvider;
  accountId: string;
  username: string;
  avatarUrl: string | null;
}

const clientId = process.env.GITHUB_CLIENT_ID;
const clientSecret = process.env.GITHUB_CLIENT_SECRET;
const xClientId = process.env.X_CLIENT_ID ?? process.env.TWITTER_CLIENT_ID;
const xClientSecret = process.env.X_CLIENT_SECRET ?? process.env.TWITTER_CLIENT_SECRET;

function getOAuthIdentity(provider: string | undefined, profile: unknown): OAuthIdentity | null {
  if (provider === "github") {
    const github = profile as GitHubOAuthProfile;
    if (!github.id || !github.login || !github.avatar_url) return null;
    return {
      provider,
      accountId: String(github.id),
      username: github.login,
      avatarUrl: github.avatar_url,
    };
  }
  if (provider === "twitter") {
    const twitter = profile as TwitterOAuthProfile;
    const data = twitter.data;
    if (!data?.id || !data.username) return null;
    return {
      provider,
      accountId: data.id,
      username: data.username,
      avatarUrl: data.profile_image_url ?? null,
    };
  }
  return null;
}

export const authOptions: AuthOptions = {
  providers: [
    GitHubProvider({ clientId: clientId ?? "", clientSecret: clientSecret ?? "" }),
    TwitterProvider({
      clientId: xClientId ?? "",
      clientSecret: xClientSecret ?? "",
      version: "2.0",
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ profile, account }) {
      if (!profile) return false;
      const identity = getOAuthIdentity(account?.provider, profile);
      if (!identity) return false;

      try {
        const supabase = getServerClient();
        const identityId = `${identity.provider}:${identity.accountId}`;
        const { error: identityError } = await supabase.from("auth_profiles").upsert(
          {
            identity_id: identityId,
            provider: identity.provider,
            provider_account_id: identity.accountId,
            username: identity.username,
            avatar_url: identity.avatarUrl,
            last_refreshed: new Date().toISOString(),
          },
          { onConflict: "identity_id" },
        );
        if (identityError) {
          console.error("[auth/signIn] Identity upsert failed:", identityError.message);
          return false;
        }

        if (identity.provider === "github") {
          const github = profile as unknown as GitHubOAuthProfile;
          if (!github.created_at) return false;
          const { error } = await supabase.from("github_profiles").upsert(
            {
              github_id: identity.accountId,
              github_username: identity.username,
              github_avatar: identity.avatarUrl,
              account_created_at: github.created_at,
              public_repos: Number.isFinite(github.public_repos) ? github.public_repos : 0,
              last_refreshed: new Date().toISOString(),
            },
            { onConflict: "github_id" },
          );
          if (error) {
            console.error("[auth/signIn] GitHub profile upsert failed:", error.message);
            return false;
          }
        }
      } catch (error) {
        console.error("[auth/signIn] Profile persistence failed:", error);
        return false;
      }

      return true;
    },

    async jwt({ token, profile, account }) {
      if (account && profile) {
        const identity = getOAuthIdentity(account.provider, profile);
        if (!identity) return token;
        token.identity_id = `${identity.provider}:${identity.accountId}`;
        token.identity_provider = identity.provider;
        token.identity_username = identity.username;
        token.identity_avatar = identity.avatarUrl;
        if (identity.provider === "github") {
          token.github_id = identity.accountId;
          token.github_username = identity.username;
        } else {
          delete token.github_id;
          delete token.github_username;
        }
      }
      if (!token.identity_id && token.github_id && token.github_username) {
        token.identity_id = `github:${token.github_id}`;
        token.identity_provider = "github";
        token.identity_username = token.github_username;
        token.identity_avatar = typeof token.picture === "string" ? token.picture : null;
      }
      return token;
    },

    async session({ session, token }) {
      session.identity_id = token.identity_id as string;
      session.identity_provider = token.identity_provider as IdentityProvider;
      session.identity_username = token.identity_username as string;
      session.identity_avatar = (token.identity_avatar as string | null | undefined) ?? null;
      session.github_id = token.github_id;
      session.github_username = token.github_username;
      return session;
    },
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
