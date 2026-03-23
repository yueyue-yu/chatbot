"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { FileUIPart, UIMessage } from "ai";
import equal from "fast-deep-equal";
import {
  ArrowUpIcon,
  BrainIcon,
  EyeIcon,
  GlobeIcon,
  WrenchIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  type ChangeEvent,
  type Dispatch,
  memo,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { useLocalStorage, useWindowSize } from "usehooks-ts";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import {
  type ChatModel,
  CUSTOM_MODEL_PROVIDER_ID,
  CUSTOM_MODEL_PROVIDER_NAME,
  createCustomChatModel,
  type ModelCapabilities,
  type ModelsResponse,
} from "@/lib/ai/models";
import type { Attachment, ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionAddScreenshot,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from "../ai-elements/prompt-input";
import { Button } from "../ui/button";
import { StopIcon } from "./icons";
import { PreviewAttachment } from "./preview-attachment";
import {
  type SlashCommand,
  SlashCommandMenu,
  slashCommands,
} from "./slash-commands";
import { SuggestedActions } from "./suggested-actions";
import type { VisibilityType } from "./visibility-selector";

function setCookie(name: string, value: string) {
  const maxAge = 60 * 60 * 24 * 365;
  // biome-ignore lint/suspicious/noDocumentCookie: needed for client-side cookie setting
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}`;
}

function PureMultimodalInput({
  chatId,
  input,
  setInput,
  status,
  stop,
  attachments,
  setAttachments,
  messages,
  setMessages,
  sendMessage,
  className,
  selectedVisibilityType,
  selectedModelId,
  onModelChange,
  searchEnabled,
  setSearchEnabled,
  editingMessage,
  onCancelEdit,
  isAskUserQuestionPending,
  isLoading,
}: {
  chatId: string;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  status: UseChatHelpers<ChatMessage>["status"];
  stop: UseChatHelpers<ChatMessage>["stop"];
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  messages: UIMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  sendMessage:
    | UseChatHelpers<ChatMessage>["sendMessage"]
    | (() => Promise<void>);
  className?: string;
  selectedVisibilityType: VisibilityType;
  selectedModelId: string;
  onModelChange?: (modelId: string) => void;
  searchEnabled: boolean;
  setSearchEnabled: (enabled: boolean) => void;
  editingMessage?: ChatMessage | null;
  onCancelEdit?: () => void;
  isAskUserQuestionPending: boolean;
  isLoading?: boolean;
}) {
  const router = useRouter();
  const { setTheme, resolvedTheme } = useTheme();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { width } = useWindowSize();
  const hasAutoFocused = useRef(false);
  useEffect(() => {
    // Delay the first focus until layout has settled; focusing immediately on
    // mount is noticeably less reliable on mobile and during shell transitions.
    if (!hasAutoFocused.current && width) {
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
        hasAutoFocused.current = true;
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [width]);

  const [localStorageInput, setLocalStorageInput] = useLocalStorage(
    "input",
    ""
  );
  const hasRestoredDraft = useRef(false);

  useEffect(() => {
    // Restore the saved draft only once. After that, the live in-memory input
    // becomes the source of truth and should not be overwritten by storage.
    if (hasRestoredDraft.current || !localStorageInput) {
      return;
    }

    hasRestoredDraft.current = true;
    setInput((currentInput) => currentInput || localStorageInput);
  }, [localStorageInput, setInput]);

  useEffect(() => {
    setLocalStorageInput(input);
  }, [input, setLocalStorageInput]);

  const handleInput = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const val = event.target.value;

    // Slash mode only applies while the user is typing the command token
    // itself. As soon as a space appears, we fall back to normal prompting.
    if (val.startsWith("/") && !val.includes(" ")) {
      setSlashOpen(true);
      setSlashQuery(val.slice(1));
      setSlashIndex(0);
    } else {
      setSlashOpen(false);
    }
  };

  const handleSlashSelect = (cmd: SlashCommand) => {
    setSlashOpen(false);
    setInput("");
    switch (cmd.action) {
      case "new":
        router.push("/");
        break;
      case "clear":
        setMessages(() => []);
        break;
      case "rename":
        toast("Rename is available from the sidebar chat menu.");
        break;
      case "model": {
        const modelBtn = document.querySelector<HTMLButtonElement>(
          "[data-testid='model-selector']"
        );
        modelBtn?.click();
        break;
      }
      case "theme":
        setTheme(resolvedTheme === "dark" ? "light" : "dark");
        break;
      case "delete":
        toast("Delete this chat?", {
          action: {
            label: "Delete",
            onClick: () => {
              fetch(
                `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/chat?id=${chatId}`,
                { method: "DELETE" }
              );
              router.push("/");
              toast.success("Chat deleted");
            },
          },
        });
        break;
      case "purge":
        toast("Delete all chats?", {
          action: {
            label: "Delete all",
            onClick: () => {
              fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/history`, {
                method: "DELETE",
              });
              router.push("/");
              toast.success("All chats deleted");
            },
          },
        });
        break;
      default:
        break;
    }
  };

  const [uploadQueue, setUploadQueue] = useState<string[]>([]);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  const { data: modelsResponse } = useSWR<ModelsResponse>(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/models`,
    (url: string) => fetch(url).then((r) => r.json()),
    { revalidateOnFocus: false, dedupingInterval: 3_600_000 }
  );
  const hasVision = modelsResponse?.capabilities.vision ?? false;

  const submitForm = useCallback(async () => {
    // Snapshot the composer state before clearing it so async sendMessage calls
    // cannot accidentally read a newer render's input or attachment list.
    const pendingText = input;
    const pendingAttachments = attachments;

    // Promote the blank-chat URL to /chat/:id on first submit so refresh and
    // resumable-stream logic can target the persisted thread immediately.
    window.history.pushState(
      {},
      "",
      `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${chatId}`
    );

    const pendingMessage: Parameters<
      UseChatHelpers<ChatMessage>["sendMessage"]
    >[0] = {
      role: "user",
      parts: [
        ...pendingAttachments.map((attachment) => ({
          type: "file" as const,
          url: attachment.url,
          name: attachment.name,
          mediaType: attachment.contentType,
        })),
        {
          type: "text" as const,
          text: pendingText,
        },
      ],
    };

    setAttachments([]);
    setLocalStorageInput("");
    setInput("");

    await sendMessage(pendingMessage);

    if (width && width > 768) {
      textareaRef.current?.focus();
    }
  }, [
    input,
    setInput,
    attachments,
    sendMessage,
    setAttachments,
    setLocalStorageInput,
    width,
    chatId,
  ]);

  const uploadFile = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/files/upload`,
        {
          method: "POST",
          body: formData,
        }
      );

      if (response.ok) {
        const data = await response.json();
        const { url, pathname, contentType } = data;

        return {
          url,
          name: pathname,
          contentType,
        };
      }
      const { error } = await response.json();
      toast.error(error);
    } catch (_error) {
      toast.error("Failed to upload file, please try again!");
    }
  }, []);

  const handleAddFiles = useCallback(
    async (fileList: File[] | FileList) => {
      const files = Array.from(fileList);

      if (files.length === 0) {
        return;
      }

      const queuedNames = files.map((file) => file.name);
      setUploadQueue((currentQueue) => [...currentQueue, ...queuedNames]);

      try {
        const uploadedAttachments = await Promise.all(
          files.map((file) => uploadFile(file))
        );
        const successfullyUploadedAttachments = uploadedAttachments.filter(
          (attachment): attachment is Attachment => attachment !== undefined
        );

        setAttachments((currentAttachments) => [
          ...currentAttachments,
          ...successfullyUploadedAttachments,
        ]);
      } catch (_error) {
        toast.error("Failed to upload files");
      } finally {
        setUploadQueue((currentQueue) => {
          const remainingQueue = [...currentQueue];

          for (const name of queuedNames) {
            const index = remainingQueue.indexOf(name);
            if (index >= 0) {
              remainingQueue.splice(index, 1);
            }
          }

          return remainingQueue;
        });
      }
    },
    [setAttachments, uploadFile]
  );

  const promptInputFiles = useMemo<(FileUIPart & { id: string })[]>(
    () =>
      attachments.map((attachment) => ({
        filename: attachment.name,
        id: attachment.url,
        mediaType: attachment.contentType,
        type: "file" as const,
        url: attachment.url,
      })),
    [attachments]
  );

  return (
    <div className={cn("relative flex w-full flex-col gap-4", className)}>
      {editingMessage && onCancelEdit && (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <span>Editing message</span>
          <button
            className="rounded px-1.5 py-0.5 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
            onMouseDown={(e) => {
              e.preventDefault();
              onCancelEdit();
            }}
            type="button"
          >
            Cancel
          </button>
        </div>
      )}

      {!editingMessage && isAskUserQuestionPending && (
        <div className="text-[12px] text-muted-foreground">
          Answer the question above to continue.
        </div>
      )}

      {!editingMessage &&
        !isLoading &&
        messages.length === 0 &&
        attachments.length === 0 &&
        uploadQueue.length === 0 && (
          // Starter actions only make sense for a truly empty composer. Hide
          // them as soon as the user starts typing or staging uploads.
          <SuggestedActions
            chatId={chatId}
            selectedVisibilityType={selectedVisibilityType}
            sendMessage={sendMessage}
          />
        )}

      <div className="relative">
        {slashOpen && (
          <SlashCommandMenu
            onClose={() => setSlashOpen(false)}
            onSelect={handleSlashSelect}
            query={slashQuery}
            selectedIndex={slashIndex}
          />
        )}
      </div>

      <PromptInputProvider
        files={promptInputFiles}
        onFileRemove={(id) => {
          setAttachments((currentAttachments) =>
            currentAttachments.filter((attachment) => attachment.url !== id)
          );
        }}
        onFilesAdd={handleAddFiles}
        onFilesClear={() => setAttachments([])}
        onValueChange={setInput}
        value={input}
      >
        <PromptInput
          accept="image/jpeg,image/png"
          className="[&>div]:rounded-2xl [&>div]:border [&>div]:border-border/30 [&>div]:bg-card/70 [&>div]:shadow-[var(--shadow-composer)] [&>div]:transition-shadow [&>div]:duration-300 [&>div]:focus-within:shadow-[var(--shadow-composer-focus)]"
          maxFileSize={5 * 1024 * 1024}
          multiple={true}
          onError={({ message }) => {
            toast.error(message);
          }}
          onSubmit={async () => {
            if (isAskUserQuestionPending) {
              return false;
            }
            // The composer submit key does triple duty: run slash commands,
            // send a normal message, or replace an edited message mid-stream.
            if (input.startsWith("/")) {
              const query = input.slice(1).trim();
              const cmd = slashCommands.find((c) => c.name === query);
              if (cmd) {
                handleSlashSelect(cmd);
              }
              return false;
            }
            if (!input.trim() && attachments.length === 0) {
              return false;
            }
            if (status === "ready" || status === "error") {
              await submitForm();
              return true;
            }

            if (
              editingMessage &&
              (status === "submitted" || status === "streaming")
            ) {
              await stop();
              await submitForm();
              return true;
            }

            toast.error("Please wait for the model to finish its response!");
            return false;
          }}
        >
          <PromptInputAttachmentsDisplay uploadQueue={uploadQueue} />
          <PromptInputBody>
            <PromptInputTextarea
              className="min-h-24 px-4 pt-3.5 pb-1.5 text-[13px] leading-relaxed placeholder:text-muted-foreground/35"
              data-testid="multimodal-input"
              disabled={isAskUserQuestionPending}
              onChange={handleInput}
              onKeyDown={(e) => {
                if (slashOpen) {
                  const filtered = slashCommands.filter((cmd) =>
                    cmd.name.startsWith(slashQuery.toLowerCase())
                  );
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSlashIndex((i) => Math.min(i + 1, filtered.length - 1));
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSlashIndex((i) => Math.max(i - 1, 0));
                    return;
                  }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    if (filtered[slashIndex]) {
                      handleSlashSelect(filtered[slashIndex]);
                    }
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setSlashOpen(false);
                    return;
                  }
                }
                if (e.key === "Escape" && editingMessage && onCancelEdit) {
                  e.preventDefault();
                  onCancelEdit();
                }
              }}
              placeholder={
                isAskUserQuestionPending
                  ? "Answer the question above..."
                  : editingMessage
                    ? "Edit your message..."
                    : "Ask anything..."
              }
              ref={textareaRef}
            />
          </PromptInputBody>
          <PromptInputFooter className="px-3 pb-3">
            <PromptInputTools>
              <ComposerActionMenu
                canAddImages={
                  hasVision && !isAskUserQuestionPending && status === "ready"
                }
              />
              <PromptInputButton
                aria-pressed={searchEnabled}
                className={cn(
                  "h-7 rounded-lg px-2 text-[12px] transition-colors",
                  searchEnabled
                    ? "bg-foreground text-background hover:bg-foreground/90"
                    : "text-muted-foreground hover:text-foreground"
                )}
                data-testid="search-button"
                disabled={isAskUserQuestionPending}
                onClick={(event) => {
                  event.preventDefault();
                  setSearchEnabled(!searchEnabled);
                }}
                variant={searchEnabled ? "default" : "ghost"}
              >
                <GlobeIcon size={16} />
                <span>Search</span>
              </PromptInputButton>
              <ModelSelectorCompact
                onModelChange={onModelChange}
                selectedModelId={selectedModelId}
              />
            </PromptInputTools>

            {status === "submitted" ? (
              <StopButton setMessages={setMessages} stop={stop} />
            ) : (
              <PromptInputSubmit
                className={cn(
                  "h-7 w-7 rounded-xl transition-all duration-200",
                  input.trim() || attachments.length > 0
                    ? "bg-foreground text-background hover:opacity-85 active:scale-95"
                    : "cursor-not-allowed bg-muted text-muted-foreground/25"
                )}
                data-testid="send-button"
                disabled={
                  isAskUserQuestionPending ||
                  uploadQueue.length > 0 ||
                  (!input.trim() && attachments.length === 0)
                }
                status={status}
                variant="secondary"
              >
                <ArrowUpIcon className="size-4" />
              </PromptInputSubmit>
            )}
          </PromptInputFooter>
        </PromptInput>
      </PromptInputProvider>
    </div>
  );
}

