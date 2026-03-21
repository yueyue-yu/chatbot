# `hooks/` 目录梳理

本文档用于分析项目里的 `hooks/` 目录，说明每个 hook 的职责、彼此关系、在页面中的作用，以及它们和聊天主链路、Artifact 面板之间的协作方式。

如果你正在接手这个项目，这份文档重点回答这些问题：

- `hooks/` 目录里每个 hook 分别干什么？
- 哪些 hook 属于“聊天状态核心层”，哪些属于“UI 交互层”？
- `use-active-chat` 为什么是最重要的 hook？
- Artifact、自动恢复、滚动、可见性这些状态是怎么分工的？
- 哪些 hook 是通用能力，哪些 hook 明显服务于聊天产品？

---

## 1. hooks 目录总览

当前项目的 `hooks/` 包含以下文件：

```text
hooks/
├── use-active-chat.tsx
├── use-artifact.ts
├── use-auto-resume.ts
├── use-chat-visibility.ts
├── use-messages.tsx
├── use-mobile.ts
└── use-scroll-to-bottom.tsx
```

可以把它们大致分成三类：

### A. 聊天核心状态
- `use-active-chat.tsx`
- `use-chat-visibility.ts`
- `use-auto-resume.ts`

### B. Artifact 状态
- `use-artifact.ts`

### C. UI 交互辅助
- `use-messages.tsx`
- `use-scroll-to-bottom.tsx`
- `use-mobile.ts`

一句话总结：

> `hooks/` 是项目的客户端状态中间层，负责把 API、SWR、AI SDK、UI 交互细节封装成组件可直接消费的状态接口。

---

## 2. 整体关系图

在理解单个 hook 之前，先看一张简化关系图：

```text
用户输入消息
  -> useActiveChat()
       -> useChat()
       -> /api/chat
       -> useAutoResume()
       -> useDataStream()
       -> votes / visibility / model 等派生状态

服务端返回 artifact 数据流
  -> DataStreamHandler
       -> useArtifact()
       -> 当前 artifact 面板状态更新

聊天消息列表 UI
  -> useMessages()
       -> useScrollToBottom()

聊天公开/私有切换
  -> useChatVisibility()
       -> SWR 本地状态 + sidebar 历史缓存 + Server Action

页面布局 / 侧边栏 / 响应式
  -> useIsMobile()
```

所以它们并不是平铺的 7 个独立工具，而是一个有主次的状态体系：

- `useActiveChat` 是主轴
- `useArtifact` 是第二主轴
- 其他 hook 多数围绕这两条主轴服务

---

## 3. 最核心的 hook：`use-active-chat.tsx`

这是整个聊天页状态的中心。

如果只允许先读一个 hook，应该先读它。

---

## 3.1 它解决什么问题

`useActiveChat` 本质上是在做一件事：

> 把“当前页面正在操作的 chat”抽象成一个统一的上下文对象，供整个聊天界面共享。

它封装了：

- 当前 chatId
- 消息列表
- 发送消息 / 停止 / 重试
- 当前输入框文本
- 模型选择
- 可见性
- chat 只读状态
- votes
- chat 初始加载状态

换句话说，聊天页里绝大部分业务组件，其实都不应该自己各自去请求 `/api/messages` 或维护 `useChat()` 实例，而应该从这个 hook 的 Context 里统一拿状态。

---

## 3.2 结构：它其实是“Provider + Hook”

这个文件不只是一个简单 hook，而是两层结构：

### `ActiveChatProvider`
负责创建并持有状态

### `useActiveChat()`
负责从 Context 中读取状态

所以它的定位更准确地说是：

> 聊天页的上下文状态容器

不是纯函数式“小工具 hook”。

---

## 3.3 chatId 解析逻辑

它先从 pathname 中解析：

```ts
/chat/:id
```

如果路径中有 chatId：
- 当前是已有会话

如果没有：
- 当前是新会话页
- 会生成一个临时 `newChatIdRef`

这里有一个重要设计：

- 新 chat 页并不是“没有 id”
- 而是会先在前端生成一个 UUID，作为后续第一次发消息时的 chat id

这样做的好处是：

- 新会话在发送第一条消息前就有稳定 id
- 组件层不需要到处判断 “还没有 chat id 怎么办”
- `useChat`、artifact、输入区等都可以基于这个 id 工作

---

## 3.4 远程初始数据加载

对于已有 chat，会通过 SWR 请求：

