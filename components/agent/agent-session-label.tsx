"use client";

import { useSession } from "next-auth/react";

export function AgentSessionLabel() {
  const { data, status } = useSession();

  if (status === "loading") {
    return (
      <div className="hidden h-5 w-40 animate-pulse rounded bg-foreground/5 md:block" />
    );
  }

  if (!data?.user?.email) {
    return null;
  }

  return (
    <p className="hidden text-sm text-muted-foreground md:block">
      Signed in as {data.user.email}
    </p>
  );
}
