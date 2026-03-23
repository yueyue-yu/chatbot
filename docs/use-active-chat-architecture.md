# `useActiveChat` 架构梳理

本文档不是逐行翻译代码，而是从“系统位置”和“调用链”两个角度，完整解释 `hooks/use-active-chat.tsx` 在当前项目里的职责。

适合以下场景：

- 第一次接手聊天页，想快速建立整体心智模型
- 读到 `useActiveChat()`，但不清楚它为什么比普通 hook 复杂很多
- 想弄明白它和 `useChat()` 的关系
- 想追踪一次发消息是怎么从输入框一路走到 `/api/chat` 的
- 想知道 `askUserQuestion`、`DataStreamHandler`、自动恢复、投票这些能力为什么都挂在这里

---

## 1. 一句话定义

`useActiveChat` 的本质是：

> 以 `useChat()` 为消息内核，把“路由里的 chat 身份”“服务端历史快照”“请求体适配”“工具续发”“Artifact 侧通道”“投票与可见性”等项目级能力编排成一个统一的当前会话上下文。

所以它不是一个“小工具 hook”，而是聊天页当前会话的总入口。

---

## 2. 它在页面树里的位置

### 2.1 上级调用链

当前聊天页的大致挂载关系如下：

```txt
app/(chat)/layout.tsx
└─ DataStreamProvider
   └─ SidebarShell
      └─ ActiveChatProvider
         └─ ChatShell
            ├─ ChatHeader
            ├─ Messages
            ├─ MultimodalInput
            ├─ Artifact
            └─ DataStreamHandler
```

对应关系：

- `app/(chat)/layout.tsx`
  - 负责页面总布局
  - 提供 `DataStreamProvider`
  - 在聊天区域内部挂上 `ActiveChatProvider`
- `hooks/use-active-chat.tsx`
  - 提供 `ActiveChatProvider`
  - 也提供 `useActiveChat()` 给下游消费
- `components/chat/shell.tsx`
  - 是最核心的消费者
  - 先一次性取出 `chatId / messages / sendMessage / status / input / visibilityType / votes / currentModelId` 等状态
  - 再分发给 `Messages`、`MultimodalInput`、`Artifact`

### 2.2 下级消费者

`useActiveChat()` 当前最主要的消费方包括：

- `components/chat/shell.tsx`
  - 主消费者
  - 负责把上下文拆给消息列表、输入框、Artifact 面板
- `components/chat/ask-user-question-tool.tsx`
  - 使用 `addToolOutput`
  - 使用 `messages`
  - 使用 `status`
  - 用户完成工具卡片输入后，把答案写回当前会话

可以把它理解为：

- 上游负责“把 Provider 挂好”
- `useActiveChat` 负责“把当前会话整理好”
- 下游负责“消费当前会话并渲染具体 UI”

---

## 3. 它对外暴露的是什么

`ActiveChatContextValue` 暴露的是一整套会话上下文，而不是零散函数。

### 3.1 会话主状态

- `chatId`
- `messages`
- `status`
- `isReadonly`
- `isLoading`

### 3.2 输入与交互状态

- `input`
- `setInput`
- `currentModelId`
- `setCurrentModelId`
- `visibilityType`
- `isAskUserQuestionPending`

### 3.3 运行操作

- `sendMessage`
- `setMessages`
- `addToolOutput`
- `stop`
- `regenerate`

### 3.4 业务衍生数据

- `votes`

这说明它的定位不是“单纯代理 `useChat`”，而是“当前聊天会话的统一 façade”。

---

## 4. 先别急着看 `useChat`，第一层分叉其实是路由

`use-active-chat.tsx` 最早做的事情不是发请求，而是先根据 `pathname` 判断当前是：

- 已有会话：`/chat/:id`
- 新建会话：没有 `chatId`

核心辅助函数：

```ts
function extractChatId(pathname: string): string | null
```

它只做一件事：

- 从 `/chat/:id` 提取 `id`
- 提取不到就返回 `null`

这一步非常重要，因为后续所有行为都会以它为分叉点：

- 要不要请求 `/api/messages`
- 初始消息是不是空数组
- 可见性从哪里来
- 是否允许自动恢复
- `isLoading` 是否有意义