```ts
/api/messages?chatId=${chatId}
```

返回内容主要包括：

- `messages`
- `visibility`
- `isReadonly`

然后派生出：

- `initialMessages`
- `initialVisibilityType`
- `isReadonly`

所以它的一个核心职责就是：

> 在客户端把“服务端存量 chat 数据”转换成 `useChat()` 可消费的初始状态。

---

## 3.5 本地可见性状态

虽然服务端会返回 `visibility`，但 `useActiveChat` 还维护了一个本地 SWR key：

```ts
${chatId}-visibility
```

作用是：

- 在本地先缓存当前 chat 的可见性
- 让 UI 可以快速更新，而不必每次都等服务端回包

这个状态和 `useChatVisibility()` 配合使用，后者才是真正处理“修改可见性”的 hook。

---

## 3.6 它如何接入 AI SDK 的 `useChat()`

`useActiveChat` 内部真正调用了：

```ts
useChat<ChatMessage>({...})
```

并接入了以下关键配置：

### `id: chatId`
绑定当前 chat

### `messages: initialMessages`
把已加载历史消息作为初始消息

### `generateId: generateUUID`
统一消息 id 生成策略

### `transport: new DefaultChatTransport(...)`
真正定义了前端怎么请求 `/api/chat`

---

## 3.7 `prepareSendMessagesRequest` 的作用

这是 `useActiveChat` 很关键的一段逻辑：

它会把 `useChat()` 默认要发送的内容重新打包成项目服务端需要的格式：

```ts
{
  id: request.id,
  message: lastMessage,
  selectedChatModel: currentModelIdRef.current,
  selectedVisibilityType: visibilityType,
}
```

这意味着：

- 客户端最终并不是把完整 `messages` 默认发给 `/api/chat`
- 而是只发当前最后一条用户消息 `message`
- 并带上模型选择和可见性

这和项目服务端 `POST /api/chat` 的 schema 正好对应。

换句话说：

> `useActiveChat` 是“前端 `useChat()` 请求格式”到“项目 chat route 请求格式”的适配层。

---

## 3.8 `onData`：把服务端 data part 转到 Artifact 流体系

```ts
onData: (dataPart) => {
  setDataStream((ds) => (ds ? [...ds, dataPart] : []));
}
```

这一步非常关键。

它意味着：

- `useChat()` 收到的不只是普通 assistant 文本
- 还可能有各种自定义 data parts
- 这些 data parts 会被转发给 `data-stream-provider`
- 后续由 `components/chat/data-stream-handler.tsx` 处理

这就是聊天主链路里 Artifact 面板能边生成边更新的基础。

所以你可以把 `useActiveChat` 理解为：

- 聊天消息主通道的接入点
- Artifact 数据流旁路的桥接点

---

## 3.9 `onFinish`：刷新侧边栏历史

```ts
mutate(unstable_serialize(getChatHistoryPaginationKey));
```

作用：

- 当一次聊天生成结束后
- 触发历史列表缓存更新
- 保证 sidebar 中标题、排序等信息刷新

这也是为什么主聊天发送完之后，侧边栏会同步变化。

---

## 3.10 `onError`：统一 toast 错误展示

错误处理统一封装成：

- 如果是 `ChatbotError`，展示业务错误文案
- 否则展示通用兜底错误

这让组件层不必自己处理 transport error。

---

## 3.11 防重复加载与切换 chat 逻辑

文件里有两个比较细的状态控制：

### `loadedChatIds`
避免同一个 chat 的消息被重复 set 到 `useChat`

### `prevChatIdRef`
当 chatId 变化且当前是新会话时，重置消息列表

这两个逻辑都是为了解决：

- SWR 数据加载
- 路由切换
- `useChat` 内部状态

三者之间可能产生的重复同步和脏状态问题。

这也是 `useActiveChat` 复杂度高的原因之一：

> 它不是简单包装 `useChat`，而是在做“路由态 + 远程态 + 本地态”的对齐。

---

## 3.12 从 cookie 初始化模型

它会读取：

```ts
chat-model
```

作为初始模型。

这意味着模型选择是：

- 有持久化偏好的
- 同浏览器会话/长期使用习惯相关

`useActiveChat` 负责把这个偏好恢复到当前聊天上下文。

---

## 3.13 query 参数自动发消息

它还支持一个很实用的功能：

如果 URL 上有：

```text
?query=...
```

