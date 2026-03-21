# `useActiveChat` 详细代码分析

本文档专门分析 `hooks/use-active-chat.tsx`。

它不是一个普通小 hook，而是聊天主页面最核心的客户端状态入口。你可以把它理解成：

> 当前聊天会话在前端的总控制器。

如果你只读一个 hook，就先读它。

---

## 1. 文件定位

文件路径：

- `hooks/use-active-chat.tsx`

它主要服务于：

- `components/chat/shell.tsx`

并间接影响：

- 消息列表
- 输入框
- artifact 面板
- 模型选择
- chat 可见性
- 自动恢复流
- vote 加载

它向外暴露的不是零散工具函数，而是一整套“当前会话上下文”。

---

## 2. 先看它解决什么问题

聊天页如果不做统一封装，组件层会遇到这些复杂问题：

- 当前到底是新 chat 还是已有 chat？
- chatId 从哪里来？
- 历史消息怎么加载？
- `useChat()` 怎么初始化？
- 当前模型 id 怎么记住？
- 可见性从哪里读？
- 遇到流错误怎么统一提示？
- URL 上的 `?query=` 怎么自动变成首条消息？
- 页面重载后要不要尝试 resume？
- votes 什么时候加载？

`useActiveChat` 的存在，就是把这些问题统一收敛到一个地方。

所以它的核心职责是：

> 统一管理“当前聊天会话”的路由状态、服务端初始数据、AI SDK 对话状态、局部 UI 状态和衍生业务状态。

---

## 3. 导出的其实是两层能力

这个文件不是只有一个 hook，而是：

1. `ActiveChatProvider`
2. `useActiveChat()`

### `ActiveChatProvider`
真正持有状态，负责创建上下文。

### `useActiveChat()`
只是一个安全读取器：

```ts
export function useActiveChat() {
  const context = useContext(ActiveChatContext);
  if (!context) {
    throw new Error("useActiveChat must be used within ActiveChatProvider");
  }
  return context;
}
```

这意味着组件必须运行在 Provider 内部，否则直接报错。

这是一个典型的“Context Provider + useX Hook”模式。

---

## 4. 对外暴露了哪些状态

`ActiveChatContextValue` 定义了它对外输出的完整接口：

- `chatId`
- `messages`
- `setMessages`
- `sendMessage`
- `status`
- `stop`
- `regenerate`
- `input`
- `setInput`
- `visibilityType`
- `isReadonly`
- `isLoading`
- `votes`
- `currentModelId`
- `setCurrentModelId`

这基本覆盖了聊天主界面最常见的所有依赖。

从设计上看，这里输出的是三类状态：

### A. 会话主状态
- `chatId`
- `messages`
- `status`
- `isReadonly`
- `isLoading`

### B. 用户交互状态
- `input`
- `setInput`
- `currentModelId`
- `setCurrentModelId`
- `visibilityType`

### C. 行为方法
- `sendMessage`
- `setMessages`
- `stop`
- `regenerate`

---

## 5. `extractChatId()`：先从路由判断当前是什么 chat

```ts
function extractChatId(pathname: string): string | null {
  const match = pathname.match(/\/chat\/([^/]+)/);
  return match ? match[1] : null;
}
```

它的作用很简单：

- 从当前 pathname 提取 `/chat/:id` 中的 id
- 如果没有匹配到，返回 `null`

但这个函数意义很大，因为后续整个 hook 的第一层分支都建立在这里：

- 有 chatId：已有会话
- 没 chatId：新会话

这是整个 hook 的起点。

---

## 6. `chatIdFromUrl` / `isNewChat`：第一层状态分叉

```ts
const chatIdFromUrl = extractChatId(pathname);
const isNewChat = !chatIdFromUrl;
```

这里把页面状态分成两种：

### 已有会话页
例如：

- `/chat/abc-123`

### 新会话页
例如：

- `/`
- 或没有 chat id 的新会话入口

