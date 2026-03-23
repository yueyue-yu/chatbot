# Artifact 文档索引

这组文档用于替代旧的单文件 `docs/artifacts.md`。

目标不是把所有内容堆在一篇超长说明里，而是把 Artifact 系统拆成可按问题阅读的章节：

- 想先建立整体概念：读 [01-overview.md](./01-overview.md)
- 想看前端状态与面板如何运作：读 [02-client-runtime.md](./02-client-runtime.md)
- 想看流式 `data-*` 事件如何驱动右侧面板：读 [03-stream-protocol.md](./03-stream-protocol.md)
- 想看服务端工具、持久化、版本语义：读 [04-server-persistence.md](./04-server-persistence.md)
- 想新增一种 Artifact：读 [05-extension-guide.md](./05-extension-guide.md)

---

## 1. 一句话定义

在这个项目里，Artifact 不是一条普通聊天消息，而是：

> 由聊天中的 tool 调用创建或更新、以右侧面板形式展示、并持久化为 `Document` 版本链的富内容对象。

它横跨多层：

- 聊天流里的 tool / data part
- 前端 `useArtifact()` 全局状态
- 右侧面板与各 kind 的内容组件
- 服务端 document handler 注册表
- `Document` / `Suggestion` 等数据库记录

---

## 2. 当前代码的真实边界

当前仓库里前端注册了这些 Artifact 类型：

- `text`
- `code`
- `html`
- `image`
- `sheet`

但“前端能渲染”和“服务端能完整创建”不是同一个概念。

### 2.1 已接入完整服务端链路的 kind

- `text`
- `code`
- `html`
- `sheet`

它们都已经出现在：

- `components/chat/artifact.tsx` 的 `artifactDefinitions`
- `lib/artifacts/server.ts` 的 `documentHandlersByArtifactKind`
- `lib/agent/tools/create-document.ts` 的 `artifactKinds`

### 2.2 当前更偏前端展示层的 kind

- `image`

它已经出现在前端注册表与 `api/document` 的 kind 校验里，但当前没有接入：

- `lib/artifacts/server.ts` 的 handler 注册表
- `create-document` 工具允许创建的 `artifactKinds`

所以维护时要特别注意：

> `ArtifactKind` 是“前端知道怎么渲染什么”，而 `artifactKinds` 更接近“服务端真正允许模型创建什么”。

---

## 3. 推荐阅读顺序

### 3.1 第一次接手 Artifact

1. [01-overview.md](./01-overview.md)
2. [02-client-runtime.md](./02-client-runtime.md)
3. [03-stream-protocol.md](./03-stream-protocol.md)
4. [04-server-persistence.md](./04-server-persistence.md)

### 3.2 只想改右侧面板体验

1. [02-client-runtime.md](./02-client-runtime.md)
2. [03-stream-protocol.md](./03-stream-protocol.md)

### 3.3 只想新增一种 Artifact

1. [01-overview.md](./01-overview.md)
2. [04-server-persistence.md](./04-server-persistence.md)
3. [05-extension-guide.md](./05-extension-guide.md)

---

## 4. 关键文件地图

### 4.1 客户端状态与面板

- `hooks/use-artifact.ts`
- `components/chat/create-artifact.tsx`
- `components/chat/artifact.tsx`
- `components/chat/data-stream-handler.tsx`
- `components/chat/document-preview.tsx`

### 4.2 Artifact 类型定义

- `artifacts/text/client.tsx`
- `artifacts/code/client.tsx`
- `artifacts/html/client.tsx`
- `artifacts/image/client.tsx`
- `artifacts/sheet/client.tsx`

### 4.3 服务端生成与更新

- `lib/artifacts/server.ts`
- `lib/agent/tools/create-document.ts`
- `lib/agent/tools/update-document.ts`
- `lib/agent/tools/edit-document.ts`
- `lib/agent/tools/request-suggestions.ts`
- `artifacts/*/server.ts`

### 4.4 持久化与版本

- `app/(chat)/api/document/route.ts`
- `lib/db/queries.ts`
- `lib/db/schema.ts`

---

## 5. 一个最重要的心智模型

读 Artifact 代码时，最容易混淆的是“到底哪个对象才是 Artifact”。

建议始终把它拆成四层：

1. 聊天消息里的 tool part / data part
2. 右侧面板当前的 `UIArtifact`
3. 数据库中的 `Document` 版本链
4. 各 kind 的类型定义与专属 metadata

只要把这四层分开，后面的客户端与服务端逻辑都会清晰很多。