会在首次进入时：

1. 自动把 query 发成一条用户消息
2. 然后把 URL 替换成 `/chat/:id`

这说明它不仅管“常规聊天状态”，还负责“从外部入口预填并发送消息”的场景。

---

## 3.14 接入 `useAutoResume`

```ts
useAutoResume({
  autoResume: !isNewChat && !!chatData,
  initialMessages,
  resumeStream,
  setMessages,
});
```

说明自动恢复逻辑不是直接写在 `useActiveChat` 内部，而是拆到单独 hook 中。

这是一个不错的分层方式：

- `useActiveChat` 负责 orchestration
- `useAutoResume` 负责恢复策略细节

---

## 3.15 votes 加载

当 chat 非只读且消息数量足够时，会请求：

```ts
/api/vote?chatId=${chatId}
```

这说明投票状态也被纳入当前 chat 上下文中，而不是由 message item 自己各自发请求。

---

## 3.16 最终输出

`useActiveChat()` 暴露的值包括：

- `chatId`
- `messages`
- `setMessages`
- `sendMessage`
- `status`
- `stop`
- `regenerate`
- `input` / `setInput`
- `visibilityType`
- `isReadonly`
- `isLoading`
- `votes`
- `currentModelId` / `setCurrentModelId`

它基本就是聊天主页面的大脑。

---

## 4. Artifact 核心状态：`use-artifact.ts`

如果 `useActiveChat` 是聊天页的大脑，那么 `useArtifact` 就是 Artifact 面板的大脑。

---

## 4.1 它解决什么问题

这个 hook 用来维护：

- 当前打开的是哪个文档
- 文档内容是什么
- 当前 kind 是什么
- 面板是否可见
- 当前 streaming / idle 状态
- 面板的 bounding box
- 与当前 document 关联的 metadata

换句话说：

> 它把 Artifact 面板状态做成了一个全局轻量 store。

---

## 4.2 为什么用 SWR 当本地 store

这里不是用 Redux / Zustand，而是用 SWR 的本地 key：

- `artifact`
- `artifact-metadata-${documentId}`

这种方式的优点：

- 轻量
- 复用项目已有 SWR 体系
- 能在多个组件之间共享状态

例如：

- `components/chat/artifact.tsx`
- `components/chat/document-preview.tsx`
- `components/chat/data-stream-handler.tsx`
- `components/agent/agent-demo.tsx`
- `components/agent/agent-artifact-panel.tsx`

都能共享同一个 artifact 状态。

---

## 4.3 `initialArtifactData`

初始值定义为：

- `documentId: "init"`
- `kind: "text"`
- `status: "idle"`
- `isVisible: false`
- 空 content/title
- 默认 boundingBox

`documentId = "init"` 很关键，它是项目里“当前还没有真正打开任何 artifact”的哨兵值。

很多组件都会用它判断是否应该发 `/api/document` 请求。

---

## 4.4 `useArtifactSelector`

这个 hook 的作用类似 Zustand 的 selector：

```ts
useArtifactSelector((state) => state.isVisible)
```

这样组件就可以只订阅自己关心的字段，而不是总拿完整 artifact 对象。

虽然底层还是 SWR，但从使用体验看，它已经接近一个轻量状态容器。

---

## 4.5 `useArtifact`

这个 hook 暴露：

- `artifact`
- `setArtifact`
- `metadata`
- `setMetadata`

其中 `setArtifact` 支持：

- 直接传对象
- 传 updater 函数

因此使用方式和 React state setter 很像。

---

## 4.6 metadata 设计

`metadata` 是按 `documentId` 隔离的：

```ts
artifact-metadata-${artifact.documentId}
```

这意味着：

- 不同文档的 metadata 不会串
- text suggestions、code outputs 等都能按当前文档隔离

它非常适合 Artifact 这种“每个文档都可能有自己附属状态”的场景。

---

## 4.7 这个 hook 的实际定位

它不是普通“工具函数 hook”，更像：

> 项目内部的 Artifact 全局 store 适配器。

---

## 5. 自动恢复：`use-auto-resume.ts`

这个 hook 专门负责聊天流恢复逻辑。

它只服务于主聊天，不服务于 `/agent`。

---

## 5.1 触发逻辑

当满足以下条件时会调用 `resumeStream()`：

- `autoResume === true`
- 初始消息最后一条是 `user`

含义是：

