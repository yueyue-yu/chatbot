"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { BotIcon, SparklesIcon } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { DocumentPreview } from "@/components/chat/document-preview";
import { useArtifact, useArtifactSelector } from "@/hooks/use-artifact";
import type {
  AgentArtifactToolPart,
  AgentMessage,
} from "@/lib/agent/types";
import { sanitizeAgentUIMessages } from "@/lib/agent/sanitize-ui-messages";
import { cn, fetchWithErrorHandlers, generateUUID } from "@/lib/utils";
import { AgentArtifactPanel } from "./agent-artifact-panel";
import { AgentModelSelector } from "./agent-model-selector";

type ArtifactToolOutput = {
  content?: string;
  error?: string;
  id?: string;
  kind?: string;
  title?: string;
};

function isArtifactKind(
  kind: string | undefined
): kind is "text" | "code" | "image" | "sheet" {
  return (
    kind === "text" ||
    kind === "code" ||
    kind === "image" ||
    kind === "sheet"
  );
}

type ResolvedArtifactOutput = {
  id: string;
  kind: "text" | "code" | "image" | "sheet";
  title: string;
  toolCallId: string;
};

function getResolvedArtifactOutput(
  part: AgentArtifactToolPart
): ResolvedArtifactOutput | null {
  if (
    part.state !== "output-available" ||
    !part.output ||
    "error" in part.output ||
    !part.output.id ||
    !part.output.title ||
    !isArtifactKind(part.output.kind)
  ) {
    return null;
  }

  return {
    id: part.output.id,
    kind: part.output.kind,
    title: part.output.title,
    toolCallId: part.toolCallId,
  };
}

function findLatestArtifactOutput(messages: AgentMessage[]) {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];

    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex];

      if (
        part.type === "tool-createDocument" ||
        part.type === "tool-editDocument" ||
        part.type === "tool-updateDocument"
      ) {
        const output = getResolvedArtifactOutput(part);

        if (output) {
          return output;
        }
      }
    }
  }

  return null;
}

function ArtifactToolResultView({
  label,
  result,
}: {
  label: string;
  result: ArtifactToolOutput;
}) {
  const normalizedResultText = result.content
    ?.replace(" and is now visible to the user.", ".")
    ?.replace(" has been edited successfully.", " was edited successfully.")
    ?.replace(" has been updated successfully.", " was updated successfully.");

  return (
    <div className="space-y-3 text-sm">
      <div className="space-y-1">
        <p className="font-medium text-foreground">Action</p>
        <p className="text-muted-foreground">{label}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-1 rounded-lg border border-border/60 bg-muted/40 p-3">
          <p className="font-medium text-foreground">Artifact ID</p>
          <p className="break-all text-muted-foreground">{result.id ?? "—"}</p>
        </div>
        <div className="space-y-1 rounded-lg border border-border/60 bg-muted/40 p-3">
          <p className="font-medium text-foreground">Title</p>
          <p className="text-muted-foreground">{result.title ?? "—"}</p>
        </div>
        <div className="space-y-1 rounded-lg border border-border/60 bg-muted/40 p-3">
          <p className="font-medium text-foreground">Kind</p>
          <p className="text-muted-foreground">{result.kind ?? "—"}</p>
        </div>
      </div>

      <div className="space-y-1 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
        <p className="font-medium text-foreground">Result</p>
        <p className="text-muted-foreground">
          {normalizedResultText ?? "The tool completed successfully."}
        </p>
      </div>
    </div>
  );
}

function getToolLabel(part: AgentArtifactToolPart) {
  switch (part.type) {
    case "tool-createDocument":
      return "Create document";
    case "tool-editDocument":
      return "Edit document";
    case "tool-updateDocument":
      return "Update document";
    default:
      return "Tool";
  }
}

function AgentToolPart({ part }: { part: AgentArtifactToolPart }) {
  const label = getToolLabel(part);

  return (
    <Tool className="w-full max-w-2xl" defaultOpen>
      <ToolHeader state={part.state} title={label} type={part.type} />
      <ToolContent>
        {(part.state === "input-available" || part.state === "output-available") &&
          part.input && <ToolInput input={part.input} />}

        {part.state === "output-available" && part.output && (
          "error" in part.output ? (
            <ToolOutput errorText={part.output.error} output={undefined} />
          ) : (
            <ToolOutput
              errorText={undefined}
              output={
                <ArtifactToolResultView
                  label={label}
                  result={part.output as ArtifactToolOutput}
                />
              }
            />
          )
        )}

        {part.state === "output-error" && (
          <ToolOutput errorText={part.errorText} output={undefined} />
        )}
      </ToolContent>
    </Tool>
  );
}

function AgentMessageItem({ message }: { message: AgentMessage }) {
  const isUser = message.role === "user";

  return (
    <Message className="max-w-full" data-role={message.role} from={message.role}>
      {message.parts.map((part, index) => {
        const key = `${message.id}-${index}`;

        if (part.type === "text") {
          return (
            <MessageContent
              className={cn(
                "max-w-[min(100%,64ch)] text-[13px] leading-[1.7]",
                isUser
                  ? "w-fit rounded-2xl rounded-br-lg border border-border/40 bg-secondary px-4 py-3 shadow-[var(--shadow-card)]"
                  : "rounded-2xl border border-border/30 bg-background/80 px-4 py-3 shadow-[var(--shadow-card)]"
              )}
              key={key}
            >
              <MessageResponse>{part.text}</MessageResponse>
            </MessageContent>
          );
        }

        if (
          part.type === "tool-createDocument" ||
          part.type === "tool-editDocument" ||
          part.type === "tool-updateDocument"
        ) {
          const artifactOutput = getResolvedArtifactOutput(part);

          return (
            <Fragment key={key}>
              <AgentToolPart part={part} />
              {artifactOutput && (
                <div className="w-full max-w-[450px]">
                  <DocumentPreview
                    isReadonly={false}
                    result={{
                      id: artifactOutput.id,
                      kind: artifactOutput.kind,
                      title: artifactOutput.title,
                    }}
                  />
                </div>
              )}
            </Fragment>
          );
        }

        return null;
      })}
    </Message>
  );
}

