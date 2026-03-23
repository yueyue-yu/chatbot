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

// 这里定义的是“当前激活聊天会话”的统一上下文接口。
// 页面不会直接到处散落 useChat/useSWR/useState，而是由 Provider 先把
// 当前会话所需的核心状态与操作编排好，再统一暴露给聊天壳子和子组件。
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

// 从当前路由中提取 /chat/:id 对应的 chat id。
// 如果没有命中，说明当前页面处在“新建会话”入口。
function extractChatId(pathname: string): string | null {
  const match = pathname.match(/\/chat\/([^/]+)/);
  return match ? match[1] : null;
}

export function ActiveChatProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { setDataStream } = useDataStream();
  const { mutate } = useSWRConfig();

  // 先根据 URL 判断当前是“已有聊天页”还是“空白新聊天页”。
  const chatIdFromUrl = extractChatId(pathname);
  const isNewChat = !chatIdFromUrl;
  // 新会话在真正保存到数据库之前，URL 中还没有持久化 chatId。
  // 但前端这时已经需要一个稳定身份来承载：
  // 1. useChat 的本地消息状态
  // 2. 输入框第一次发送时的目标会话 id
  // 3. Artifact / query deep-link / 乐观 UI 等依赖 chatId 的逻辑
  //
  // 所以这里会为每次“空白会话访问”先生成一个临时 id，并在切回新的
  // 空白路由时重新轮换，避免不同新会话意外共用同一个本地身份。
  const newChatIdRef = useRef(generateUUID());
  const prevPathnameRef = useRef(pathname);

  if (isNewChat && prevPathnameRef.current !== pathname) {
    newChatIdRef.current = generateUUID();
  }
  prevPathnameRef.current = pathname;

  const chatId = chatIdFromUrl ?? newChatIdRef.current;

  const [currentModelId, setCurrentModelId] = useState("");
  // transport 回调的生命周期可能长于创建它的那次 render。
  // 如果只捕获 state 闭包，晚到的提交有机会读到过期的模型选择；
  // 因此这里额外用 ref 镜像一份“最新模型 id”，提交时从 ref 读取。
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

  // 已有会话先从服务端拉一份 chat 快照；新会话则不发请求。
  // 这份快照承载的是“服务端当前已知状态”，例如历史消息、可见性和只读状态。
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
  // 可见性同时存在“服务端已保存值”和“当前页本地刚改过的值”两种来源。
  // 如果只信服务端返回，用户刚切换完 visibility，SWR revalidate 时
  // 界面就可能短暂闪回旧值。这里为每个 chat 单独缓存一份本地 visibility，
  // 避免服务端值回流时造成视觉抖动。
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

  // useChat 仍然是消息时间线的核心内核：
  // - messages / sendMessage / stop / regenerate 等能力都来自它
  // - 标准的聊天 SSE 流也由它消费
  //
  // 但项目不会把 useChat 直接暴露给页面，而是额外补上一层项目适配：
  // - 路由与 chatId 的衔接
  // - 初始历史消息加载
  // - 自定义请求体组装
  // - askUserQuestion 自动续发
  // - Artifact data part 分流
  // - 历史列表刷新与统一报错
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
            // 这里把 useChat 默认的发送请求改造成项目服务端真正期望的格式，
            // 同时从 ref 读取最新模型值，避免使用旧 render 捕获的 model。
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
    // askUserQuestion 工具在用户补完答案后，最后一条 assistant message
    // 会变成“已具备继续执行所需输出”的状态；此时无需再次手动点发送，
    // 直接自动续发，让后端拿着补全后的 toolMessage 继续推进 Agent 流程。
    sendAutomaticallyWhen: ({ messages }) =>
      isResolvedAskUserQuestionMessage(messages.at(-1)),
    onData: (dataPart) => {
      // 这里不解释 data part 的业务含义，只负责把它转发到独立的数据流通道；
      // 真正消费这些 data-kind / data-textDelta / data-finish 事件的是
      // DataStreamHandler 和 Artifact 系统。
      setDataStream((ds) => (ds ? [...ds, dataPart] : []));
    },
    onFinish: () => {
      // 回复结束后刷新侧边栏历史，确保新标题、排序等派生信息同步。
      mutate(unstable_serialize(getChatHistoryPaginationKey));
    },
    onError: (error) => {
      // 聊天链路中的异常统一收敛到 toast，避免每个消费组件各自处理。
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

  // 一旦某个 chat 已经把初始历史消息灌进 useChat，后续就不能在每次
  // SWR 刷新时再把服务端 messages 覆盖回来，否则本地流式中的 assistant
  // 消息、乐观状态或编辑中的结果都会被冲掉。因此这里按 chatId 记录
  // “是否已经完成首次灌入”，每个 chat 只同步一次初始历史。
  const loadedChatIds = useRef(new Set<string>());

  // 新会话没有服务端历史，但同样要视作“已初始化”，避免后续被误判为
  // 还需要从远端再灌一遍 messages。
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
        // Provider 在聊天页切换时通常不会卸载，所以切到一个全新的空白会话时，
        // 要主动清掉上一会话残留在 useChat 内存中的 transcript，避免串场。
        setMessages([]);
      }
    }
  }, [chatId, isNewChat, setMessages]);

  useEffect(() => {
    // 首次挂载时从 cookie 恢复用户上一次选择的模型，让 UI 与发送请求共用同一偏好。
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
    // 某些入口会通过 ?query=... 深链进入聊天页。
    // 这里会把 query 参数转成一条真正的用户消息，而且只执行一次；
    // 随后把 URL 改写成 /chat/:id，避免用户刷新页面后重复自动发送。
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

  // 自动恢复只适用于“已经持久化到服务端”的 chat。
  // 新会话没有可恢复的 SSE 流；而旧会话也必须先拿到历史消息，
  // 才能判断最后一条消息是否处于待恢复状态。
  useAutoResume({
    autoResume: !isNewChat && !!chatData,
    initialMessages,
    resumeStream,
    setMessages,
  });

  const isReadonly = isNewChat ? false : (chatData?.isReadonly ?? false);
  // 当消息流中还存在等待用户回答的 askUserQuestion tool 时，
  // 输入框会禁用普通发送；待用户通过 tool UI 提交答案后，
  // sendAutomaticallyWhen 会自动续发对应的 toolMessage。
  const isAskUserQuestionPending = useMemo(
    () => hasPendingAskUserQuestion(messages),
    [messages]
  );

  // 只有当前用户可操作的 chat，且消息数量至少达到一问一答后，才有必要请求 vote。
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
    // 固定 Context value 引用，减少下游消费者因为对象重新创建而发生的额外重渲染。
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
    // 整个聊天壳子及其下游组件都从这里读取“当前激活会话”的统一上下文。
    <ActiveChatContext.Provider value={value}>
      {children}
    </ActiveChatContext.Provider>
  );
}

export function useActiveChat() {
  const context = useContext(ActiveChatContext);
  if (!context) {
    // 强制要求在 Provider 内使用，能让接线错误尽早暴露。
    throw new Error("useActiveChat must be used within ActiveChatProvider");
  }
  return context;
}
