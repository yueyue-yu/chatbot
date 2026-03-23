# SSE 流处理文档集

这组文档专门解释当前项目里最重要、也最容易读晕的那条链路：

> 一次 `/api/chat` 请求，如何在服务端创建 UI message stream，如何把 `data-*` 事件通过前端一路传到 `Artifact` 面板，并最终改写运行时状态。

如果你要接手这部分代码，这套文档的目标不是教你“什么是 SSE”，而是让你读懂：

- 这条链路在当前仓库里到底怎么实现
- 哪些文件负责写流
- 哪些文件只负责转发
- 哪些文件才真正解释 `data-*` 事件
- 为什么 `text` / `code` / `html` / `sheet` 的流式语义不一样
- 为什么“可恢复流”现在仍然是部分接入状态

---

## 1. 适合谁读

这套文档默认你已经知道：

- React / Next.js 基础
- 什么是 hook / Context / SWR
- 聊天请求会走 `app/(chat)/api/chat/route.ts`

但它**不假设**你已经熟悉：

- AI SDK 的 UI message stream
- `useChat({ onData })` 的 data parts
- Artifact 的前后端协议
- resumable stream 的接入现状

---

## 2. 推荐阅读顺序

请按下面顺序读：

1. [01-end-to-end-overview.md](./01-end-to-end-overview.md)
   先把整条链路看通，不陷入细节。
2. [02-server-stream-writers.md](./02-server-stream-writers.md)
   看服务端到底写了哪些流事件、由谁写。
3. [03-client-stream-intake.md](./03-client-stream-intake.md)
   看前端怎么接住这条流。
4. [04-artifact-runtime-consumption.md](./04-artifact-runtime-consumption.md)
   看 `DataStreamHandler` 和 `useArtifact` 怎么把事件变成 UI。
5. [05-resumable-stream-and-boundaries.md](./05-resumable-stream-and-boundaries.md)
   最后再看恢复流和几组最容易混淆的边界。

如果你只是想查某个 `data-*` 字段，不想读完整主链路，直接回到 [../data-stream-events.md](../data-stream-events.md)。

---

## 3. 主链路总图

先把最核心的 happy path 放在脑子里：

```text
POST /api/chat
  -> createUIMessageStream()
     -> createChatAgent({ dataStream })
        -> tool / document handler 调用 dataStream.write({ type: "data-..." })
           -> useChat({ onData }) 收到 data part
              -> useActiveChat 把 data part 追加进 DataStreamProvider
                 -> DataStreamHandler 读取并清空当前批次
                    -> 类型专属 onStreamPart + 通用 setArtifact
                       -> useArtifact / metadata 更新
                          -> Artifact 面板和相关 UI 重渲染
```

理解这条图以后，再去读具体文件，就不会把“消息流”“data parts”“Artifact UI 状态”混成一团。

---

## 4. 关键文件索引

### 4.1 服务端建流与写流

- [`app/(chat)/api/chat/route.ts`](/Users/z/Projects/chatbot/app/(chat)/api/chat/route.ts)
  聊天 POST 路由，创建 UI message stream，并在可用时注册 resumable stream。
- [`lib/agent/tools/create-document.ts`](/Users/z/Projects/chatbot/lib/agent/tools/create-document.ts)
  新建 Artifact 时写控制事件。
- [`lib/agent/tools/update-document.ts`](/Users/z/Projects/chatbot/lib/agent/tools/update-document.ts)
  全量重写已有 Artifact。
- [`lib/agent/tools/edit-document.ts`](/Users/z/Projects/chatbot/lib/agent/tools/edit-document.ts)
  精确替换已有 Artifact 内容。
- [`lib/agent/tools/request-suggestions.ts`](/Users/z/Projects/chatbot/lib/agent/tools/request-suggestions.ts)
  走 metadata 旁路，写 `data-suggestion`。
- [`lib/artifacts/server.ts`](/Users/z/Projects/chatbot/lib/artifacts/server.ts)
  服务端 Artifact handler 注册表。
