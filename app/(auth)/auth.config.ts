import NextAuth, { type NextAuthConfig } from "next-auth";

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const authConfig = {
  basePath: "/api/auth",
  trustHost: true,
  pages: {
    signIn: `${base}/login`,
    newUser: `${base}/`,
  },
  providers: [],
  callbacks: {
    authorized() {
      return true;
    },
  },
} satisfies NextAuthConfig;

export const { auth: proxyAuth } = NextAuth(authConfig);
