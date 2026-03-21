import { compare } from "bcrypt-ts";
import NextAuth, { type DefaultSession } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import { DUMMY_PASSWORD } from "@/lib/constants";
import { getUser } from "@/lib/db/queries";
import type { ErrorCode, Surface } from "@/lib/errors";
import { ChatbotError } from "@/lib/errors";
import { authConfig } from "./auth.config";

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
    } & DefaultSession["user"];
  }

  interface User {
    id?: string;
    email?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
  }
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials.email ?? "");
        const password = String(credentials.password ?? "");
        const users = await getUser(email);

        if (users.length === 0) {
          await compare(password, DUMMY_PASSWORD);
          return null;
        }

        const [user] = users;

        if (!user.password) {
          await compare(password, DUMMY_PASSWORD);
          return null;
        }

        const passwordsMatch = await compare(password, user.password);

        if (!passwordsMatch) {
          return null;
        }

        return user;
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
      }

      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
      }

      return session;
    },
  },
});

type OwnedResource = {
  userId: string;
};

type ChatResource = OwnedResource & {
  visibility: "private" | "public";
};

export async function getCurrentUser() {
  const session = await auth();
  return session?.user ?? null;
}

export async function requireSession(surface: Surface) {
  const session = await auth();

  if (!session?.user) {
    throw new ChatbotError(`unauthorized:${surface}` as ErrorCode);
  }

  return session;
}

export async function requireUser(surface: Surface) {
  const session = await requireSession(surface);
  return session.user;
}

export function isResourceOwner<T extends OwnedResource>(
  resource: T | null | undefined,
  userId: string
) {
  return Boolean(resource && resource.userId === userId);
}

export function assertResourceOwner<T extends OwnedResource>(
  resource: T | null | undefined,
  userId: string,
  options: {
    forbidden: ErrorCode;
    notFound?: ErrorCode;
  }
) {
  if (!resource) {
    if (options.notFound) {
      throw new ChatbotError(options.notFound);
    }

    throw new ChatbotError(options.forbidden);
  }

  if (!isResourceOwner(resource, userId)) {
    throw new ChatbotError(options.forbidden);
  }

  return resource;
}

export function canReadChat(chat: ChatResource, userId: string) {
  return chat.userId === userId || chat.visibility === "public";
}
