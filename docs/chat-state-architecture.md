# 聊天状态分层总览

这篇文档专门回答一个很容易让人困惑的问题：

> 这个项目为什么大量使用 `useContext`，而不是统一上一个 store？

如果只看局部代码，确实会感觉：

- `useActiveChat` 在用 Context
- `DataStreamProvider` 在用 Context
- `ai-elements` 里很多组件也在用 Context
- 但 `useArtifact` 又不像普通 Context，更像 store

这不是风格不统一，而是项目把不同作用域、不同生命周期的状态分开处理了。

一句话先给结论：

> 这个项目不是“不用 store”，而是只在真正需要跨组件共享、又不适合挂在某棵组件树上的场景里，才用轻量 store；其余状态更偏向用 `Context + Provider` 做作用域明确的状态编排。

如果你想把这套状态分层继续顺着真实 SSE/data part 主链路读下去，请再看 [SSE 流处理文档集](./sse/README.md)。

---

## 1. 先建立整体心智模型

聊天页相关状态大致分成三层：

```txt
路由 / 服务端快照 / useChat
  -> useActiveChat (当前会话总控)
      -> onData 把自定义流事件推进 DataStreamProvider
          -> DataStreamHandler 消费事件
              -> useArtifact 更新右侧面板运行时状态
```

对应页面树大致是：

```txt
app/(chat)/layout.tsx
└─ DataStreamProvider
   └─ SidebarShell
      └─ ActiveChatProvider
         └─ ChatShell
            ├─ Messages
            ├─ MultimodalInput
            ├─ Artifact
            └─ DataStreamHandler
```

这几层不是并列关系，而是职责递进：

- `DataStreamProvider`
  负责承接自定义流事件的临时队列
- `useActiveChat`
  负责当前聊天会话的总编排
- `useArtifact`
  负责当前 Artifact 面板的跨组件共享运行时状态

---

## 2. 为什么这里大量用 `useContext`

### 2.1 因为很多状态天然就是“树作用域状态”

最典型的是 `useActiveChat`。

它服务的是“当前聊天页面这棵 UI 子树”，而不是整个应用任意位置都能随便读写的一份全局状态。

这类状态有几个特点：

- 强依赖当前路由
- 强依赖当前 chatId
- 只对聊天页内部组件有意义
- 切换会话时需要跟着页面上下文一起重置

这种状态如果强行放进全局 store，会带来两个问题：

- 状态生命周期被放大了，本来只该活在当前聊天树里，却变成“全局常驻”
- 切换 chat 时必须自己非常小心地做清理，否则很容易串状态

而 `ActiveChatProvider` 正好天然提供了一个边界：

- 进入聊天区域，就拿到“当前会话上下文”
- 离开这棵树，相关状态就不该再被乱用

所以这里用 Context 更像是在声明：

> 这些状态属于“当前激活聊天会话”，不是无边界的全局状态。

### 2.2 因为有一部分 Context 根本不是“状态管理框架替代品”

比如：

- `components/ai-elements/message.tsx`
- `components/ai-elements/prompt-input.tsx`

这里的 Context 很多是 compound component 的内部协议。

它们解决的是：

- 父组件把某些能力提供给子组件
- 子组件不需要层层透传 props
- 组件必须挂在指定 Provider 下面才能工作

这类场景本质上不是“要不要上 store”的问题，而是“父子组件怎么优雅通信”的问题。

例如 `MessageBranchContext` 表示“当前消息分支选择器”这一组组件共享同一套分支信息；它并不想成为一个全局可随处访问的状态容器。

---

## 3. 第一层：`useActiveChat` 是当前会话总控

`hooks/use-active-chat.tsx` 负责把聊天页最核心的状态编排到一起。

它做的事情包括：

- 从路由提取当前 `chatId`
- 为新会话预生成一个前端稳定 id
- 用 SWR 读取服务端消息快照
- 调用 `useChat()` 承载消息时间线
- 管理输入框文本、模型选择、可见性等会话级交互状态
- 管理自动恢复、投票加载、统一错误处理
- 把自定义 `data-*` 事件转发到独立的数据流通道

所以它不是一个普通小 hook，而是：

> 以 `useChat()` 为内核，对当前聊天会话做了一层项目级 orchestration。

### 3.1 为什么它适合用 Context

因为它面向的是“当前会话上下文”。

`ChatShell`、`Messages`、`MultimodalInput`、`ask-user-question-tool` 这些组件都要共享同一份：

- `chatId`
- `messages`
- `sendMessage`
- `status`
- `input`
- `visibilityType`
- `currentModelId`

如果没有 Provider，这些值要么：

- 一层层 props 透传
- 要么每个组件自己再去拼装一遍 `useChat + useSWR + useState`

前者会让组件接口变得很重，后者会让状态来源分散、极难维护。

