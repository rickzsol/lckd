import "next-auth";

declare module "next-auth" {
  interface Session {
    identity_id: string;
    identity_provider: "github" | "twitter";
    identity_username: string;
    identity_avatar: string | null;
    github_id?: string;
    github_username?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    identity_id?: string;
    identity_provider?: "github" | "twitter";
    identity_username?: string;
    identity_avatar?: string | null;
    github_id?: string;
    github_username?: string;
  }
}