---

## 5. 为什么新会话也要先生成一个 `chatId`

这段逻辑是整个文件最容易被忽略、但最关键的地方之一。

文件没有采用“等用户发第一条消息后再生成 id”的策略，而是：

- 只要当前是新会话页
- 就先生成一个前端临时 `chatId`

这样做的原因是：

### 5.1 统一心智模型

对下游组件来说：

- 新 chat 和旧 chat 都有 `chatId`
- 不需要写两套分支判断“当前有没有 id”

### 5.2 支撑第一次发送

`MultimodalInput` 第一次提交时会先：

```ts
window.history.pushState({}, "", `/chat/${chatId}`)
```

也就是说：

- 前端先用这个 id 把 URL 提升为 `/chat/:id`
- 然后再把消息提交到 `/api/chat`
- 后端如果发现这个 chat 不存在，就据此创建 chat 记录

### 5.3 让本地状态提前稳定

以下能力都希望在“首次落库前”就已经有一个稳定会话身份：

- `useChat` 的本地消息状态
- Artifact 面板
- deep-link query 自动发消息
- 侧边行为与页面状态关联

所以这里的 `chatId` 不是“数据库是否已有记录”的同义词，而是：

> 当前会话在前端运行时的稳定身份。

---

## 6. 服务端快照层：`/api/messages`

`useActiveChat` 不会直接把 `useChat` 当作第一手数据源，而是先通过 SWR 读取服务端快照：

```ts
GET /api/messages?chatId=...
```

当前接口返回：

- `messages`
- `visibility`
- `userId`
- `isReadonly`

它的角色不是“持续实时数据源”，而是：

> 当前 chat 在服务端侧的初始快照。

这个快照主要用于初始化：

- `initialMessages`
- `initialVisibilityType`
- `isReadonly`

需要特别区分两类状态：

- `chatData.messages`
  - 服务端历史快照
- `useChat().messages`
  - 当前前端运行中的真实会话时间线

一旦 `useChat` 跑起来，后者就会比前者更新得更快。

---

## 7. 可见性为什么不用普通 `useState`

`visibilityType` 的来源有两层：

1. 服务端返回的已保存值
2. 当前页面本地刚选择的最新值

所以这里使用了一个“chat 级别的本地 SWR key”：

```ts
useSWR<VisibilityType>(`${chatId}-visibility`, null, {
  fallbackData: initialVisibilityType,
})
```

这样做的意义是：

- 页面第一次打开时，先有服务端初始值
- 本地切换 visibility 时，UI 可以立即响应
- SWR 重校验时，不会因为服务端值晚一步返回而短暂闪回

最终优先级为：

1. `chatData?.visibility`
2. `localVisibility`
3. `initialVisibilityType`

这是一种“服务端快照 + 本地乐观缓存”的组合策略。

---

## 8. `useChat` 是内核，但不是最终对外接口