后面很多逻辑都会依赖这个布尔值：

- 是否去请求 `/api/messages`
- `initialMessages` 是否为空
- `visibilityType` 初始值如何确定
- `isLoading` 是否有意义
- 是否应该触发 `useAutoResume`

---

## 7. 新会话为什么也要预先生成 chatId

```ts
const newChatIdRef = useRef(generateUUID());
const prevPathnameRef = useRef(pathname);

if (isNewChat && prevPathnameRef.current !== pathname) {
  newChatIdRef.current = generateUUID();
}
prevPathnameRef.current = pathname;

const chatId = chatIdFromUrl ?? newChatIdRef.current;
```

这段很关键。

很多项目会在“真正发送第一条消息”时才生成 chat id，但你这里不是。

你这里的策略是：

- 如果是新会话页，也先生成一个前端 UUID
- 并把它当成当前 chatId 使用

### 这样做的好处

#### 1. 状态统一
无论新 chat 还是旧 chat，组件层都总能拿到一个 `chatId`。

#### 2. 提前稳定
输入框、artifact、消息组件等都可以基于同一个 id 工作，不用担心“还没有 id”。

#### 3. 首次发送更简单
第一次调用 `sendMessage()` 时，服务端可以直接拿这个 id 创建 chat 记录。

### 为什么用 `ref` 而不是 `state`

因为它不需要触发重渲染，只需要在当前新会话生命周期内保持稳定。

### 为什么监听 pathname 变化

因为如果用户从一个新会话入口切到另一个新会话入口，应该重新给它一个新的临时 chatId，而不是复用旧的。

所以这段逻辑本质上是在做：

> 为“没有持久化 chat 记录的新会话页”创建一个稳定但可切换的临时身份。

---

## 8. 模型状态：`currentModelId`

```ts
const [currentModelId, setCurrentModelId] = useState("");
const currentModelIdRef = useRef(currentModelId);
useEffect(() => {
  currentModelIdRef.current = currentModelId;
}, [currentModelId]);
```

这里同时用了：

- `state`
- `ref`

### 为什么不只用 state

因为 `prepareSendMessagesRequest()` 是 transport 配置的一部分，很容易遇到闭包捕获旧值的问题。

所以这里用了一个经典模式：

- `state` 负责驱动 UI
- `ref` 负责在回调里随时拿最新值

也就是说：

> `currentModelIdRef` 的存在，主要是为了避免 transport 回调里读到过期模型值。

这是一个实现层细节，但很重要。

---

## 9. 输入框状态：`input`

```ts
const [input, setInput] = useState("");
```

这个状态本身不复杂，但它放在 `useActiveChat` 里而不是 `MultimodalInput` 本地，说明了一个设计选择：

> 输入框文本也是“当前会话状态”的一部分，而不是单纯局部 UI 状态。

这样做的好处是：

- 输入内容可以在 shell / messages / 编辑消息场景间共享
- 编辑某条旧消息时，可以直接把原文写回同一个输入状态
- 组件树更干净，不需要层层传太多本地状态

---

## 10. 远程初始数据加载：`/api/messages`

```ts
const { data: chatData, isLoading } = useSWR(
  isNewChat
    ? null
    : `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/messages?chatId=${chatId}`,
  fetcher,
  { revalidateOnFocus: false }
);
```

这里是整个 hook 的服务端初始数据入口。

### 它做了什么

- 只有已有 chat 才请求 `/api/messages`
- 新 chat 不请求
- 返回值命名为 `chatData`

### `null` key 的含义

SWR 中 key 为 `null` 表示不发请求。

所以这段代码天然实现了：

- 新会话不打 `/api/messages`
- 避免无意义请求

### `/api/messages` 返回什么

结合服务端路由，它会返回：

- `messages`
- `visibility`
- `userId`
- `isReadonly`

如果 chat 不存在，还会给一个默认空结果。

所以 `chatData` 其实是：

> 当前 chat 的服务端快照。

---

