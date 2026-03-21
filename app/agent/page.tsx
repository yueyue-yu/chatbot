import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { AgentDemo } from "@/components/agent/agent-demo";
import { AgentSessionLabel } from "@/components/agent/agent-session-label";

export default function AgentPage() {

  return (
    <main className="h-dvh overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.10),_transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.98))] px-4 py-6 dark:bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.14),_transparent_32%),linear-gradient(180deg,rgba(2,6,23,0.98),rgba(3,7,18,0.98))] md:px-6">
      <div className="mx-auto flex h-[calc(100dvh-3rem)] min-h-0 max-w-6xl flex-col gap-5">
        <div className="flex items-center justify-between">
          <Link
            className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/70 px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            href="/"
          >
            <ArrowLeftIcon className="size-4" />
            Back to Chat
          </Link>

          <AgentSessionLabel />
        </div>

        <AgentDemo />
      </div>
    </main>
  );
}
