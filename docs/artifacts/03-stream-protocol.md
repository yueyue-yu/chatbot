# Artifact 流协议与数据事件

这一章专门讲 Artifact 最难的一条链：

> 服务端写出的 `data-*` 事件，怎样一路流到右侧面板并改写 UI 状态。

---

## 1. 先记住整条链

Artifact 的流式事件链大致是：

```txt
server tool / document handler
-> dataStream.write({ type: "data-..." })
-> /api/chat SSE
-> useChat({ onData })
-> useActiveChat.setDataStream(...)
-> DataStreamHandler
-> useArtifact().setArtifact / setMetadata
-> Artifact 面板更新
```

这条链路和普通 `messages` 时间线并行存在。

---

## 2. 为什么不直接把这些事件塞进 `messages`

这些 `data-*` 事件往往承载的是：

- 当前文档 id
- 当前文档标题
- 当前文档 kind
- 内容增量
- 清空正文
- 流结束
- suggestions

它们更像 UI 控制协议，而不是“给用户看的聊天消息正文”。

因此项目采用了两条通道：

- `messages`
  - 负责聊天消息本身
- `dataStream`
  - 负责 Artifact 与其他自定义 UI 事件

---

## 3. 客户端入口在哪里

入口在：

- `hooks/use-active-chat.tsx`

其中 `useChat({ onData })` 会收到服务端发来的 data part，然后把它们推进：

```ts
setDataStream((ds) => (ds ? [...ds, dataPart] : []))
```

此处只做一件事：

- 转发

它不负责解释这些事件是什么意思。

---

## 4. 真正的解释器是谁

真正解释这些事件的是：

- `components/chat/data-stream-handler.tsx`

它的职责可以拆成两步：

### 4.1 先处理类型专属事件

它会根据当前：

```ts
artifact.kind
```

找到对应的 `artifactDefinition`，再调用：

```ts
artifactDefinition.onStreamPart(...)
```

例如：

- `text` 处理 `data-textDelta` / `data-suggestion`
- `code` 处理 `data-codeDelta`
- `html` 处理 `data-htmlDelta`
- `sheet` 处理 `data-sheetDelta`

### 4.2 再处理通用控制事件

例如：

- `data-id`
- `data-title`
- `data-kind`
- `data-clear`
- `data-finish`

它们会统一更新 `UIArtifact` 的基础字段与 `status`。

---

## 5. 当前协议里有哪些关键事件

### 5.1 通用控制事件

这些事件对大多数 Artifact 都通用。

| 事件 | 作用 |
| --- | --- |
| `data-kind` | 告诉前端当前正在处理哪种 Artifact |
| `data-id` | 告诉前端本次文档的 `documentId` |
| `data-title` | 告诉前端面板标题 |
| `data-clear` | 开始生成前清空当前正文 |
| `data-finish` | 当前一次生成/更新完成，把状态切回 `idle` |

### 5.2 类型专属内容事件

| 事件 | 主要消费方 | 作用 |
| --- | --- | --- |
| `data-textDelta` | `artifacts/text/client.tsx` | 追加文本内容 |
| `data-codeDelta` | `artifacts/code/client.tsx` | 更新代码正文 |
| `data-htmlDelta` | `artifacts/html/client.tsx` | 更新 HTML 正文 |
| `data-sheetDelta` | `artifacts/sheet/client.tsx` | 更新表格内容 |
| `data-imageDelta` | `artifacts/image/client.tsx` | 更新图像内容 |
| `data-suggestion` | `artifacts/text/client.tsx` | 追加写作建议 metadata |

### 5.3 与 Artifact 共用通道的非 Artifact 事件

| 事件 | 作用 |
| --- | --- |
| `data-chat-title` | 刷新侧边栏聊天标题 |

这说明 `dataStream` 不只给 Artifact 用，但 Artifact 是其中最主要的一类消费者。

---

## 6. `createDocument` 为什么先写通用事件

`lib/agent/tools/create-document.ts` 在真正生成内容前，会先依次写：

1. `data-kind`
2. `data-id`
3. `data-title`
4. `data-clear`

这几步的意义是：

- 先把右侧面板切到正确 kind
- 先把当前文档身份建立起来
- 先把标题显示出来
- 再把旧内容清掉，准备接收流式正文

也就是说，Artifact 面板通常是“先被打开到正确状态，再逐步收到正文”。

---

## 7. 各 kind 的 `onStreamPart()` 一般在做什么

类型专属 `onStreamPart()` 一般会做这些事：

### 7.1 改正文内容

例如：

- text：`content + delta`
- code：直接替换为最新代码字符串
- sheet：替换 CSV / 表格内容

### 7.2 处理 metadata

例如：

- text：append suggestions
- code：运行结果写进 metadata.outputs
- html：强制切回 source 视图

### 7.3 在合适时机自动打开面板

一些客户端定义里会根据内容长度阈值决定：

- 当 streaming 内容积累到一定程度时
- 自动把 `isVisible` 置为 `true`

这是一个 UX 选择，不是协议硬要求。

---

## 8. 为什么 `DataStreamHandler` 要先清空队列再消费

实现里会先：

```ts
const newDeltas = dataStream.slice();
setDataStream([]);
```

目的有两个：

1. 避免重复消费同一批 delta
2. 允许新的 delta 在下一轮 effect 中进入

如果一边消费一边保留原数组，重复处理或顺序问题都会更难控。

---

## 9. 生成结束后发生了什么

当服务端写出：

```ts
data-finish
```

前端会把：

```ts
artifact.status = "idle"
```

这会触发一系列后续行为：

- 主面板不再按 streaming 模式工作
- HTML 可切换到 preview
- `/api/document` 的版本请求重新变得有效
- 最新持久化版本可以回填到面板

所以 `data-finish` 不只是“结束一个 spinner”，而是：

> 从实时生成阶段切换回文档版本阶段的状态分界线。

---

## 10. 流协议维护时最容易踩的坑

### 10.1 只改了前端，不改 `CustomUIDataTypes`

如果新增了一个 `data-xxx` 事件，但没同步改：

- `lib/types.ts`

类型系统和运行时就会脱节。

### 10.2 服务端发了事件，前端没消费

先检查：

- `useActiveChat` 的 `onData` 有没有收到
- `DataStreamHandler` 有没有处理
- 当前 `kind` 对应的 `onStreamPart()` 是否覆盖了该事件

### 10.3 前端消费了事件，但 UI 没切状态

先检查：

- 通用控制事件是不是应该由 `DataStreamHandler` 主体处理
- 类型专属内容事件是不是应该由 `onStreamPart()` 处理

如果这两个层级分错了，状态更新就会丢。