- 如果 chat 已存在
- 并且数据库里最后停在一条 user 消息
- 就猜测 assistant 流可能被中断过
- 尝试恢复流

这是一个启发式恢复策略，不是强一致状态机。

---

## 5.2 恢复后的消息拼接

它还会监听 `dataStream` 中是否出现：

- `data-appendMessage`

如果有，就把这条恢复出来的消息 append 到 `initialMessages` 后面。

因此它在逻辑上做了两件事：

1. 决定“要不要恢复”
2. 处理“恢复出来的消息怎么并回当前 messages”

---

## 5.3 当前局限

从实现上看，这个 hook 有两个明显特点：

### 特点 1
恢复依赖于项目的 resumable stream 接口是否完整

### 特点 2
它只检查 `dataStream[0]`

这意味着：

- 如果一次恢复里有多个 data part，处理可能不够稳健
- 这是一个偏功能性、但不算很强壮的实现

因此它更适合作为“恢复策略薄层”，而不是复杂流恢复引擎。

---

## 6. 聊天可见性：`use-chat-visibility.ts`

这个 hook 专门负责 chat 的公开/私有切换。

---

## 6.1 它为什么单独拆出来

因为 chat 可见性不是纯局部状态。

它同时影响：

- 当前页面显示
- 侧边栏历史列表显示
- 数据库持久化结果

所以不能只是一个 `useState`。

---

## 6.2 它维护了哪些来源

### 1. 当前 chat 的本地 SWR key

```ts
${chatId}-visibility
```

### 2. 侧边栏历史缓存

通过：

```ts
unstable_serialize(getChatHistoryPaginationKey)
```

拿到 chat history pages

### 3. Server Action

```ts
updateChatVisibility({ chatId, visibility })
```

真正写回数据库

---

## 6.3 它的核心策略：乐观更新

调用 `setVisibilityType` 时：

1. 先更新本地 visibility
2. 再更新 sidebar history 里的 visibility
3. 然后调用服务端持久化
4. 如果失败，再回滚本地和 sidebar 状态
5. 最后 toast 提示失败

这就是一个标准的 optimistic UI 模式。

所以这个 hook 的价值不只是“修改可见性”，而是：

> 保证当前页面和侧边栏在可见性切换时同步更新，并在失败时回滚。

---

## 7. 消息列表辅助：`use-messages.tsx`

这个 hook 很轻，但很好地体现了“组合 hook”的思路。

它做的事是：

- 调用 `useScrollToBottom()`
- 再额外维护一个 `hasSentMessage`

---

## 7.1 `hasSentMessage`

当 `status === "submitted"` 时，它会把 `hasSentMessage` 设为 `true`。

作用通常是：

- 让消息列表 UI 知道“用户已经发出过一条消息”
- 即使 assistant 还没返回，也能调整一些显示逻辑

---

## 7.2 为什么不直接在组件里写

因为消息列表相关组件通常需要一整套滚动能力：

- 容器 ref
- 底部哨兵 ref
- 是否在底部
- 滚到底部方法
- 视口 enter / leave 回调
- reset

把这些直接暴露给组件，比让组件自己管理更干净。

所以 `useMessages` 的定位可以理解为：

> 面向聊天消息列表组件的组合型 UI hook。

---

## 8. 响应式辅助：`use-mobile.ts`

这是一个非常简单的通用 hook。

它的作用是：

- 监听窗口宽度
- 小于 768px 时返回 `true`

内部用的是：

```ts
window.matchMedia(`(max-width: 767px)`)
```

并在 `change` 时更新状态。

---

## 8.1 它的定位

它不是聊天专属 hook，而是一个通用 UI hook。

当前主要用于：

- `components/ui/sidebar.tsx`

也就是说，它更接近基础设施层，而不是业务层。

---

## 9. 滚动核心：`use-scroll-to-bottom.tsx`

这是一个很重要的底层 UI hook。

它的职责是：

> 在聊天消息不断增长时，控制“是否应该自动滚到底部”，同时避免干扰用户手动滚动查看历史内容。

---

## 9.1 它维护了哪些状态

- `containerRef`
- `endRef`
- `isAtBottom`
- `isAtBottomRef`
- `isUserScrollingRef`

这里同时有 state 和 ref，是因为：

- `isAtBottom` 用于驱动 UI
- `isAtBottomRef` 用于在 observer / event 回调中拿最新值
- `isUserScrollingRef` 用于避免自动滚动抢用户操作

