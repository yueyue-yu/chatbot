# 01. 端到端总览

这一章只回答一个问题：

> 一次 `/api/chat` 请求，是怎么从服务端 SSE/UI stream 一路走到右侧 `Artifact` 面板的？

结论先说：

> 这条链路里，服务端负责创建并写出 UI message stream，`useChat()` 负责在前端接住消息与 data parts，`useActiveChat` 只负责转发 data parts，`DataStreamHandler` 才真正把这些事件翻译成 `useArtifact` 的 UI 状态更新。

---

## 1. 先看最小主链路

```text
POST /api/chat
  -> createUIMessageStream()
     -> tool / artifact handler 写 data-*
        -> useChat({ onData }) 收到 data part
           -> useActiveChat 把 data part 推进 DataStreamProvider
              -> DataStreamHandler 消费当前批次
                 -> useArtifact / metadata 更新
                    -> Artifact 面板重渲染
```

这条链路里最容易读错的点有两个：

- `useChat` 负责的是“聊天消息主流”，不是 Artifact 状态机
- `DataStreamProvider` 存的是中间事件，不是最终 UI 真相

---

## 2. 服务端：先创建 UI message stream

这一段代码决定了聊天主链路的最外层形状。

```ts
const stream = createUIMessageStream<ChatMessage>({
  originalMessages: uiMessages,
  execute: async ({ writer: dataStream }) => {
    const agent = createChatAgent({
      dataStream,
      modelId: chatModel,
      requestHints,
      session,
    });

    const agentStream = await createAgentUIStream({
      abortSignal: request.signal,
      agent,
      uiMessages,
      onError: (error) => { /* ... */ },
      sendReasoning: capabilities.reasoning,
    });

    dataStream.merge(
      agentStream as unknown as ReadableStream<
        Parameters<typeof dataStream.write>[0]
      >
    );

    if (titlePromise) {
      const title = await titlePromise;
      dataStream.write({ type: "data-chat-title", data: title });
      updateChatTitleById({ chatId: id, title });
    }
  },
  generateId: generateUUID,
  onFinish: async ({ isAborted, responseMessage }) => { /* ... */ },
});
```

这段代码改变的不是某个具体 UI 字段，而是**整条流的宿主关系**：

- `createUIMessageStream()` 创建的是前端可消费的 UI message stream，不只是裸文本 token 流。
- `execute({ writer: dataStream })` 把一个可写 writer 交给项目代码。
- `createChatAgent({ dataStream })` 让 agent/tool 能在主聊天流旁路写入 `data-*` 事件。
- `dataStream.merge(agentStream)` 把 agent 产出的 UI message parts 合并进当前流。
- `data-chat-title` 说明同一条流里不只会有 Artifact 事件，也会有 sidebar 相关事件。

换句话说：

> `/api/chat` 返回的不是“assistant 文本流”，而是一条包含 messages 和 data parts 的复合 UI stream。

---

## 3. 客户端：`useChat` 先接住这条流

前端并不是手写 `EventSource` 来消费这条流，而是通过 `useChat()`。

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
});
```

这里最关键的是 `onData`。

它做的事情非常克制：

- 不解析 `dataPart.type`
- 不直接操作 `useArtifact`
- 不关心这是 `data-kind` 还是 `data-textDelta`

它只做一件事：

> 把当前收到的 data part 追加到独立的 `dataStream` 队列。

这说明：

- `useChat` 是消息流主内核
- `useActiveChat` 是聊天会话总控
- 但 `useActiveChat` 不是 Artifact 事件解释器

---

## 4. `DataStreamProvider`：中间事件缓冲层

`DataStreamProvider` 的实现非常小，但它在架构上很重要。

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

这段代码改变的状态含义是：

- `dataStream` 只是一个当前批次的 data part 队列
- 它存的是“还没被解释的事件”
- 它不等于当前 Artifact 状态
- 它也不等于聊天消息列表

所以它更接近：

> SSE data parts 的短生命周期中转站。

---

## 5. `DataStreamHandler`：真正把事件翻译成 UI 状态

真正开始解释 `data-kind` / `data-textDelta` / `data-finish` 的地方，是这里。

```ts
useEffect(() => {
  if (!dataStream?.length) {
    return;
  }

  const newDeltas = dataStream.slice();
  setDataStream([]);

  for (const delta of newDeltas) {
    if (delta.type === "data-chat-title") {
      mutate(unstable_serialize(getChatHistoryPaginationKey));
      continue;
    }

    const artifactDefinition = artifactDefinitions.find(
      (currentArtifactDefinition) =>
        currentArtifactDefinition.kind === artifact.kind
    );

    if (artifactDefinition?.onStreamPart) {
      artifactDefinition.onStreamPart({
        streamPart: delta,
        setArtifact,
        setMetadata,
      });
    }

    setArtifact((draftArtifact) => {
      switch (delta.type) {
        case "data-id":
          return { ...draftArtifact, documentId: delta.data, status: "streaming" };
        case "data-title":
          return { ...draftArtifact, title: delta.data, status: "streaming" };
        case "data-kind":
          return { ...draftArtifact, kind: delta.data, status: "streaming" };
        case "data-clear":
          return { ...draftArtifact, content: "", status: "streaming" };
        case "data-finish":
          return { ...draftArtifact, status: "idle" };
        default:
          return draftArtifact;
      }
    });
  }
}, [dataStream, setArtifact, setMetadata, artifact, setDataStream, mutate]);
```

这段代码是真正的“桥接层”：

- 先复制再清空 `dataStream`，避免重复消费
- `data-chat-title` 直接走 sidebar 刷新，不进入 Artifact 主状态
- 类型专属 delta 先交给 artifact definition，例如 `text` / `code` / `html`
- 通用控制事件再统一进入 `setArtifact`

所以：

- `useActiveChat` 负责接
- `DataStreamProvider` 负责暂存
- `DataStreamHandler` 负责解释
- `useArtifact` 负责保存当前 UI 真相

---

## 6. 这条链路最后落在哪里

最后实际被 UI 消费的是 `useArtifact()`。

在运行时，右侧面板关心的是这些内容：

- 当前 `documentId`
- 当前 `kind`
- 当前 `title`
- 当前 `content`
- 当前 `status` 是 `streaming` 还是 `idle`
- 当前 `metadata`

这些都不在 `useChat().messages` 里直接存储。

也就是说，这个项目把两条流明确拆开了：

- 消息时间线：由 `useChat` 驱动
- Artifact 运行时状态：由 `data-*` 事件驱动，再落入 `useArtifact`

---

## 7. 这一章读完要记住什么

- `/api/chat` 返回的是 UI message stream，不只是文本流。
- `useChat({ onData })` 会接住 `data-*` parts，但不会自动替你更新 Artifact 面板。
- `useActiveChat` 只负责转发 data parts，不负责解释业务。
- `DataStreamProvider` 存的是中间事件，不是最终 UI 状态。
- `DataStreamHandler` 才是把 SSE/data parts 翻译成 Artifact UI 状态的关键桥。