export const MultimodalInput = memo(
  PureMultimodalInput,
  (prevProps, nextProps) => {
    if (prevProps.input !== nextProps.input) {
      return false;
    }
    if (prevProps.status !== nextProps.status) {
      return false;
    }
    if (!equal(prevProps.attachments, nextProps.attachments)) {
      return false;
    }
    if (prevProps.selectedVisibilityType !== nextProps.selectedVisibilityType) {
      return false;
    }
    if (prevProps.selectedModelId !== nextProps.selectedModelId) {
      return false;
    }
    if (prevProps.searchEnabled !== nextProps.searchEnabled) {
      return false;
    }
    if (prevProps.editingMessage !== nextProps.editingMessage) {
      return false;
    }
    if (prevProps.isLoading !== nextProps.isLoading) {
      return false;
    }
    if (prevProps.messages.length !== nextProps.messages.length) {
      return false;
    }

    return true;
  }
);

function PromptInputAttachmentsDisplay({
  uploadQueue,
}: {
  uploadQueue: string[];
}) {
  const promptInputAttachments = usePromptInputAttachments();

  if (promptInputAttachments.files.length === 0 && uploadQueue.length === 0) {
    return null;
  }

  return (
    <div
      className="flex w-full self-start flex-row gap-2 overflow-x-auto px-3 pt-3 no-scrollbar"
      data-testid="attachments-preview"
    >
      {promptInputAttachments.files.map((attachment) => (
        <PreviewAttachment
          attachment={{
            contentType: attachment.mediaType ?? "",
            name: attachment.filename ?? "image",
            url: attachment.url,
          }}
          key={attachment.id}
          onRemove={() => promptInputAttachments.remove(attachment.id)}
        />
      ))}

      {uploadQueue.map((filename) => (
        <PreviewAttachment
          attachment={{
            contentType: "",
            name: filename,
            url: "",
          }}
          isUploading={true}
          key={filename}
        />
      ))}
    </div>
  );
}