function AgentThinkingMessage() {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-xl border border-border/50 bg-muted/70 text-muted-foreground">
        <SparklesIcon className="size-4" />
      </div>
      <div className="flex min-h-12 items-center">
        <Shimmer className="font-medium text-sm" duration={1}>
          Agent is planning...
        </Shimmer>
      </div>
    </div>
  );
}

export function AgentDemo() {
  const [input, setInput] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const chatIdRef = useRef(generateUUID());
  const selectedModelRef = useRef(selectedModelId);
  const lastOpenedArtifactToolCallIdRef = useRef<string | null>(null);
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);
  const { setArtifact } = useArtifact();
  selectedModelRef.current = selectedModelId;

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/agent`,
        fetch: (request, init) =>
          fetchWithErrorHandlers(request, init, "agent"),
        prepareSendMessagesRequest(request) {
          return {
            body: {
              messages: sanitizeAgentUIMessages(request.messages),
              selectedModel: selectedModelRef.current,
              ...request.body,
            },
          };
        },
      }),
    []
  );

  const { messages, sendMessage, status, stop } = useChat<AgentMessage>({
    id: chatIdRef.current,
    transport,
    onError: (error) => {
      setErrorMessage(error.message || "The agent demo failed.");
    },
  });

  const isBusy = status === "submitted" || status === "streaming";

  useEffect(() => {
    const latestArtifact = findLatestArtifactOutput(messages);

    if (
      !latestArtifact ||
      latestArtifact.toolCallId === lastOpenedArtifactToolCallIdRef.current
    ) {
      return;
    }

    lastOpenedArtifactToolCallIdRef.current = latestArtifact.toolCallId;

    setArtifact((currentArtifact) => ({
      ...currentArtifact,
      content:
        currentArtifact.documentId === latestArtifact.id
          ? currentArtifact.content
          : "",
      documentId: latestArtifact.id,
      isVisible: true,
      kind: latestArtifact.kind,
      status: "idle",
      title: latestArtifact.title,
    }));
  }, [messages, setArtifact]);

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden rounded-[28px] border border-border/50 bg-background/80 shadow-[var(--shadow-float)] backdrop-blur-xl">
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col overflow-hidden",
          isArtifactVisible && "md:w-[40%]"
        )}
      >
        <div className="border-b border-border/50 px-5 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/60 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                <BotIcon className="size-3.5" />
                Agent Mode
              </div>
              <h2 className="font-semibold text-lg text-foreground">
                Document tool agent demo
              </h2>
              <p className="max-w-2xl text-sm text-muted-foreground">
                Ask the agent to draft or revise a saved document, code artifact,
                or sheet with the built-in document tools.
              </p>
            </div>

            <AgentModelSelector
              onModelChange={setSelectedModelId}
              selectedModelId={selectedModelId}
            />
          </div>

          {errorMessage && (
            <div
              className="mt-3 rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              data-testid="agent-error"
              role="alert"
            >
              {errorMessage}
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <Conversation className="min-h-0 flex-1">
            <ConversationContent className="mx-auto flex w-full max-w-4xl gap-5 px-4 py-6 md:px-6">
              {messages.length === 0 ? (
                <ConversationEmptyState
                  description="Try prompts like “draft release notes”, “create a Python script”, or “rewrite the previous document to be shorter.”"
                  icon={<BotIcon className="size-10" />}
                  title="Start the agent demo"
                />
              ) : (
                messages.map((message) => (
                  <AgentMessageItem key={message.id} message={message} />
                ))
              )}

              {status === "submitted" &&
                messages.at(-1)?.role !== "assistant" && <AgentThinkingMessage />}
            </ConversationContent>

            <ConversationScrollButton />
          </Conversation>

          <div className="border-t border-border/50 bg-background/90 px-4 py-4 md:px-6">
            <div className="mx-auto w-full max-w-4xl">
              <PromptInput
                className="w-full"
                onSubmit={() => {
                  const trimmedInput = input.trim();

                  if (!trimmedInput) {
                    return;
                  }

                  setErrorMessage(null);
                  sendMessage({
                    parts: [{ text: trimmedInput, type: "text" }],
                    role: "user",
                  });
                  setInput("");
                }}
              >
                <PromptInputTextarea
                  className="min-h-24"
                  data-testid="agent-input"
                  onChange={(event) => setInput(event.currentTarget.value)}
                  placeholder="Ask the agent to create or modify a document, script, or sheet..."
                  value={input}
                />

                <PromptInputFooter>
                  <PromptInputTools>
                    <p className="px-2 text-xs text-muted-foreground">
                      Tools:{" "}
                      <span className="font-medium text-foreground">
                        createDocument / editDocument / updateDocument
                      </span>
                    </p>
                  </PromptInputTools>

                  <PromptInputSubmit
                    data-testid={isBusy ? "agent-stop-button" : "agent-send-button"}
                    disabled={!isBusy && !input.trim()}
                    onStop={stop}
                    status={status}
                  />
                </PromptInputFooter>
              </PromptInput>
            </div>
          </div>
        </div>
      </div>

      <AgentArtifactPanel />
    </div>
  );
}
