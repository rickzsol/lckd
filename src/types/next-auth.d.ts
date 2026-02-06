import "next-auth";

declare module "next-auth" {
  interface Session {
    github_id: string;
    github_username: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    github_id?: string;
    github_username?: string;
  }
}