## 11. `initialMessages`：把服务端消息快照变成 `useChat` 的初始值

```ts
const initialMessages: ChatMessage[] = isNewChat
  ? []
  : (chatData?.messages ?? []);
```

### 新 chat
- 没有历史消息，初始为空

### 已有 chat
- 使用接口返回的消息列表

这里最重要的点不是逻辑本身，而是角色：

> `initialMessages` 是“服务端已知历史”的客户端表示。

它不一定等于 `useChat()` 当前内存中的 messages，因为：

- `useChat()` 运行后，可能已经有新消息
- 可能有流式中的 assistant 消息
- 可能有本地变更尚未持久化

所以要区分：

- `initialMessages`：服务端快照
- `messages`：当前前端活跃会话状态

这是阅读后续代码的关键心智模型。

---

## 12. 可见性初始值与本地缓存

```ts
const initialVisibilityType: VisibilityType = isNewChat
  ? "private"
  : (chatData?.visibility ?? "private");
```

这里先拿一个基础初始值。

规则很直接：

- 新 chat 默认 private
- 旧 chat 用服务端 visibility
- 没拿到时兜底 private

然后再用 SWR 做本地状态缓存：

```ts
const { data: localVisibility, mutate: setLocalVisibility } =
  useSWR<VisibilityType>(`${chatId}-visibility`, null, {
    fallbackData: initialVisibilityType,
  });
```

这意味着可见性状态不是纯远端、也不是纯本地，而是两者叠加：

1. 服务端初始值
2. 本地乐观值缓存

最终值则是：

```ts
const visibilityType: VisibilityType =
  chatData?.visibility ?? localVisibility ?? initialVisibilityType;
```

优先级是：

1. 服务端最新值
2. 本地缓存值
3. 初始值

### 这段设计的意义

是为了兼容：

- 页面初次加载时从服务端拿值
- 页面内部切换可见性时本地即时响应
- 侧边栏和当前页状态同步

---

## 13. 用 effect 同步服务端 visibility 到本地缓存

```ts
useEffect(() => {
  if (chatData?.visibility) {
    setLocalVisibility(chatData.visibility, { revalidate: false });
  }
}, [chatData?.visibility, setLocalVisibility]);
```

这一步是“把服务端确认值写回本地缓存”的同步逻辑。

它解决的问题是：

- 本地可能先做过乐观更新
- 之后服务端返回了最终值
- 需要让本地缓存与服务端重新对齐

这里用 `{ revalidate: false }`，说明只是更新缓存，不要额外再发请求。

---

## 14. 核心：接入 `useChat()`

这是整个文件最重要的一段：

```ts
const {
  messages,
  setMessages,
  sendMessage,
  status,
  stop,
  regenerate,
  resumeStream,
} = useChat<ChatMessage>({ ... })
```

这里拿到的就是聊天运行时最核心的一组能力。

### 为什么 `useActiveChat` 必须包住 `useChat`

因为项目不是直接把 `useChat()` 暴露给页面组件，而是要在它外面补很多项目级逻辑：

- 路由到 chatId 的转换
- 服务端初始消息加载
- transport 请求体定制
- data stream 转发
- sidebar 历史刷新
- 错误 toast
- 自动恢复

所以 `useActiveChat` 的定位可以理解为：

> 项目版 `useChat` 适配器。

---

## 15. `id: chatId` 与 `messages: initialMessages`

```ts
id: chatId,
messages: initialMessages,
```

这两项配置决定了：

- 当前 `useChat` 实例对应哪个 chat
- 它启动时以哪些消息为历史上下文

### 注意点

`initialMessages` 只是初始化输入，不代表 `useChat` 后续会一直跟着 SWR 自动同步。

所以后面你会看到额外的 `setMessages(chatData.messages)` 逻辑，这正是为了处理“初始请求返回后，如何安全把历史消息灌进 useChat”的问题。

---

## 16. `generateId: generateUUID`

```ts
generateId: generateUUID,
```