---

## 9.2 `checkIfAtBottom`

用容器的：

- `scrollTop`
- `scrollHeight`
- `clientHeight`

判断是否距离底部还在 100px 以内。

这是一种容忍式判断，而不是“完全等于底部”。

好处是：

- 不容易因为像素误差导致状态抖动
- 更符合聊天产品体验

---

## 9.3 用户手动滚动检测

scroll listener 中会：

- 标记 `isUserScrollingRef.current = true`
- 150ms 后再恢复为 false

这样能区分：

- 这是用户正在主动滚动
- 还是内容更新导致的布局变化

这个区分很重要，因为聊天 UI 里最烦人的 bug 之一就是：

> 用户正在看历史消息，结果新内容来了把他强行拉回底部。

---

## 9.4 MutationObserver + ResizeObserver

这个 hook 的自动滚动能力并不是单靠 `useEffect` 实现，而是用了两种 observer：

### MutationObserver
监听 DOM 子节点和文本变化

### ResizeObserver
监听容器与子元素尺寸变化

作用是：

- 消息内容流式增长时也能及时滚动
- 图片、代码块、reasoning 展开等导致高度变化时也能感知

这让它比简单的“messages 变了就 scrollToBottom”更稳健。

---

## 9.5 自动滚动条件

只有满足：

- 当前本来就在底部
- 用户没有在主动滚动

时才会自动滚到底部。

这就是聊天滚动体验好的关键。

---

## 9.6 `onViewportEnter` / `onViewportLeave`

这两个方法通常用于和底部哨兵元素联动，帮助组件层标记：

- 当前是否在底部附近

让 UI 可以根据这个状态展示：

- “滚到底部”按钮
- 或其他浮层提示

---

## 9.7 `reset`

用于在切换 chat 或清空消息等场景重置滚动状态。

这类方法在业务组件里非常实用，因为消息列表并不是始终连续的。

---

## 10. 这些 hooks 在组件中的分布

通过实际引用关系来看：

### 聊天主页面核心
- `components/chat/shell.tsx` -> `useActiveChat()`

### Artifact 系统
- `components/chat/artifact.tsx` -> `useArtifact()`
- `components/chat/data-stream-handler.tsx` -> `useArtifact()`
- `components/chat/document-preview.tsx` -> `useArtifact()`
- `components/agent/agent-demo.tsx` -> `useArtifact()`
- `components/agent/agent-artifact-panel.tsx` -> `useArtifact()`

### 消息列表
- `components/chat/messages.tsx` -> `useMessages()`
- `components/chat/artifact-messages.tsx` -> `useMessages()`

### 可见性
- `components/chat/visibility-selector.tsx` -> `useChatVisibility()`
- `components/chat/sidebar-history-item.tsx` -> `useChatVisibility()`

### 通用 UI
- `components/ui/sidebar.tsx` -> `useIsMobile()`

这说明：

- `useActiveChat`、`useArtifact` 是高频核心 hook
- 其他 hook 多数是围绕某块 UI 功能聚焦存在

---

## 11. 如何给这些 hooks 分层理解

如果站在架构视角，我会把它们分成 4 层。

### 第一层：会话状态层
- `useActiveChat`

负责整个 chat 会话的“业务主状态”。

### 第二层：文档面板状态层
- `useArtifact`

负责 Artifact 的“跨组件共享状态”。

### 第三层：业务辅助层
- `useAutoResume`
- `useChatVisibility`
- `useMessages`

负责恢复、可见性、消息 UI 状态等业务功能。

### 第四层：基础交互层
- `useScrollToBottom`
- `useIsMobile`

负责滚动和响应式这些通用交互能力。

这四层关系大致是：

```text
业务组件
  -> 会话状态层 / 文档面板状态层
      -> 业务辅助层
          -> 基础交互层
```

---

## 12. 当前 hooks 设计的优点

## 12.1 主状态集中

聊天页不是到处自己调 `useChat()`，而是收敛到 `useActiveChat`。

好处：

- 组件更薄
- 状态更一致
- 更容易调试聊天主链路

---

## 12.2 Artifact 被抽成独立 store

这使得：

- 主聊天和 `/agent` 都能复用 artifact 状态
- document preview、artifact panel、data stream handler 能共享状态

这是一个很好的复用点。

---

## 12.3 UI hook 与业务 hook 分离较清晰

例如：