所以 `useActiveChat` 选的是：

- 用 `ActiveChatProvider` 持有状态
- 用 `useActiveChat()` 做安全读取
- 让整个聊天壳子共享一个“当前会话上下文”

### 3.2 它不是全局 store 的另外一个原因

当前会话状态里有很多内容都带有明显的“会话边界”：

- 新会话和旧会话的初始化方式不同
- 切换 chat 时要清掉上一会话残留的 transcript
- `?query=` deep-link 只应自动发送一次
- `visibility` 既有服务端值，也有当前页本地乐观值

这些逻辑跟当前页面树、当前路由、当前 chat 生命周期高度耦合。

用 Provider 把边界钉住，比把它们摊平到全局 store 里更自然。

---

## 4. 第二层：`DataStreamProvider` 不是主状态中心，而是流事件桥

很多人第一次看到 `DataStreamProvider` 会以为它也是一个全局业务 store。

其实不是。

它更接近：

> 自定义 data part 的临时事件通道。

`useActiveChat` 在 `useChat({ onData })` 里拿到服务端发回的 `data-*` 事件后，并不会直接在里面解释业务含义，而是先把事件追加进 `dataStream`：

- `useActiveChat`
  负责接住事件
- `DataStreamProvider`
  负责临时保存这一批事件
- `DataStreamHandler`
  负责真正消费并翻译这些事件

### 4.1 为什么这层也更适合 Context

因为这里存的不是长期业务真相，而是一条短生命周期的中间通道：

- 有新流事件时塞进去
- `DataStreamHandler` 立刻取出
- 消费完就清空

这类数据不是“当前 UI 的最终状态”，而是“驱动状态变化的中间事件”。

如果把这类临时队列也丢进全局 store，会把“事件”和“状态”混在一起，阅读成本反而更高。

### 4.2 它和 `useArtifact` 的关系

这层最关键的职责分离是：

- `useActiveChat` 不解释 Artifact 业务
- `DataStreamProvider` 不持有 Artifact 真正状态
- `DataStreamHandler` 负责把流事件翻译成 `useArtifact` 的状态更新

这就把“聊天消息主链路”和“右侧面板运行时状态”解耦开了。

---

## 5. 第三层：`useArtifact` 其实就是一个轻量 store

如果你问“这个项目到底有没有 store 思维”，答案是有，而且最典型的就是 `hooks/use-artifact.ts`。

它把以下状态放进了 SWR 本地 key：

- `artifact`
- `artifact-metadata-${documentId}`

文档层面可以把它理解成：

> 当前 Artifact 面板的全局轻量 store。

这里的“全局”不是指整个产品所有业务，而是指：

- 当前聊天面板
- 右侧 Artifact 面板
- 文档预览卡片
- 数据流处理器
- `/agent` 里的 Artifact 面板

都可以共享同一份当前 Artifact 运行时状态。

### 5.1 为什么这里没有继续用纯 Context

因为它的消费点已经不再只是单一父子树了。

它需要被多个相对独立的消费者读取或改写：

- `components/chat/artifact.tsx`
- `components/chat/document-preview.tsx`
- `components/chat/data-stream-handler.tsx`
- `components/agent/agent-demo.tsx`
- `components/agent/agent-artifact-panel.tsx`

这时候如果还用普通 Provider 往上挂，会遇到两个问题：

- Provider 位置很难选
- 共享范围会越来越不清晰

所以项目这里选的是“轻量 store 方案”，但没有额外引入 Zustand/Redux，而是直接复用已经在项目里大量使用的 SWR。

### 5.2 为什么这里用 SWR，而不是单独再引一个 store 库

原因很现实：

- 项目本身已经深度使用 SWR
- SWR 不只管远程缓存，也能承载本地共享状态
- Artifact 的需求并不需要再上更重的状态框架

也就是说，这里的选择不是：

- Context 或 store 二选一

而是：

- 作用域明确的会话状态，用 Context
- 需要跨多个组件共享的轻量运行时状态，用 SWR 本地 key 当 store

---

## 6. 一次完整数据流到底怎么走

下面用“用户发一条消息，并触发 Artifact 更新”为例，把三层串起来。

### 6.1 发送消息

`MultimodalInput` 调用 `useActiveChat()` 暴露出的 `sendMessage`。

这一步背后由 `useActiveChat` 统一处理：

- 当前 `chatId`
- 当前 `messages`
- 当前模型 id
- 当前可见性
- 项目自定义请求体格式

### 6.2 主聊天链路运行

`useChat()` 继续负责：

- 消息列表更新
- assistant 流式输出
- stop / regenerate / resumeStream

所以消息时间线的内核仍然是 `useChat`，并没有被 store 取代。

### 6.3 自定义 data part 被转发