`useActiveChat` 内部真正调用了：

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
} = useChat<ChatMessage>({...})
```

也就是说，聊天运行时内核仍然是 AI SDK 的 `useChat()`。

但项目没有直接把它丢给页面，而是围绕它做了二次封装。

### 8.1 这层封装补了什么

- 把路由和 `chatId` 接到 `useChat`
- 把 `/api/messages` 拉回来的历史消息接到 `useChat`
- 把项目自己的 `/api/chat` 请求体协议接到 transport
- 把工具输出和自动续发接到 `useChat`
- 把自定义 `data-*` 事件分流给 Artifact 系统
- 把异常统一转成 toast
- 把回复结束后的历史刷新接到 SWR
- 把恢复流逻辑接到 `useAutoResume`

所以可以把 `useActiveChat` 看成：

> 项目版 `useChat` 适配器 + 当前会话 orchestrator。

---

## 9. 它是如何在 `useChat` 之上做封装的

这一节是本文最关键的部分。

### 9.1 `id: chatId`

`useChat` 运行在当前会话身份上：

```ts
id: chatId
```

这个 `chatId` 既可能来自 URL，也可能来自前端为新会话生成的临时 id。

### 9.2 `messages: initialMessages`

这里传入的是“服务端快照里的历史消息”：

```ts
messages: initialMessages
```

注意：

- 它只是初始化输入
- 不是说以后 SWR 变化了，`useChat` 就会自动同步

也正因为如此，文件后面还有一段“只灌一次初始历史”的保护逻辑。

### 9.3 `generateId: generateUUID`

统一消息 id 生成策略，保证：

- 本地消息创建时就有稳定 id
- 后续编辑、投票、恢复等流程都能依附这个 id

### 9.4 `transport: new DefaultChatTransport(...)`

这一层是关键中的关键。

当前项目并不是直接用 `useChat` 默认请求体，而是显式指定：

- `api: /api/chat`
- `fetch: fetchWithErrorHandlers`
- `prepareSendMessagesRequest(request)`

`DefaultChatTransport` 在这里的职责，是把 `useChat` 的发送动作真正落到项目自己的后端接口上。

### 9.5 `prepareSendMessagesRequest` 做了什么

默认情况下，`useChat` 只知道自己有：

- `id`
- `messages`
- 可选的 `body`

但当前项目的 `/api/chat` 期望的请求体是一个 union：

```ts
type ChatRequestBody =
  | {
      id: string;
      message: UserMessage;
      selectedChatModel: string;
      selectedVisibilityType: VisibilityType;
    }
  | {
      id: string;
      toolMessage: AssistantToolMessage;
      selectedChatModel: string;
      selectedVisibilityType: VisibilityType;
    };
```

因此 `prepareSendMessagesRequest` 的工作就是：

- 读取当前 `request.id`
- 读取当前 `request.messages`
- 结合 `currentModelIdRef.current`
- 结合 `visibilityType`
- 调用 `buildChatRequestBody(...)`
- 重新组装成项目服务端能识别的请求体

这就是“在 `useChat` 之上的封装”最实质的一层。

换句话说：

> `useChat` 只负责聊天运行时；`useActiveChat` 负责把聊天运行时翻译成项目后端协议。

---

## 10. `buildChatRequestBody` 把什么翻译成什么

`lib/chat/chat-request-body.ts` 是 `useActiveChat` 的重要下游依赖。

它会检查最后一条消息是什么类型，然后做分流：

### 10.1 普通用户消息

如果最后一条是 `role === "user"`，则发送：

```json
{
  "id": "chat-id",
  "message": { "...": "最后一条用户消息" },
  "selectedChatModel": "当前模型",
  "selectedVisibilityType": "public | private"
}
```

### 10.2 `askUserQuestion` 已回答后的工具消息

如果最后一条不是普通用户消息，而是一个已经补齐输出的 `tool-askUserQuestion` assistant message，则发送：

```json
{
  "id": "chat-id",
  "toolMessage": { "...": "最后一条 assistant tool message" },
  "selectedChatModel": "当前模型",
  "selectedVisibilityType": "public | private"
}
```

这就是为什么当前项目可以支持：

- 正常提问继续聊天
- 用户在工具卡片中补充信息后继续聊天

而不需要页面组件自己拼请求体。

---

## 11. `sendAutomaticallyWhen` 为什么存在

这一段是当前项目最像“高级封装”的地方：

```ts
sendAutomaticallyWhen: ({ messages }) =>
  isResolvedAskUserQuestionMessage(messages.at(-1))