这是统一消息 id 的地方。

作用：

- 用户消息在客户端创建时就有 id
- 后续服务端持久化和前端展示能保持一致
- 对消息编辑、投票、恢复流等逻辑都更稳定

这类配置平时不起眼，但在聊天产品里很重要，因为 message id 是很多后续链路的锚点。

---

## 17. `transport`：真正把前端 `useChat` 接到项目 `/api/chat`

```ts
transport: new DefaultChatTransport({
  api: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/chat`,
  fetch: fetchWithErrorHandlers,
  prepareSendMessagesRequest(request) { ... },
})
```

这里是项目和 AI SDK transport 层的适配点。

它决定了三件事：

### 1. 请求打到哪里
- `/api/chat`

### 2. 用什么 fetch
- `fetchWithErrorHandlers`
- 说明项目希望统一处理 fetch 错误语义

### 3. 请求体长什么样
- 由 `prepareSendMessagesRequest` 决定

---

## 18. `prepareSendMessagesRequest`：最关键的协议转换层

```ts
prepareSendMessagesRequest(request) {
  const lastMessage = request.messages.at(-1);

  if (!lastMessage || lastMessage.role !== "user") {
    throw new Error("Chat submissions must end with a user message.");
  }

  return {
    body: {
      id: request.id,
      message: lastMessage,
      messages: request.messages,
      selectedChatModel: currentModelIdRef.current,
      selectedVisibilityType: visibilityType,
      ...request.body,
    },
  };
}
```

这段是理解 `useActiveChat` 的关键。

### 18.1 为什么一定检查最后一条必须是 user

因为当前 `/api/chat` 的 POST 语义是：

- 由一条新的用户消息触发本轮生成
- 或在工具审批流里，基于完整 messages 继续

如果前端交给后端的最后一条不是 user，那么当前提交就不符合聊天提交语义。

所以这里提前在客户端做了一个防御性校验。

### 18.2 为什么同时传 `message` 和 `messages`

这里比很多同类项目更值得注意，因为它不是只传最后一条消息。

当前会传：

- `message: lastMessage`
- `messages: request.messages`

含义是：

#### `message`
表示“当前这次刚提交的用户消息”

#### `messages`
表示“前端当前持有的完整消息列表”

这个设计非常重要，因为服务端 `/api/chat` 已经支持两种路径：

1. 普通聊天流
2. 基于完整消息状态继续的工具相关流

也就是说，`useActiveChat` 这里已经为服务端更复杂的消息编排准备好了上下文，而不是简单只发一句新问题。

### 18.3 为什么模型 id 用 ref 读取

因为 transport 回调很容易闭包住旧值，所以这里必须用：

- `currentModelIdRef.current`

而不是直接用 `currentModelId`

### 18.4 为什么可见性直接放在请求体里

因为 chat 首次创建时，服务端需要知道新 chat 的 visibility。

因此它必须在首条消息请求中一起发送。

### 18.5 `...request.body`

这是为了保留 AI SDK transport 可能附带的额外字段，不把默认行为完全覆盖掉。

---

## 19. `onData`：把 data part 转发到项目 Artifact 流系统

```ts
onData: (dataPart) => {
  setDataStream((ds) => (ds ? [...ds, dataPart] : []));
},
```

这是主聊天中 Artifact 能工作的关键桥梁。

AI SDK 的消息流里除了普通文本，还可能有自定义 data part，例如：

- `data-kind`
- `data-id`
- `data-title`
- `data-clear`
- `data-textDelta`
- `data-codeDelta`
- `data-sheetDelta`
- `data-finish`
- `data-chat-title`

`useActiveChat` 不自己解析这些，而是把它们交给：

- `data-stream-provider`
- 然后由 `DataStreamHandler` 再分发到 Artifact 系统

这是一种很清晰的分层：

- `useActiveChat` 负责接
- `DataStreamHandler` 负责解释
- `useArtifact` 负责存
- `components/chat/artifact.tsx` 负责渲染

所以这段代码实际上是在做：

> 聊天主流与 Artifact 旁路流之间的桥接。

---

## 20. `onFinish`：刷新侧边栏历史缓存

```ts
onFinish: () => {
  mutate(unstable_serialize(getChatHistoryPaginationKey));
},
```

一轮消息完成后，最容易变的不是当前消息列表，而是侧边栏历史：

- 新 chat 可能刚被创建
- 标题可能刚生成
- 排序可能变化
- 可见性可能已经更新

所以这里主动刷新 chat history 的 SWR cache 是合理的。

这一步看起来小，但它保证了整个聊天产品的“列表视图”和“详情视图”一致。

---

## 21. `onError`：统一错误展示

```ts
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

