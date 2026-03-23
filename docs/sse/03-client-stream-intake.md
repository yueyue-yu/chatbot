# 03. 客户端如何接住这条流

这一章回答的是：

> 服务端已经把 UI message stream 写出来了，前端到底怎么把它接住，又为什么没有立刻直接改 `Artifact` 面板？

结论先说：

> 客户端真正的接流入口是 `useChat()`；`useActiveChat` 在这里做的是项目级 orchestration，而不是 data protocol 解析。它把 data parts 放进 `DataStreamProvider`，等 `DataStreamHandler` 再做真正的业务翻译。

---

## 1. `useChat()` 仍然是前端消息主内核

这一段是前端接流入口的核心。

```ts
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
          ...buildChatRequestBody({
            chatId: request.id,
            messages: request.messages,
            selectedChatModel: currentModelIdRef.current,
            selectedVisibilityType: visibilityType,
          }),
          ...request.body,
        },
      };
    },
  }),
  onData: (dataPart) => {
    setDataStream((ds) => (ds ? [...ds, dataPart] : []));
  },
  onFinish: () => {
    mutate(unstable_serialize(getChatHistoryPaginationKey));
  },
  onError: (error) => { /* ... */ },
});
```

这段代码让 `useChat` 继续承担这些职责：

- 管 `messages`
- 管 `status`
- 管 `sendMessage` / `stop` / `regenerate`
- 管流式 assistant 回复本身
- 管恢复流入口 `resumeStream`

也就是说：

> 项目并没有绕开 `useChat` 自己写一套 SSE 消费器，而是在它上面再包一层项目适配。

---

## 2. `useActiveChat` 在这里真正做了什么

最关键的是 `onData`。

```ts
onData: (dataPart) => {
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
```

这一段把 `useActiveChat` 的角色钉得很清楚：

- `onData`
  只转发，不解释事件
- `onFinish`
  只做 sidebar 历史刷新
- `onError`
  只做统一错误提示

所以它在 SSE 主链路里的定位不是：

- “收到一条 `data-kind` 后直接打开 Artifact 面板”

而是：

- “把 `useChat` 收到的 data part 交给下一层专门处理”

这也是为什么 `useActiveChat` 可以同时管理：

- 路由
- `useChat`
- 初始历史消息
- 输入框状态
- 模型选择
- data part 转发

它是 orchestration 层，而不是单一数据结构的 store。

---

## 3. 为什么要单独放一个 `DataStreamProvider`

`DataStreamProvider` 的实现很小，但它回答了一个重要问题：

> `onData` 收到的 event 为什么不直接改 `useArtifact`？

看它的实现：

```ts
type DataStreamContextValue = {
  dataStream: DataUIPart<CustomUIDataTypes>[];
  setDataStream: React.Dispatch<
    React.SetStateAction<DataUIPart<CustomUIDataTypes>[]>
  >;
};

const DataStreamContext = createContext<DataStreamContextValue | null>(null);

export function DataStreamProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [dataStream, setDataStream] = useState<DataUIPart<CustomUIDataTypes>[]>(
    []
  );

  const value = useMemo(() => ({ dataStream, setDataStream }), [dataStream]);

  return (
    <DataStreamContext.Provider value={value}>
      {children}
    </DataStreamContext.Provider>
  );
}
```

这段代码的意义在于把两类东西分开：

- 聊天会话状态
- 待解释的 data parts

它没有任何 Artifact 业务知识：

- 不知道 `data-kind` 是什么
- 不知道 `data-textDelta` 应该 append
- 不知道 `data-chat-title` 应该刷新 sidebar

它只是提供一个共享队列，让当前页面树里另一个消费者来解释。

---

## 4. 这一层为什么不能直接用 `messages`

很多人第一次读这里会想：

> 既然 `useChat()` 已经在管消息，为什么不把 `data-*` 直接塞进 `messages` 里统一处理？

当前实现没有这么做，是因为 data parts 和 messages 的职责不同：

- `messages`
  是聊天时间线
- `dataStream`
  是驱动旁路 UI 的控制信号

如果把它们混在一起，会有几个问题：

- `Artifact` 面板会被迫从消息时间线里自己解析控制信号
- sidebar 标题刷新和 suggestions metadata 这种旁路事件会失去清晰边界
- “消息主流”和“UI 控制流”会混成一套接口

所以这里刻意保留了第二条通道。

---

## 5. `useActiveChat` 为什么没有直接依赖 `useArtifact`

从代码结构看，`useActiveChat` 没有直接 import `useArtifact`。

这不是巧合，而是边界设计：

- `useActiveChat`
  负责“当前会话”的总编排
- `useArtifact`
  负责“右侧面板”的共享运行时状态

这两者通过 `DataStreamProvider -> DataStreamHandler` 连接，而不是直接耦合。

这样带来的好处是：

- `useActiveChat` 不需要知道每个 Artifact 类型怎么消费 delta
- `Artifact` 系统可以独立演进自己的 `onStreamPart` 协议
- `data-chat-title` 这种非 Artifact 事件也能复用同一条 data 通道

---

## 6. 这一章读完要记住什么

- 客户端真正的接流入口是 `useChat()`，不是手写 `EventSource`。
- `useActiveChat` 的 `onData` 只负责把 data parts 推进队列，不直接改 UI。
- `DataStreamProvider` 是短生命周期事件队列，不是 Artifact store。
- `messages` 和 `dataStream` 是两条不同职责的前端通道。
- 后续真正的业务翻译要看 `DataStreamHandler` 和 `useArtifact`。
