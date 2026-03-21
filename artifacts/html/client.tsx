"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Artifact } from "@/components/chat/create-artifact";
import { HtmlEditor } from "@/components/chat/html-editor";
import { HtmlPreview } from "@/components/chat/html-preview";
import { CopyIcon, RedoIcon, UndoIcon } from "@/components/chat/icons";

export type HtmlArtifactView = "source" | "preview";

type Metadata = {
  view: HtmlArtifactView;
};

function HtmlArtifactContent({
  content,
  currentVersionIndex,
  isCurrentVersion,
  onSaveContent,
  status,
  view,
}: {
  content: string;
  currentVersionIndex: number;
  isCurrentVersion: boolean;
  onSaveContent: (updatedContent: string, debounce: boolean) => void;
  status: "streaming" | "idle";
  view: HtmlArtifactView;
}) {
  const [draftContent, setDraftContent] = useState(content);

  useEffect(() => {
    setDraftContent(content);
  }, [content]);

  const handleSaveContent = (updatedContent: string, debounce: boolean) => {
    setDraftContent(updatedContent);
    onSaveContent(updatedContent, debounce);
  };

  const resolvedView = status === "streaming" ? "source" : view;

  if (resolvedView === "preview") {
    return (
      <div className="flex min-h-full bg-muted/20">
        <div className="flex min-h-[420px] flex-1 bg-white p-3 sm:p-4">
          <div className="size-full overflow-hidden rounded-2xl border border-border/50 bg-white shadow-sm">
            <HtmlPreview className="min-h-[360px]" content={draftContent} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full bg-[#0b1020]">
      <div className="min-h-0 flex-1">
        <HtmlEditor
          content={draftContent}
          currentVersionIndex={currentVersionIndex}
          isCurrentVersion={isCurrentVersion}
          onSaveContent={handleSaveContent}
          status={status}
          suggestions={[]}
        />
      </div>
    </div>
  );
}

export const htmlArtifact = new Artifact<"html", Metadata>({
  kind: "html",
  description: "Useful for self-contained HTML pages, microsites, and demos.",
  initialize: ({ setMetadata }) => {
    setMetadata({
      view: "source",
    });
  },
  onStreamPart: ({ setArtifact, setMetadata, streamPart }) => {
    if (streamPart.type === "data-htmlDelta") {
      setMetadata((currentMetadata: Metadata | null) => {
        if (currentMetadata?.view === "source") {
          return currentMetadata;
        }

        return {
          ...(currentMetadata ?? {}),
          view: "source",
        };
      });

      setArtifact((draftArtifact) => ({
        ...draftArtifact,
        content: streamPart.data,
        isVisible:
          draftArtifact.status === "streaming" &&
          draftArtifact.content.length > 200 &&
          draftArtifact.content.length < 260
            ? true
            : draftArtifact.isVisible,
        status: "streaming",
      }));
    }
  },
  content: ({
    content,
    currentVersionIndex,
    isCurrentVersion,
    metadata,
    onSaveContent,
    status,
  }) => {
    return (
      <HtmlArtifactContent
        content={content}
        currentVersionIndex={currentVersionIndex}
        isCurrentVersion={isCurrentVersion}
        onSaveContent={onSaveContent}
        status={status}
        view={metadata?.view ?? "source"}
      />
    );
  },
  actions: [
    {
      icon: <UndoIcon size={18} />,
      description: "View Previous version",
      onClick: ({ handleVersionChange }) => {
        handleVersionChange("prev");
      },
      isDisabled: ({ currentVersionIndex }) => {
        if (currentVersionIndex === 0) {
          return true;
        }

        return false;
      },
    },
    {
      icon: <RedoIcon size={18} />,
      description: "View Next version",
      onClick: ({ handleVersionChange }) => {
        handleVersionChange("next");
      },
      isDisabled: ({ isCurrentVersion }) => {
        if (isCurrentVersion) {
          return true;
        }

        return false;
      },
    },
    {
      icon: <CopyIcon size={18} />,
      description: "Copy HTML to clipboard",
      onClick: ({ content }) => {
        navigator.clipboard.writeText(content);
        toast.success("Copied HTML to clipboard!");
      },
    },
  ],
  toolbar: [],
});