```

含义是：

- 当最后一条消息变成“已完成 askUserQuestion 回答”的 assistant message 时
- 自动再次提交请求
- 不要求用户手动点第二次发送

### 11.1 对应的实际用户体验

一次典型流程是：

1. 用户发普通问题
2. 服务端返回一条 assistant message，其中某个 part 是 `tool-askUserQuestion`
3. `AskUserQuestionTool` 渲染按钮或输入框
4. 用户点选答案
5. 组件调用 `addToolOutput(...)`
6. 最后一条 assistant message 状态从“等待输入”变成“输出已就绪”
7. `sendAutomaticallyWhen` 命中条件
8. `useChat` 自动再次发请求
9. `/api/chat` 收到的是 `toolMessage` 而不是新的 user message

这使得“用户补充回答后继续运行 Agent”成为一个自然的链路。

---

## 12. `addToolOutput` 在这里的角色

`useActiveChat` 会把 `addToolOutput` 也暴露出去。

下游最典型的消费者是：

- `components/chat/ask-user-question-tool.tsx`

它的职责是：

- 从 `useActiveChat()` 里取出 `addToolOutput`
- 当用户在工具卡片里完成选择或填写文本时
- 调用 `addToolOutput({ tool, toolCallId, output })`

也就是说：

- `useChat` 提供 tool output 写回能力
- `useActiveChat` 统一把这项能力接入当前会话上下文
- 具体工具 UI 再按业务类型消费这项能力

---

## 13. 自定义 `data-*` 事件为什么不直接放在 `messages`

项目里不只有普通聊天文本流，还有 Artifact 相关的自定义事件，比如：

- `data-kind`
- `data-id`
- `data-title`
- `data-clear`
- `data-finish`
- `data-textDelta`
- `data-chat-title`

这些并不都适合塞进普通消息时间线。

因此当前设计是：

1. `useChat({ onData })` 收到这些 data part
2. `useActiveChat` 在 `onData` 中调用 `setDataStream(...)`
3. `DataStreamHandler` 读取 `DataStreamProvider` 中的数据
4. 再分发给 Artifact 状态机或历史刷新逻辑

所以：

- `messages` 负责聊天主时间线
- `dataStream` 负责 Artifact / 标题 / 其他侧通道事件

这是一个典型的“双通道”设计。

---

## 14. 为什么还需要 `loadedChatIds`

这是文件里另一个容易误读的点。

表面上看，既然 `useChat({ messages: initialMessages })` 已经传了初始消息，为什么后面还要手动：

```ts
setMessages(chatData.messages)
```

原因是：

- `chatData` 可能在首次 render 后才异步回来
- 而 `useChat` 的初始化时机已经过去了

所以需要在 `chatData.messages` 真正拿到以后，手动灌一次历史消息。

但这件事又只能做一次。

如果每次 SWR 刷新都这样做，就会把以下本地状态冲掉：

- 正在流式生成的 assistant 内容
- 乐观追加的本地消息
- 编辑中的本地消息时间线

因此这里才有：

```ts
const loadedChatIds = useRef(new Set<string>())
```

它的语义是：

> 每个 chat 最多只允许把服务端历史灌进 `useChat` 一次。

---

## 15. 为什么切换到新会话时要主动 `setMessages([])`

`ActiveChatProvider` 挂在聊天布局内部，路由切换时它通常不会卸载。

这意味着：

- 上一个会话的 `useChat` 内存状态可能还在
- 如果直接进入一个新的空白 chat 壳子，不主动清理就可能“串场”

所以当检测到：

- `chatId` 变了
- 且当前是新会话

就会执行：

```ts
setMessages([])
```

这一步的目标不是清数据库，而是清当前浏览器内存中的旧 transcript。

---

## 16. 输入框状态为什么也放在这里

`input` / `setInput` 并没有放在 `MultimodalInput` 本地，而是也放进了 `useActiveChat`。

这样做带来的好处是：

- `Messages` 里点击“编辑消息”时，可以把旧文本回填到同一个输入状态
- `ChatShell` 可以在不同组件之间共享输入内容
- 输入框不再是完全孤立的局部状态

当前项目里，`ChatShell` 会在编辑消息时做这件事：

- 从某条历史消息提取文本
- 调用 `setInput(text)`
- 再把 `editingMessage` 交给 `MultimodalInput`

这说明输入框状态已经被视为“当前会话状态”的一部分，而不只是一个 textarea 值。

---

## 17. 模型选择为什么是 `state + ref`

`currentModelId` 用于驱动 UI。

但发送请求时，真正读取的是：

```ts
currentModelIdRef.current
```

原因是：

- `prepareSendMessagesRequest` 是 transport 内部回调
- 它可能在较晚时机执行
- 如果只依赖闭包捕获的 `currentModelId`，就有机会读到旧值

因此这里采用经典模式：

- `state` 负责渲染
- `ref` 负责提交时读取最新值

同时它还会在挂载时从 `chat-model` cookie 恢复。

这又说明 `useActiveChat` 不只是聊天消息层，也负责把“当前模型偏好”接入聊天上下文。

---

## 18. `?query=` 深链为什么放在这里处理

文件里还有一个容易被忽略的入口逻辑：

- 某些入口会以 `?query=...` 方式进入聊天页

`useActiveChat` 会做两件事：

1. 把 query 参数转换为真正的一条用户消息并调用 `sendMessage`
2. 立即用 `history.replaceState` 改写 URL

这样可以避免：

- query 参数在刷新后被重复消费
- 下游组件各自去关心这种特殊入口

为什么放在这里最合适？

因为这里只有它同时掌握：

- 当前 `chatId`
- 当前 `sendMessage`
- 当前是不是新会话

它是最合适的编排层。

---

## 19. 自动恢复链路是怎么接进来的

`useChat` 暴露了 `resumeStream`，而 `useActiveChat` 没有直接自己写恢复判断，而是把它交给：

```ts
useAutoResume({
  autoResume: !isNewChat && !!chatData,
  initialMessages,
  resumeStream,
  setMessages,
})
```

### 19.1 这里为什么不在本文件里直接写逻辑

因为 `useActiveChat` 已经足够复杂。

把恢复策略拆到 `useAutoResume` 后，职责会更清晰：

- `useActiveChat`
  - 负责 orchestration
- `useAutoResume`
  - 负责恢复策略细节

### 19.2 当前恢复链路的判断条件

只有在以下情况下才尝试自动恢复：

- 不是新会话
- 已经拿到 `chatData`

也就是说：

- 新会话没有服务端流，不能恢复
- 旧会话也要先拿到历史，才能判断最后一条消息是否是“用户已经发出，但 assistant 还没补完”的状态

### 19.3 当前实现状态要特别注意

当前仓库里的：

```txt
app/(chat)/api/chat/[id]/stream/route.ts
```

返回的是：

```ts
return new Response(null, { status: 204 });
```

这说明：

- 前端已经接入了 `resumeStream`
- 后端创建可恢复流的“注册侧”也有一部分逻辑
- 但真正的恢复端点还没有闭环

所以目前这条能力更像“预埋中的半成品”，而不是已经完全闭环的断流续传方案。

---

## 20. 投票为什么也归它管

`votes` 的读取条件是：

- chat 不是只读
- 且 `messages.length >= 2`

也就是说，只有当前会话已经形成较完整的交互时，才去请求：

```ts
GET /api/vote?chatId=...
```

为什么这部分也放在 `useActiveChat`？

因为它依赖的是“当前会话”的全局语义：

- 当前 chat 是谁
- 当前 chat 是否只读
- 当前消息是否已经足够支撑投票 UI

这些判断都属于“会话级别上下文”，放在这里比放进某个局部消息组件里更自然。

---

## 21. `ChatShell` 是如何消费它的

`components/chat/shell.tsx` 是 `useActiveChat` 的主入口消费者。

它做的事可以概括成两步：

### 21.1 先一次性取出会话上下文

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
  isAskUserQuestionPending,
} = useActiveChat();
```

