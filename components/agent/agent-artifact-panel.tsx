"use client";

import { formatDistance } from "date-fns";
import {
  CodeIcon,
  FileIcon,
  ImageIcon,
  LoaderIcon,
} from "@/components/chat/icons";
import { artifactDefinitions } from "@/components/chat/artifact";
import { initialArtifactData, useArtifact } from "@/hooks/use-artifact";
import type { Document } from "@/lib/db/schema";
import { cn, fetcher } from "@/lib/utils";
import { XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";

function ArtifactKindIcon({
  kind,
  isLoading,
}: {
  kind: Document["kind"];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="animate-spin">
        <LoaderIcon size={14} />
      </div>
    );
  }

  if (kind === "code") {
    return <CodeIcon size={14} />;
  }

  if (kind === "image") {
    return <ImageIcon size={14} />;
  }

  return <FileIcon size={14} />;
}

export function AgentArtifactPanel() {
  const { artifact, setArtifact, metadata, setMetadata } = useArtifact();
  const { mutate } = useSWRConfig();
  const [isContentDirty, setIsContentDirty] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestContentRef = useRef("");

  const artifactDefinition = useMemo(
    () =>
      artifactDefinitions.find((definition) => definition.kind === artifact.kind),
    [artifact.kind]
  );

  const { data: documents, isLoading: isDocumentsFetching } = useSWR<Document[]>(
    artifact.documentId !== "init"
      ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/document?id=${artifact.documentId}`
      : null,
    fetcher
  );

  const document = useMemo(() => {
    if (documents && documents.length > 0) {
      return documents.at(-1) ?? null;
    }

    if (artifact.documentId === "init") {
      return null;
    }

    return {
      content: artifact.content,
      createdAt: new Date(),
      id: artifact.documentId,
      kind: artifact.kind,
      title: artifact.title,
      userId: "noop",
    } satisfies Document;
  }, [artifact.content, artifact.documentId, artifact.kind, artifact.title, documents]);

  useEffect(() => {
    if (!artifactDefinition?.initialize || artifact.documentId === "init") {
      return;
    }

    artifactDefinition.initialize({
      documentId: artifact.documentId,
      setMetadata,
    });
  }, [artifact.documentId, artifactDefinition, setMetadata]);

  useEffect(() => {
    if (!document) {
      return;
    }

    setArtifact((currentArtifact) => ({
      ...currentArtifact,
      content: document.content ?? "",
      status: "idle",
      title: document.title,
    }));
  }, [document, setArtifact]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const handleContentChange = useCallback(
    async (updatedContent: string) => {
      if (!document) {
        return;
      }

      const endpoint = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/document?id=${document.id}`;

      await fetch(endpoint, {
        method: "POST",
        body: JSON.stringify({
          content: updatedContent,
          isManualEdit: true,
          kind: document.kind,
          title: document.title,
        }),
      });

      setIsContentDirty(false);
      await mutate(endpoint);
    },
    [document, mutate]
  );

  const saveContent = useCallback(
    (updatedContent: string, debounce: boolean) => {
      latestContentRef.current = updatedContent;
      setIsContentDirty(true);

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }

      if (!debounce) {
        void handleContentChange(updatedContent);
        return;
      }

      saveTimerRef.current = setTimeout(() => {
        void handleContentChange(latestContentRef.current);
        saveTimerRef.current = null;
      }, 2000);
    },
    [handleContentChange]
  );

  if (!artifact.isVisible || !artifactDefinition || !document) {
    return null;
  }

  const panelContent = (
    <>
      <div className="flex h-[calc(3.5rem+1px)] shrink-0 items-center justify-between border-b border-border/50 px-4">
        <div className="flex items-center gap-3">
          <button
            className="group flex size-8 items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-all duration-150 hover:border-border hover:bg-muted hover:text-foreground active:scale-95"
            onClick={() => {
              setArtifact({ ...initialArtifactData, status: "idle" });
            }}
            type="button"
          >
            <XIcon className="size-4" />
          </button>

          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2 text-sm font-semibold leading-tight tracking-tight">
              <span className="text-muted-foreground">
                <ArtifactKindIcon
                  isLoading={artifact.status === "streaming"}
                  kind={document.kind}
                />
              </span>
              {artifact.title}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {isContentDirty ? (
                <>
                  <div className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                  Saving...
                </>
              ) : isDocumentsFetching ? (
                <>
                  <div className="animate-spin">
                    <LoaderIcon size={12} />
                  </div>
                  Loading...
                </>
              ) : (
                `Updated ${formatDistance(new Date(document.createdAt), new Date(), {
                  addSuffix: true,
                })}`
              )}
            </div>
          </div>
        </div>

        <div className="rounded-full border border-border/50 bg-muted/60 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {document.kind}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto bg-background">
        <artifactDefinition.content
          content={document.content ?? ""}
          currentVersionIndex={0}
          getDocumentContentById={() => document.content ?? ""}
          isCurrentVersion={true}
          isInline={false}
          isLoading={isDocumentsFetching && !document.content}
          metadata={metadata}
          mode="edit"
          onSaveContent={saveContent}
          setMetadata={setMetadata}
          status={artifact.status}
          suggestions={[]}
          title={document.title}
        />
      </div>
    </>
  );

  return (
    <>
      <div
        className={cn(
          "hidden h-full min-h-0 shrink-0 flex-col overflow-hidden border-l border-border/50 bg-sidebar md:flex",
          artifact.isVisible ? "md:w-[60%]" : "md:w-0"
        )}
        data-testid="agent-artifact"
      >
        {panelContent}
      </div>

      <div className="fixed inset-0 z-50 flex min-h-0 flex-col overflow-hidden bg-sidebar md:hidden">
        {panelContent}
      </div>
    </>
  );
}