- `useScrollToBottom` 负责滚动原语
- `useMessages` 再组合成面向聊天消息列表的接口

这种分层让代码更容易维护。

---

## 12.4 可见性切换做了乐观更新

`useChatVisibility` 不只是封装 API，而是把页面和 sidebar 的一致性问题一起解决了。

这是很成熟的业务 hook 写法。

---

## 13. 当前 hooks 里值得注意的点

## 13.1 `useActiveChat` 复杂度较高

它同时处理：

- 路由
- SWR
- useChat
- model cookie
- visibility
- auto resume
- query auto send
- votes

这让它很强大，但也意味着后续继续膨胀时可能需要再拆分。

---

## 13.2 `useArtifact` 用 SWR 充当本地 store

这没问题，但团队成员如果默认把 SWR 理解成“只做远程缓存”，第一次看到时可能会有点困惑。

建议在团队文档中明确：

- 项目里 SWR 既做远程缓存，也做本地共享状态

---

## 13.3 `useAutoResume` 当前实现偏轻量

它能工作，但恢复逻辑不算特别完整，依赖项目 resumable stream 体系是否闭环。

如果后续正式把 resume 做成产品能力，这个 hook 还可能继续增强。

---

## 13.4 `useIsMobile` 属于通用 hook

它放在 `hooks/` 没问题，但如果未来基础 UI hook 越来越多，也可以考虑单独收敛到更底层目录。

---

## 14. 阅读 hooks 的推荐顺序

如果你第一次接手这部分代码，建议按这个顺序读：

1. `hooks/use-active-chat.tsx`
2. `hooks/use-artifact.ts`
3. `hooks/use-chat-visibility.ts`
4. `hooks/use-auto-resume.ts`
5. `hooks/use-scroll-to-bottom.tsx`
6. `hooks/use-messages.tsx`
7. `hooks/use-mobile.ts`

为什么这样排：

- 前两个是主状态中心
- 中间两个是重要业务辅助
- 后三个偏 UI 交互基础

---

## 15. 一句话总结每个 hook

### `useActiveChat`
聊天页核心上下文，统一管理当前会话的消息、输入、模型、可见性、votes 和请求生命周期。
更细的逐段代码分析可继续阅读：`docs/use-active-chat.md`

### `useArtifact`
Artifact 面板的全局共享状态容器，管理当前文档、显示状态与 metadata。

### `useAutoResume`
在合适时机尝试恢复中断流，并把恢复出的消息并回当前会话。

### `useChatVisibility`
以乐观更新方式同步 chat 可见性到页面、本地缓存、侧边栏历史和服务端。

### `useMessages`
面向消息列表组件的组合 hook，封装滚动能力和“是否已经发送过消息”的状态。

### `useIsMobile`
简单的移动端屏宽检测 hook。

### `useScrollToBottom`
聊天滚动的底层能力，处理自动滚底、用户手动滚动和内容尺寸变化。

---

## 16. 最终总结

如果用一句话概括你项目里的 `hooks/` 目录：

> 它是聊天客户端状态的中间层：上接路由、SWR、AI SDK 和服务端接口，下接消息列表、Artifact 面板、侧边栏和输入区，把复杂的产品状态拆成可复用的 hook 与 context。

如果再压缩成三个关键记忆点，可以记住：

1. `useActiveChat` 是聊天页总控中心。
2. `useArtifact` 是 Artifact 体系的共享状态核心。
3. 其他 hooks 大多是在为滚动、恢复、可见性、消息 UI 这些具体场景提供支撑。

---

## 17. 相关阅读

建议结合以下文件一起看：

- `components/chat/shell.tsx`
- `components/chat/messages.tsx`
- `components/chat/artifact.tsx`
- `components/chat/data-stream-handler.tsx`
- `components/chat/sidebar-history.tsx`
- `components/chat/visibility-selector.tsx`
- `components/chat/document-preview.tsx`
- `components/agent/agent-demo.tsx`
- `docs/chat-route.md`
- `docs/artifacts.md`
- `docs/resume-stream.md`

如果你愿意，我还可以继续帮你：

1. 再写一篇 `docs/hooks-call-graph.md`，专门画 hooks 与组件的调用关系图
2. 继续分析 `components/chat/`，把这些 hooks 是怎么落到 UI 上的再梳理一遍
3. 顺手给出 hooks 层的重构建议，比如 `useActiveChat` 怎么拆得更清晰