这段体现了一个好设计：

- 页面组件不需要每个都自己 catch transport error
- 错误处理统一在会话状态层完成

同时它还区分了：

### 业务错误
`ChatbotError`

### 非业务错误
普通 Error / 未知异常

所以 `useActiveChat` 也扮演了：

> 聊天交互错误边界层

---

## 22. `loadedChatIds`：防止重复把历史消息灌进 `useChat`

```ts
const loadedChatIds = useRef(new Set<string>());

if (isNewChat && !loadedChatIds.current.has(newChatIdRef.current)) {
  loadedChatIds.current.add(newChatIdRef.current);
}
```

后面又有：

```ts
useEffect(() => {
  if (loadedChatIds.current.has(chatId)) {
    return;
  }
  if (chatData?.messages) {
    loadedChatIds.current.add(chatId);
    setMessages(chatData.messages);
  }
}, [chatId, chatData?.messages, setMessages]);
```

### 这段为什么存在

因为 `useChat({ messages: initialMessages })` 的初始化只发生在 hook 生命周期的一定阶段，而异步拉回来的 `chatData.messages` 可能在首次 render 之后才到。

如果不手动 `setMessages(chatData.messages)`，可能会出现：

- UI 用的是空消息初始化
- 后续没有正确把服务端历史同步进去

### 为什么又要防重

因为一旦你在 effect 里每次都 `setMessages(chatData.messages)`，会覆盖：

- 当前会话里新增的本地消息
- 正在流式生成的消息
- 用户编辑后的临时状态

所以必须确保：

> 每个 chat 的服务端历史只在“首次加载这个 chat”时灌入一次。

这就是 `loadedChatIds` 的价值。

### 对新 chat 的特殊处理

新 chat 本来就没有服务端历史，但也要标记为 loaded，避免一些切换时的重复逻辑。

---

## 23. `prevChatIdRef`：切换会话时清理 `useChat` 内存状态

```ts
const prevChatIdRef = useRef(chatId);
useEffect(() => {
  if (prevChatIdRef.current !== chatId) {
    prevChatIdRef.current = chatId;
    if (isNewChat) {
      setMessages([]);
    }
  }
}, [chatId, isNewChat, setMessages]);
```

### 它解决什么问题

当用户切换到一个新会话入口时，之前 `useChat` 内存里可能还留着旧消息。

所以如果检测到：

- chatId 变了
- 并且当前是新 chat

就把消息清空。

### 为什么只在 `isNewChat` 时清空

因为已有 chat 通常应该由远端历史来接管，而不是粗暴清空。

这段逻辑本质上是在做：

> 新会话场景下的内存状态隔离。

---

## 24. 从 cookie 恢复模型选择

```ts
useEffect(() => {
  const cookieModel = document.cookie
    .split("; ")
    .find((row) => row.startsWith("chat-model="))
    ?.split("=")[1];

  if (cookieModel) {
    setCurrentModelId(decodeURIComponent(cookieModel));
  }
}, []);
```

这段说明：

- 模型选择是有浏览器持久化偏好的
- 当前 chat 打开时，会先尝试恢复上次用过的模型

这提升了产品体验，也让模型状态不必每次都重新选择。