### 21.2 再把它拆给三个核心区域

- `Messages`
  - 展示消息
  - 支持编辑入口
  - 使用 `status / votes / regenerate / setMessages`
- `MultimodalInput`
  - 承接输入、附件、发送
  - 使用 `input / setInput / sendMessage / stop / status / isAskUserQuestionPending`
- `Artifact`
  - 依赖 `chatId / messages / sendMessage / status / votes`

这说明 `ChatShell` 更像“装配层”，而 `useActiveChat` 才是“状态总控层”。

---

## 22. 一次普通发消息的完整链路

下面按时间顺序串一次普通用户提问。

### 22.1 输入阶段

`MultimodalInput` 维护附件列表，但文本输入值来自 `useActiveChat().input`。

### 22.2 提交阶段

点击发送后，`MultimodalInput` 会：

1. 先整理输入文本和附件
2. 如果是新会话，先把 URL 推成 `/chat/:id`
3. 调用 `sendMessage(pendingMessage)`

### 22.3 `useChat` 发送阶段

`useChat` 调到 `DefaultChatTransport`

然后进入：

```ts
prepareSendMessagesRequest(request)
```

### 22.4 项目请求体适配阶段

`buildChatRequestBody(...)` 把“最后一条消息 + 当前模型 + 可见性”翻译成 `/api/chat` 需要的 union 请求体。