- [`artifacts/text/server.ts`](/Users/z/Projects/chatbot/artifacts/text/server.ts)
- [`artifacts/code/server.ts`](/Users/z/Projects/chatbot/artifacts/code/server.ts)
- [`artifacts/html/server.ts`](/Users/z/Projects/chatbot/artifacts/html/server.ts)
- [`artifacts/sheet/server.ts`](/Users/z/Projects/chatbot/artifacts/sheet/server.ts)

### 4.2 客户端接流与分发

- [`hooks/use-active-chat.tsx`](/Users/z/Projects/chatbot/hooks/use-active-chat.tsx)
  `useChat` 接入点，负责把 `dataPart` 转发到独立通道。
- [`components/chat/data-stream-provider.tsx`](/Users/z/Projects/chatbot/components/chat/data-stream-provider.tsx)
  短生命周期 data part 队列。
- [`components/chat/data-stream-handler.tsx`](/Users/z/Projects/chatbot/components/chat/data-stream-handler.tsx)
  真正解释 data parts 的桥接层。
- [`hooks/use-artifact.ts`](/Users/z/Projects/chatbot/hooks/use-artifact.ts)
  当前 Artifact 面板的轻量 store。

### 4.3 Artifact 客户端消费

- [`artifacts/text/client.tsx`](/Users/z/Projects/chatbot/artifacts/text/client.tsx)
  `text` append delta，并维护 suggestions metadata。
- [`artifacts/code/client.tsx`](/Users/z/Projects/chatbot/artifacts/code/client.tsx)
  `code` 以完整快照覆盖正文。
- [`artifacts/html/client.tsx`](/Users/z/Projects/chatbot/artifacts/html/client.tsx)
  `html` 以完整快照覆盖正文，并强制切回 source 视图。
- [`artifacts/sheet/client.tsx`](/Users/z/Projects/chatbot/artifacts/sheet/client.tsx)
  `sheet` 以完整 CSV 快照覆盖正文。

### 4.4 恢复流

- [`hooks/use-auto-resume.ts`](/Users/z/Projects/chatbot/hooks/use-auto-resume.ts)
  前端自动尝试 `resumeStream()` 的入口。
- [`app/(chat)/api/chat/[id]/stream/route.ts`](/Users/z/Projects/chatbot/app/(chat)/api/chat/[id]/stream/route.ts)
  恢复端点，当前只返回 `204`。
- [`lib/db/queries.ts`](/Users/z/Projects/chatbot/lib/db/queries.ts)
  `createStreamId` / `getStreamIdsByChatId`。

---

## 5. 与其他文档的分工

- [../data-stream-events.md](../data-stream-events.md)
  适合查字段。
  它解释“`data-kind` 是什么”，但不以完整主链路为主。

- [../use-active-chat-architecture.md](../use-active-chat-architecture.md)
  适合深挖 `useActiveChat` 本身。
  它解释聊天主会话的 orchestration，而不是完整 SSE/Artifact 协议。

- [../chat-state-architecture.md](../chat-state-architecture.md)
  适合先建立 Context / SWR / store 边界感。
  它解释状态分层，但不会展开所有 writer / delta 细节。

- [../resume-stream.md](../resume-stream.md)
  适合专门研究恢复流现状与缺口。
  这套 SSE 文档只会把它作为高级分支收进最后一章。

---

## 6. 读完后你应该得到什么

如果你按顺序读完这 5 章，应该能稳定回答这些问题：

- 一次 `POST /api/chat` 是谁创建了 UI message stream
- `dataStream.write({ type: "data-..." })` 到底是谁调用的
- 为什么 `useActiveChat` 不直接更新 Artifact 面板
- `DataStreamProvider` 和 `useArtifact` 分别存的是什么
- 为什么 `text` 用 append，而 `code/html/sheet` 用 replace
- 为什么 `resumeStream()` 在代码里有入口，但默认恢复链路仍未闭环

如果这些问题你都能不看代码大致讲清楚，再回源码会顺很多。