注意这里是客户端直接读 cookie，不需要额外请求。

---

## 25. `?query=` 自动发消息逻辑

```ts
const hasAppendedQueryRef = useRef(false);
useEffect(() => {
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
```

这是一个很实用但容易忽略的功能。

### 它的行为

如果 URL 上带 `query` 参数：

1. 只执行一次
2. 把当前 URL 改写成 `/chat/:id`
3. 自动发送一条用户消息

### 适用场景

- 从首页快捷入口跳转进 chat
- 从外部链接预填问题
- 某些模板按钮一键进入并发起对话

### 为什么要 `replaceState`

因为一旦 query 已经转成真正消息，就没必要继续留在地址栏里。

同时也避免刷新页面重复发送。

### 为什么要 `hasAppendedQueryRef`

防止 effect 因重渲染重复触发，造成重复发消息。

---

## 26. 接入自动恢复：`useAutoResume`

```ts
useAutoResume({
  autoResume: !isNewChat && !!chatData,
  initialMessages,
  resumeStream,
  setMessages,
});
```

这表示：

- 只有旧 chat 才考虑恢复
- 且必须先拿到 `chatData`

`useActiveChat` 在这里做的是 orchestration：

- 把恢复需要的上下文组织好
- 交给 `useAutoResume` 去判断是否恢复、如何并回消息

这是一种比较干净的职责分离。

---

## 27. 只读状态：`isReadonly`

```ts
const isReadonly = isNewChat ? false : (chatData?.isReadonly ?? false);
```

规则是：

- 新 chat 一定可写
- 已有 chat 则依据服务端返回决定

这个值非常重要，因为它决定了：

- 是否显示输入框
- 是否允许投票
- 是否允许某些交互动作

所以 `useActiveChat` 同时也扮演了：

> 当前用户对当前 chat 的权限状态读取器。

---

## 28. votes 加载策略