function ComposerActionMenu({ canAddImages }: { canAddImages: boolean }) {
  return (
    <PromptInputActionMenu>
      <PromptInputActionMenuTrigger data-testid="composer-action-menu-trigger" />
      <PromptInputActionMenuContent>
        <PromptInputActionAddAttachments
          disabled={!canAddImages}
          label="Add images"
        />
        <PromptInputActionAddScreenshot
          disabled={!canAddImages}
          label="Add screenshot"
          onError={(message) => {
            toast.error(message);
          }}
        />
      </PromptInputActionMenuContent>
    </PromptInputActionMenu>
  );
}

function PureModelSelectorCompact({
  selectedModelId,
  onModelChange,
}: {
  selectedModelId: string;
  onModelChange?: (modelId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { data: modelsData } = useSWR<ModelsResponse>(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/models`,
    (url: string) => fetch(url).then((r) => r.json()),
    { revalidateOnFocus: false, dedupingInterval: 3_600_000 }
  );

  const capabilities: ModelCapabilities | undefined = modelsData?.capabilities;
  const configuredModels = modelsData?.models ?? [];
  const defaultModel = modelsData?.defaultModel;
  const customModelId = query.trim();

  const applyModel = useCallback(
    (modelId: string) => {
      const trimmedModelId = modelId.trim();

      if (!trimmedModelId) {
        return;
      }

      onModelChange?.(trimmedModelId);
      setCookie("chat-model", trimmedModelId);
      setOpen(false);
      setQuery("");
      // Return focus to the composer so keyboard users can keep typing without
      // an extra click after switching models.
      setTimeout(() => {
        document
          .querySelector<HTMLTextAreaElement>(
            "[data-testid='multimodal-input']"
          )
          ?.focus();
      }, 50);
    },
    [onModelChange]
  );

  const selectedModel = configuredModels.find(
    (model) => model.id === selectedModelId
  ) ??
    (selectedModelId ? createCustomChatModel(selectedModelId) : undefined) ??
    defaultModel ??
    configuredModels[0] ?? {
      description: "Model served by your configured OpenAI-compatible provider",
      id: "",
      name: "Configured model",
      provider: CUSTOM_MODEL_PROVIDER_ID,
    };
  const showCustomOption =
    customModelId.length > 0 &&
    !configuredModels.some((model) => model.id === customModelId);

  return (
    <ModelSelector onOpenChange={setOpen} open={open}>
      <ModelSelectorTrigger asChild>
        <Button
          className="h-7 max-w-[200px] justify-between gap-1.5 rounded-lg px-2 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          data-testid="model-selector"
          variant="ghost"
        >
          <ModelSelectorLogo provider={CUSTOM_MODEL_PROVIDER_ID} />
          <ModelSelectorName>{selectedModel.name}</ModelSelectorName>
        </Button>
      </ModelSelectorTrigger>
      <ModelSelectorContent>
        <ModelSelectorInput
          onValueChange={setQuery}
          placeholder="Search or enter model..."
          value={query}
        />
        <ModelSelectorList>
          {showCustomOption && (
            <ModelSelectorGroup heading="Custom">
              <ModelSelectorItem
                className={cn(
                  "flex w-full",
                  customModelId === selectedModel.id &&
                    "border-b border-dashed border-foreground/50"
                )}
                onSelect={() => applyModel(customModelId)}
                value={`custom:${customModelId}`}
              >
                <ModelSelectorLogo provider={CUSTOM_MODEL_PROVIDER_ID} />
                <ModelSelectorName>
                  Use custom model: {customModelId}
                </ModelSelectorName>
                <div className="ml-auto flex items-center gap-2 text-foreground/70">
                  {capabilities?.tools && <WrenchIcon className="size-3.5" />}
                  {capabilities?.vision && <EyeIcon className="size-3.5" />}
                  {capabilities?.reasoning && (
                    <BrainIcon className="size-3.5" />
                  )}
                </div>
              </ModelSelectorItem>
            </ModelSelectorGroup>
          )}

          {configuredModels.length > 0 && (
            <ModelSelectorGroup heading={CUSTOM_MODEL_PROVIDER_NAME}>
              {configuredModels.map((model: ChatModel) => (
                <ModelSelectorItem
                  className={cn(
                    "flex w-full",
                    model.id === selectedModel.id &&
                      "border-b border-dashed border-foreground/50"
                  )}
                  key={model.id}
                  onSelect={() => applyModel(model.id)}
                  value={model.id}
                >
                  <ModelSelectorLogo provider={CUSTOM_MODEL_PROVIDER_ID} />
                  <ModelSelectorName>{model.name}</ModelSelectorName>
                  <div className="ml-auto flex items-center gap-2 text-foreground/70">
                    {capabilities?.tools && <WrenchIcon className="size-3.5" />}
                    {capabilities?.vision && <EyeIcon className="size-3.5" />}
                    {capabilities?.reasoning && (
                      <BrainIcon className="size-3.5" />
                    )}
                  </div>
                </ModelSelectorItem>
              ))}
            </ModelSelectorGroup>
          )}
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  );
}

const ModelSelectorCompact = memo(PureModelSelectorCompact);

function PureStopButton({
  stop,
  setMessages,
}: {
  stop: UseChatHelpers<ChatMessage>["stop"];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
}) {
  return (
    <Button
      className="h-7 w-7 rounded-xl bg-foreground p-1 text-background transition-all duration-200 hover:opacity-85 active:scale-95 disabled:bg-muted disabled:text-muted-foreground/25 disabled:cursor-not-allowed"
      data-testid="stop-button"
      onClick={async (event) => {
        event.preventDefault();
        await stop();
        setMessages((messages) => messages);
      }}
    >
      <StopIcon size={14} />
    </Button>
  );
}

const StopButton = memo(PureStopButton);
