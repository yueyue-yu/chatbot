# Artifact 总览与边界

这一章回答三个基础问题：

1. Artifact 在项目里到底是什么
2. 它和聊天消息、工具输出、数据库文档是什么关系
3. 它为什么会比普通组件复杂很多

---

## 1. Artifact 到底是什么

Artifact 可以理解为聊天系统里的“侧边工作区文档对象”。

它具备这些特征：

- 有独立的 `kind`
- 有自己的内容渲染组件
- 有自己的流式更新协议
- 不是靠消息正文承载完整内容
- 会落到 `Document` 表形成版本历史
- 可以继续被工具更新、编辑、补建议

所以它不是普通的 chat bubble，而是一套并行于消息时间线存在的“文档子系统”。

---

## 2. 四层对象一定要分清

Artifact 相关链路至少包含 4 层对象。

| 层 | 它是什么 | 典型来源 | 职责 |
| --- | --- | --- | --- |
| chat message | 聊天消息里的 text/tool parts | `useChat()`、`/api/chat` | 承载聊天本身与工具调用结果 |
| data part | `data-kind` / `data-textDelta` 等 UI 事件 | agent tool / handler | 驱动右侧面板实时变化 |
| document record | `Document` 表中的版本记录 | `saveDocument()` / `POST /api/document` | 持久化内容与版本 |
| UI artifact state | 当前右侧面板状态 | `hooks/use-artifact.ts` | 表示“现在面板里打开的是谁、是什么状态” |

把这四层混在一起，是维护 Artifact 时最容易踩的坑。

---

## 3. 为什么它不是普通消息的一部分

聊天消息更适合承载：

- 用户提问
- assistant 回复
- tool 调用与 tool 输出摘要

但 Artifact 往往包含：

- 大段正文
- 代码文件
- 表格 CSV 内容
- HTML 页面
- 版本切换与 diff
- 持续编辑

如果把这些内容直接塞进消息正文，会带来很多问题：

- 聊天时间线会非常臃肿
- 内容编辑与版本操作难以组织
- 大量流式增量不适合直接映射为消息块
- “当前正在看的文档”需要独立状态管理

因此项目采用的是“双轨结构”：

- 主轨：`messages`
- 侧轨：`artifact + dataStream + document versions`

---

## 4. 当前支持的 Artifact 类型

### 4.1 前端注册表中的类型

`components/chat/artifact.tsx` 中当前注册了：

- `textArtifact`
- `codeArtifact`
- `htmlArtifact`
- `imageArtifact`
- `sheetArtifact`

这份注册表会派生出：

- `ArtifactKind`
- `UIArtifact["kind"]`

也就是说，前端面板只认这里注册过的类型。

### 4.2 服务端真正支持创建的类型

`lib/artifacts/server.ts` + `lib/agent/tools/create-document.ts` 当前支持：

- `text`
- `code`
- `html`
- `sheet`

它们对应的服务端 handler 为：

- `artifacts/text/server.ts`
- `artifacts/code/server.ts`
- `artifacts/html/server.ts`
- `artifacts/sheet/server.ts`

### 4.3 `image` 的当前状态

当前 `image` 是一个需要特别留意的边界情况。

它已经有：

- 前端类型定义
- 前端内容组件
- `api/document` 层允许的 kind

但还没有：

- `documentHandlersByArtifactKind` 注册
- `create-document` 工具里的 kind 枚举

这意味着：

- 前端可以“理解 image Artifact”
- 但模型并不能通过现有 createDocument 主链路完整创建它

---

## 5. Artifact 的核心职责分布

Artifact 不是一个目录就能讲清楚，它横跨多层文件。

### 5.1 类型注册层

文件：

- `components/chat/create-artifact.tsx`
- `components/chat/artifact.tsx`
- `artifacts/*/client.tsx`

职责：

- 定义每一种 Artifact 是什么
- 定义对应内容组件、actions、toolbar、流事件消费逻辑

### 5.2 运行时状态层

文件：

- `hooks/use-artifact.ts`

职责：

- 保存当前面板正在显示的 `UIArtifact`
- 保存按 `documentId` 分区的 metadata

### 5.3 流式桥接层

文件：

- `hooks/use-active-chat.tsx`
- `components/chat/data-stream-provider.tsx`
- `components/chat/data-stream-handler.tsx`

职责：

- 接收 `useChat({ onData })` 的自定义 `data-*` 事件
- 解释并写入当前 Artifact UI 状态

### 5.4 面板宿主层

文件：

- `components/chat/artifact.tsx`

职责：

- 打开/关闭面板
- 拉取文档版本
- 保存手工编辑
- 切版本与 diff
- 组织 toolbar / footer / mobile transition

### 5.5 服务端编排层

文件：

- `lib/artifacts/server.ts`
- `lib/agent/tools/create-document.ts`
- `lib/agent/tools/update-document.ts`
- `lib/agent/tools/edit-document.ts`

职责：

- 把模型工具调用路由到具体 kind
- 执行内容生成/更新
- 保存文档版本
- 往前端流写 `data-*` 事件

### 5.6 持久化层

文件：

- `app/(chat)/api/document/route.ts`
- `lib/db/schema.ts`
- `lib/db/queries.ts`

职责：

- 读取版本链
- 新增版本
- 手工编辑最新版本
- 删除某时间点之后的版本

---

## 6. 一次创建 Artifact 的全景流程

可以先记住下面这条主线：

```txt
用户发消息
-> /api/chat
-> agent 调 createDocument / updateDocument / editDocument
-> 服务端写 data-* 事件
-> useActiveChat.onData 收到事件
-> DataStreamHandler 更新 useArtifact 状态
-> Artifact 面板打开并实时显示内容
-> 服务端把最终内容保存进 Document 版本链
-> 面板在 streaming 结束后回到持久化版本视图
```

这里最关键的一点是：

> 前端“看到正在生成的文档”与数据库“最终保存了哪个版本”不是同一时刻发生的事。

先有实时 UI，再有稳定版本链。

---

## 7. 维护时最重要的两个判断

你在改 Artifact 相关代码前，最好先判断自己改的是哪类问题：

### 7.1 我改的是“当前面板怎么显示”

通常会落在：

- `hooks/use-artifact.ts`
- `components/chat/artifact.tsx`
- `artifacts/*/client.tsx`

### 7.2 我改的是“模型怎样创建/更新这种文档”

通常会落在：

- `lib/agent/tools/*.ts`
- `lib/artifacts/server.ts`
- `artifacts/*/server.ts`
- `app/(chat)/api/document/route.ts`

如果这两类问题没有分清，就很容易在错误的层改代码。