```ts
const { data: votes } = useSWR<Vote[]>(
  !isReadonly && messages.length >= 2
    ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/vote?chatId=${chatId}`
    : null,
  fetcher,
  { revalidateOnFocus: false }
);
```

这里很细致。

只有在满足这两个条件时才请求 votes：

1. 当前 chat 不是只读
2. 消息数至少 2 条

### 为什么这么做

#### 条件 1：不是只读
如果用户本身不能操作 chat，那加载 vote 价值不大。

#### 条件 2：至少 2 条消息
通常只有形成基本一问一答后，vote 才有意义。

这是一种小而有效的请求优化。

---

## 29. `value = useMemo(...)`：统一输出上下文值

最后把所有状态打包成一个 memoized value：

```ts
const value = useMemo<ActiveChatContextValue>(() => ({ ... }), [...deps])
```

这样做的目的主要是：

- 减少不必要的 context value 引用变化
- 避免消费组件无意义重渲染

虽然 `messages`、`status` 等变化还是会导致更新，但至少不是每次 render 都新建一个对象。

---

## 30. `useActiveChat()` 为什么要主动报错

```ts
if (!context) {
  throw new Error("useActiveChat must be used within ActiveChatProvider");
}
```

这是一种非常好的开发期防御。

如果某个组件脱离 Provider 使用：

- 不会静默拿到 `undefined`
- 不会在别处出现更难查的异常
- 而是立刻明确报错

对于这种核心上下文 hook，这是正确做法。

---

## 31. 它在 UI 中怎么被使用

`components/chat/shell.tsx` 是它最直接的消费方：

```ts
const {
  chatId,
  messages,
  setMessages,
  sendMessage,
  status,
  stop,
  regenerate,
  input,
  setInput,
  visibilityType,
  isReadonly,
  isLoading,
  votes,
  currentModelId,
  setCurrentModelId,
} = useActiveChat();
```

然后这些值继续往下分发给：

- `ChatHeader`
- `Messages`
- `MultimodalInput`
- `Artifact`

这说明 `useActiveChat` 并不是给某一个小组件服务，而是给整棵聊天 UI 子树服务。

---

## 32. 从架构视角重新总结它的职责

如果按架构责任划分，`useActiveChat` 同时做了 6 件事：

### 1. 路由适配
从 pathname 推出当前 chat 身份。

### 2. 初始数据加载
从 `/api/messages` 拉当前 chat 快照。

### 3. AI SDK 适配
把项目 chat 协议接到 `useChat()`。

### 4. 业务状态编排
管理模型、输入、可见性、只读、votes。

### 5. 流式数据桥接
把 onData 转发到 Artifact data stream 系统。

### 6. 生命周期增强
处理 query 自动发送、auto resume、错误 toast、sidebar 刷新。

这就是为什么它复杂，但也确实必须复杂。

---

## 33. 这段代码里最值得注意的设计点

这里挑几个最关键的设计亮点。

### 33.1 新会话先生成临时 chatId
这是很好的统一化处理，避免大量“无 id 状态”的分支。

### 33.2 `useChat` 外包一层项目适配器
让项目协议、错误处理、数据旁路都能集中处理。

### 33.3 `currentModelIdRef`
解决 transport 闭包读旧值问题。

### 33.4 `loadedChatIds`
避免异步历史消息重复覆盖当前对话状态。

### 33.5 `onData -> setDataStream`
是 Artifact 流式体验的核心桥。

### 33.6 `?query=` 自动发消息
说明这个 hook 还承担了“外部入口转 chat 行为”的产品职责。

---

## 34. 当前实现里需要特别留意的点

### 34.1 它的复杂度已经很高
这个 hook 现在同时处理：

- 路由
- SWR
- useChat
- 本地 state
- cookie
- auto resume
- query 自动发送
- votes
- data stream bridge

后续如果再加太多功能，可能就值得继续拆分。

### 34.2 `messages: request.messages` 的存在要和服务端配合理解
当前 transport 已经把完整 messages 一并发给 `/api/chat`，所以看文档时不要再以为服务端只收最后一条 `message`。

### 34.3 `initialMessages` 与 `messages` 要严格区分
这是理解聊天状态 bug 的关键。很多同步问题都来自把这两个概念混淆。

### 34.4 `useAutoResume` 能否生效取决于恢复链路是否闭环
它这里只是接入点，不是完整恢复系统本身。

---

## 35. 可以把它当成什么

如果给 `useActiveChat` 一个最准确的类比，我会说：

> 它是聊天前端的 session controller。

比起“hook”，它更像一个小型控制器：

- 管当前 chat 身份
- 管请求协议
- 管 UI 输入
- 管错误
- 管辅助状态
- 管和其他系统的桥接

---

## 36. 一句话总结

`useActiveChat` 的本质是：

> 以 `useChat()` 为内核，把路由、服务端 chat 快照、模型选择、可见性、流式 data part、自动恢复和投票等项目级能力编排成一个统一的当前会话上下文，供整个聊天页面共享。

---

## 37. 建议结合阅读的文件

为了真正看懂这份 hook，建议同时读：

- `components/chat/shell.tsx`
- `hooks/use-auto-resume.ts`
- `app/(chat)/api/chat/route.ts`
- `app/(chat)/api/messages/route.ts`
- `app/(chat)/actions.ts`
- `components/chat/data-stream-handler.tsx`
- `hooks/use-artifact.ts`
- `docs/chat-route.md`
- `docs/resume-stream.md`
- `docs/hooks.md`

如果你愿意，我下一步可以继续帮你做两件事：

1. **继续补更细的文档**
   - 专门写一篇 `useActiveChat` 时序图版文档
   - 画出“首次进入旧 chat / 新建 chat / query 自动发消息 / 恢复流”的四条执行链

2. **直接做测试/重构建议**
   - 帮你列 `useActiveChat` 应该覆盖的测试点
   - 或者给出如何拆分 `useActiveChat` 的重构方案
