"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { usePathname } from "next/navigation";
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import useSWR, { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { hasPendingAskUserQuestion } from "@/components/chat/ask-user-question-state";
import { useDataStream } from "@/components/chat/data-stream-provider";
import { getChatHistoryPaginationKey } from "@/components/chat/sidebar-history";
import { toast } from "@/components/chat/toast";
import type { VisibilityType } from "@/components/chat/visibility-selector";
import { useAutoResume } from "@/hooks/use-auto-resume";
import {
  buildChatRequestBody,
  isResolvedAskUserQuestionMessage,
} from "@/lib/chat/chat-request-body";
import type { Vote } from "@/lib/db/schema";
import { ChatbotError } from "@/lib/errors";
import type { ChatMessage } from "@/lib/types";
import { fetcher, fetchWithErrorHandlers, generateUUID } from "@/lib/utils";

type ActiveChatContextValue = {
  chatId: string;
  messages: ChatMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  addToolOutput: UseChatHelpers<ChatMessage>["addToolOutput"];
  status: UseChatHelpers<ChatMessage>["status"];
  stop: UseChatHelpers<ChatMessage>["stop"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  visibilityType: VisibilityType;
  isReadonly: boolean;
  isLoading: boolean;
  votes: Vote[] | undefined;
  currentModelId: string;
  setCurrentModelId: (id: string) => void;
  searchEnabled: boolean;
  setSearchEnabled: (enabled: boolean) => void;
  isAskUserQuestionPending: boolean;
};

const ActiveChatContext = createContext<ActiveChatContextValue | null>(null);

function extractChatId(pathname: string): string | null {
  const match = pathname.match(/\/chat\/([^/]+)/);
  return match ? match[1] : null;
}

export function ActiveChatProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { setDataStream } = useDataStream();
  const { mutate } = useSWRConfig();

  const chatIdFromUrl = extractChatId(pathname);
  const isNewChat = !chatIdFromUrl;
  // New chats do not have a persisted id in the URL yet, but the composer and
  // optimistic message state still need a stable key. We keep one synthetic id
  // per "blank chat" visit and rotate it when the route changes back to /chat.
  const newChatIdRef = useRef(generateUUID());
  const prevPathnameRef = useRef(pathname);

  if (isNewChat && prevPathnameRef.current !== pathname) {
    newChatIdRef.current = generateUUID();
  }
  prevPathnameRef.current = pathname;

  const chatId = chatIdFromUrl ?? newChatIdRef.current;

  const [currentModelId, setCurrentModelId] = useState("");
  // The transport callback can outlive the render that created it, so mirror
  // the selected model in a ref and read that ref at submit time.
  const currentModelIdRef = useRef(currentModelId);
  useEffect(() => {
    currentModelIdRef.current = currentModelId;
  }, [currentModelId]);

  const [searchEnabled, setSearchEnabled] = useState(false);
  const searchEnabledRef = useRef(searchEnabled);
  useEffect(() => {
    searchEnabledRef.current = searchEnabled;
  }, [searchEnabled]);

  const [input, setInput] = useState("");

  const { data: chatData, isLoading } = useSWR(
    isNewChat
      ? null
      : `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/messages?chatId=${chatId}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const initialMessages: ChatMessage[] = isNewChat
    ? []
    : (chatData?.messages ?? []);
  const initialVisibilityType: VisibilityType = isNewChat
    ? "private"
    : (chatData?.visibility ?? "private");
  // Visibility can change locally before the server response catches up. This
  // chat-scoped SWR entry keeps the latest local choice from flickering back
  // to the fetched fallback during revalidation.
  const { data: localVisibility, mutate: setLocalVisibility } =
    useSWR<VisibilityType>(`${chatId}-visibility`, null, {
      fallbackData: initialVisibilityType,
    });
  const visibilityType: VisibilityType =
    chatData?.visibility ?? localVisibility ?? initialVisibilityType;

  useEffect(() => {
    if (chatData?.visibility) {
      setLocalVisibility(chatData.visibility, { revalidate: false });
    }
  }, [chatData?.visibility, setLocalVisibility]);

  // useChat owns the canonical message timeline for the active thread. Artifact
  // updates still arrive on the same SSE stream, but we siphon those custom
  // data parts into the artifact side channel via onData below.
  const {
    messages,
    setMessages,
    sendMessage,
    addToolOutput,
    status,
    stop,
    regenerate,
    resumeStream,
  } = useChat<ChatMessage>({
    id: chatId,
    messages: initialMessages,
    generateId: generateUUID,
    transport: new DefaultChatTransport({
      api: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/chat`,
      fetch: fetchWithErrorHandlers,
      prepareSendMessagesRequest(request) {
        return {
          body: {
            // Read the model from the ref so late submits do not accidentally
            // send using a stale render's model selection.
            ...buildChatRequestBody({
              chatId: request.id,
              messages: request.messages,
              searchEnabled: searchEnabledRef.current,
              selectedChatModel: currentModelIdRef.current,
              selectedVisibilityType: visibilityType,
            }),
            ...request.body,
          },
        };
      },
    }),
    sendAutomaticallyWhen: ({ messages }) =>
      isResolvedAskUserQuestionMessage(messages.at(-1)),
    onData: (dataPart) => {
      // Forward artifact/tool side-channel events (data-kind, data-textDelta,
      // data-finish, etc.) to DataStreamHandler, which updates the artifact UI.
      setDataStream((ds) => (ds ? [...ds, dataPart] : []));
    },
    onFinish: () => {
      mutate(unstable_serialize(getChatHistoryPaginationKey));
    },
    onError: (error) => {
      if (error instanceof ChatbotError) {
        toast({ type: "error", description: error.message });
      } else {
        toast({
          type: "error",
          description: error.message || "Oops, an error occurred!",
        });
      }
    },
  });

  // Once a chat has been seeded into useChat, do not push fetched history back
  // into it on every SWR refresh or we would overwrite local streaming state.
  const loadedChatIds = useRef(new Set<string>());

  if (isNewChat && !loadedChatIds.current.has(newChatIdRef.current)) {
    loadedChatIds.current.add(newChatIdRef.current);
  }

  useEffect(() => {
    if (loadedChatIds.current.has(chatId)) {
      return;
    }
    if (chatData?.messages) {
      loadedChatIds.current.add(chatId);
      setMessages(chatData.messages);
    }
  }, [chatId, chatData?.messages, setMessages]);

  const prevChatIdRef = useRef(chatId);
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      setSearchEnabled(false);
      if (isNewChat) {
        // The provider stays mounted across route changes, so clear the in-
        // memory transcript when the user lands on a fresh, unsaved chat shell.
        setMessages([]);
      }
    }
  }, [chatId, isNewChat, setMessages]);

  useEffect(() => {
    const cookieModel = document.cookie
      .split("; ")
      .find((row) => row.startsWith("chat-model="))
      ?.split("=")[1];

    if (cookieModel) {
      setCurrentModelId(decodeURIComponent(cookieModel));
    }
  }, []);

  const hasAppendedQueryRef = useRef(false);
  useEffect(() => {
    // Some entry points deep-link with ?query=... . Turn that into a real user
    // message once, then rewrite the URL so refreshes do not resend it.
    const params = new URLSearchParams(window.location.search);
    const query = params.get("query");
    if (query && !hasAppendedQueryRef.current) {
      hasAppendedQueryRef.current = true;
      window.history.replaceState(
        {},
        "",
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${chatId}`
      );
      sendMessage({
        role: "user" as const,
        parts: [{ type: "text", text: query }],
      });
    }
  }, [sendMessage, chatId]);

  // Stream resumption only applies to persisted chats whose initial history has
  // loaded; new chats have no server-side stream to reconnect to.
  useAutoResume({
    autoResume: !isNewChat && !!chatData,
    initialMessages,
    resumeStream,
    setMessages,
  });

  const isReadonly = isNewChat ? false : (chatData?.isReadonly ?? false);
  const isAskUserQuestionPending = useMemo(
    () => hasPendingAskUserQuestion(messages),
    [messages]
  );

  const { data: votes } = useSWR<Vote[]>(
    !isReadonly && messages.length >= 2
      ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/vote?chatId=${chatId}`
      : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const value = useMemo<ActiveChatContextValue>(
    () => ({
      chatId,
      messages,
      setMessages,
      sendMessage,
      addToolOutput,
      status,
      stop,
      regenerate,
      input,
      setInput,
      visibilityType,
      isReadonly,
      isLoading: !isNewChat && isLoading,
      votes,
      currentModelId,
      setCurrentModelId,
      searchEnabled,
      setSearchEnabled,
      isAskUserQuestionPending,
    }),
    [
      chatId,
      messages,
      setMessages,
      sendMessage,
      addToolOutput,
      status,
      stop,
      regenerate,
      input,
      visibilityType,
      isReadonly,
      isNewChat,
      isLoading,
      votes,
      currentModelId,
      searchEnabled,
      isAskUserQuestionPending,
    ]
  );

  return (
    <ActiveChatContext.Provider value={value}>
      {children}
    </ActiveChatContext.Provider>
  );
}

export function useActiveChat() {
  const context = useContext(ActiveChatContext);
  if (!context) {
    throw new Error("useActiveChat must be used within ActiveChatProvider");
  }
  return context;
}