服务端如果通过 SSE 发回 `data-*` 事件，`useActiveChat` 的 `onData` 会先把这些事件塞进 `DataStreamProvider`。

此时还没有直接改右侧面板状态。

### 6.4 `DataStreamHandler` 消费这批事件

`DataStreamHandler` 从 `useDataStream()` 里取到这一批事件后：

- 先复制并清空队列，防止重复消费
- 再判断事件类型
- 对标题刷新、Artifact 更新、metadata 更新分别处理

### 6.5 `useArtifact` 成为右侧面板状态真相

一旦 `DataStreamHandler` 调用 `setArtifact` / `setMetadata`：

- `Artifact` 面板会更新
- `DocumentPreview` 会更新
- 其他依赖当前 Artifact 的组件也会同步更新

所以真正的链路是：

```txt
useActiveChat
  -> DataStreamProvider
     -> DataStreamHandler
        -> useArtifact
           -> Artifact / DocumentPreview / Agent panel
```

---

## 7. 为什么不统一成一个大 store

这是最核心的设计问题。

如果把整个聊天页都压成一份全局 store，表面上会更“统一”，但实际会把几类本来边界清楚的状态揉在一起。

### 7.1 会把“会话上下文”和“跨组件共享状态”混为一谈

`useActiveChat` 的重点不是“给任何地方读写聊天状态”，而是：

- 为当前会话建立边界
- 为聊天页子树提供统一上下文
- 把分散能力编排成一致接口

这和 store 的主要诉求并不完全相同。

### 7.2 会把“中间事件通道”和“最终业务状态”混为一谈

`DataStreamProvider` 存的是流事件队列，不是最终真相。

如果这也被并入统一 store，阅读者更容易误以为：

- `dataStream` 是 UI 真正依赖的主状态

但事实并不是这样。

### 7.3 会让状态生命周期变得模糊

当前项目里至少有三种不同生命周期：

- 组件局部状态
- 当前聊天树作用域状态
- 跨组件共享但仍是前端运行时状态的轻量 store

如果所有东西都放进一个大 store：

- 谁负责初始化
- 谁负责切换 chat 时清理
- 谁负责只在当前页面有效
- 谁负责跨页面或跨模块共享

这些边界会比现在更难看出来。

---

## 8. 这个项目里三种状态该怎么区分

可以用一个简单判断法。

### 8.1 优先用组件局部状态

如果状态只服务于单个组件或非常局部的交互，比如：

- `editingMessage`
- `attachments`
- 某个 selector 的展开状态

那就直接本地 `useState`。

### 8.2 当前聊天树共享，就用 Context

如果状态天然属于“当前聊天会话”，需要被聊天树里多个组件共享，比如：

- `chatId`
- `messages`
- `status`
- `input`
- `currentModelId`
- `visibilityType`

那就挂进 `ActiveChatProvider`。

### 8.3 跨多个独立消费者共享，就用轻量 store

如果状态不适合只挂在单棵父子树里，但又需要多个地方同步，比如：

- 当前打开的 Artifact
- 当前文档附属 metadata

那就用 `useArtifact` 这种 SWR 本地 store。

---

## 9. 最容易混淆的 4 个点

### 9.1 `useActiveChat` 不是 `useChat` 的简单别名

它做了大量项目适配：

- 路由
- 初始消息灌入
- 自定义请求体
- 可见性与模型偏好
- 自动恢复
- data stream 分流

### 9.2 `DataStreamProvider` 不是聊天主状态 store

它只是 data part 的暂存通道，不是消息真相来源。

### 9.3 `useArtifact` 存的不是数据库 Document 本身

它存的是：

- 当前右侧面板打开的是谁
- 当前 kind 是什么
- 当前是不是 streaming
- 当前面板是否可见
- 当前文档附属 metadata

也就是前端运行时 UI 状态。

### 9.4 这个项目其实已经在“用 store”

只是 store 不是 Zustand/Redux，而是 SWR 本地 key。

所以更准确的说法是：

> 项目没有统一上单独的状态管理库，但已经按场景把 Context 和轻量 store 混合使用了。

---

## 10. 最后用一句话总结

如果非要把这套设计压缩成一句话，可以这么记：

> `useActiveChat` 负责“当前会话上下文”，`DataStreamProvider` 负责“流事件中转”，`useArtifact` 负责“右侧面板共享状态”；大量使用 `useContext` 不是因为不会做 store，而是因为很多状态本来就更适合有明确作用域和生命周期的 Provider。

如果你接下来想继续往下读，推荐顺序是：

1. [use-active-chat-architecture.md](./use-active-chat-architecture.md)
2. [hooks.md](./hooks.md)
3. [data-stream-events.md](./data-stream-events.md)
4. [artifacts/02-client-runtime.md](./artifacts/02-client-runtime.md)
