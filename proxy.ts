import { NextResponse } from "next/server";
import { proxyAuth } from "@/app/(auth)/auth.config";

export const proxy = proxyAuth((request) => {
  const { pathname } = request.nextUrl;
  const isAuthPage = ["/login", "/register"].includes(pathname);

  if (pathname.startsWith("/ping")) {
    return new Response("pong", { status: 200 });
  }

  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const isAuthenticated = Boolean(request.auth?.user);

  if (isAuthPage && !isAuthenticated) {
    return NextResponse.next();
  }

  if (!isAuthenticated) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.next();
    }

    return NextResponse.redirect(new URL(`${base}/login`, request.url));
  }

  if (isAuthPage) {
    return NextResponse.redirect(new URL(`${base}/`, request.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/",
    "/chat/:id",
    "/api/:path*",
    "/login",
    "/register",

    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