### 22.5 服务端执行阶段

`app/(chat)/api/chat/route.ts` 会：

- 校验请求体
- 校验会话与权限
- 必要时创建 chat 记录
- 保存用户消息
- 调用 Agent
- 把 UI 流式结果返回前端

### 22.6 前端消费阶段

`useChat` 更新 `messages`

如果流里带有自定义 `data-*` 事件，则：

- `onData` 把事件推到 `dataStream`
- `DataStreamHandler` 再更新 Artifact/UI 侧状态

### 22.7 结束收尾阶段

`onFinish` 调用：

```ts
mutate(unstable_serialize(getChatHistoryPaginationKey))
```

目的是刷新侧边栏历史。

---

## 23. 一次 `askUserQuestion` 的完整链路

这条链路体现了 `useActiveChat` 相比原生 `useChat` 的二次封装价值。

### 23.1 服务端发出工具请求

assistant message 中出现：

- `tool-askUserQuestion`
- 状态通常为 `input-available`

### 23.2 下游工具组件渲染交互

`AskUserQuestionTool` 基于当前消息 part 渲染按钮或自定义输入框。

### 23.3 用户提交答案

工具组件调用：

```ts
addToolOutput({
  tool: "askUserQuestion",
  toolCallId,
  output,
})
```

### 23.4 会话进入“等待自动续发”状态

此时：

- 最后一条 assistant message 已经变为“已解析完成的 askUserQuestion”
- `isAskUserQuestionPending` 变为 `false`

### 23.5 `sendAutomaticallyWhen` 自动触发下一次请求

`useActiveChat` 通过：

```ts
isResolvedAskUserQuestionMessage(messages.at(-1))
```

判断条件成立，于是自动再次提交。

### 23.6 第二次请求不是 user message，而是 `toolMessage`

`buildChatRequestBody(...)` 会把这条 assistant tool message 翻译为：

- `toolMessage`
- 而不是新的 `message`

这让服务端能够在同一轮对话里继续向下执行。

---

## 24. 当前文件实际承担了哪些职责

如果按架构角色拆分，`useActiveChat` 至少承担了以下 9 类职责：

1. 路由解析
2. 新会话临时 id 生成
3. 服务端历史快照加载
4. `useChat` 内核接入
5. chat 请求体协议适配
6. 自定义 data stream 分流
7. 特殊工具续发编排
8. 恢复流与投票等衍生能力接入
9. 统一 Context 对外输出

这也解释了为什么它“看起来像 hook，实际更像前端 chat session controller”。

---

## 25. 阅读这个文件时最重要的心智模型

建议把它拆成四层来看：

### 第一层：会话身份层

- 当前 chat 是谁
- 是新会话还是旧会话

### 第二层：服务端快照层

- `/api/messages` 返回了什么
- 哪些数据是初始化用途

### 第三层：运行时聊天层

- `useChat` 如何维护真正的消息时间线
- `sendMessage` / `addToolOutput` / `resumeStream` 如何参与运行

### 第四层：项目编排层

- 请求体如何被改写
- `askUserQuestion` 如何自动续发
- `data-*` 事件如何流向 Artifact
- 历史刷新、投票、恢复等如何挂接

如果带着这四层去读，`use-active-chat.tsx` 会清晰很多。

---

## 26. 结论

如果给 `useActiveChat` 一个最准确的定位，我会这样描述：

> 它不是“一个包装了 `useChat` 的小 hook”，而是聊天页“当前激活会话”的前端总控层。

它解决的不是单个技术点，而是一整组问题：

- 当前会话身份如何统一
- 历史消息如何初始化
- 页面状态如何接上 AI SDK
- 项目自定义协议如何接上 `/api/chat`
- 工具交互如何无缝继续执行
- Artifact 侧数据如何与主消息流并存

如果后续要继续重构这个聊天页，`useActiveChat` 仍然会是最值得优先拆分、但也最不能随便拆坏的核心节点。
