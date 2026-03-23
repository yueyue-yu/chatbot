# Artifact 服务端工具、持久化与版本语义

这一章讲 Artifact 在服务端的主链路：

- 模型如何创建或更新 Artifact
- 服务端怎样选择具体 kind 的 handler
- 文档怎样落库
- 为什么有“新增版本”和“原地手工编辑”两种保存语义

---

## 1. 服务端主链有哪些文件

### 1.1 工具入口

- `lib/agent/tools/create-document.ts`
- `lib/agent/tools/update-document.ts`
- `lib/agent/tools/edit-document.ts`
- `lib/agent/tools/request-suggestions.ts`

### 1.2 Artifact handler 注册层

- `lib/artifacts/server.ts`

### 1.3 各 kind 的服务端实现

- `artifacts/text/server.ts`
- `artifacts/code/server.ts`
- `artifacts/html/server.ts`
- `artifacts/sheet/server.ts`

### 1.4 文档 API

- `app/(chat)/api/document/route.ts`

### 1.5 数据库层

- `lib/db/schema.ts`
- `lib/db/queries.ts`

---

## 2. `create-document` 工具在做什么

`lib/agent/tools/create-document.ts` 暴露给模型一个明确能力：

> 创建一个新的 Artifact。

它大体分 4 步：

### 2.1 生成新的文档 id

```ts
const id = generateUUID()
```

### 2.2 先写一组通用 `data-*` 事件

- `data-kind`
- `data-id`
- `data-title`
- `data-clear`

目的是先把前端右侧面板切到正确上下文。

### 2.3 找到对应 kind 的 document handler

通过：

```ts
documentHandlersByArtifactKind.find(...)
```

### 2.4 执行内容生成并保存

最后由具体 handler 产出完整内容，再写：

- `data-finish`

表示本轮 Artifact 生成结束。

---

## 3. `lib/artifacts/server.ts` 为什么是关键层

这个文件是 Artifact 服务端的统一注册表。

它定义了：

- `DocumentHandler`
- `createDocumentHandler(...)`
- `documentHandlersByArtifactKind`
- `artifactKinds`

### 3.1 `DocumentHandler` 的职责

每个 handler 至少要支持两件事：

- `onCreateDocument`
- `onUpdateDocument`

也就是说，服务端把“创建新文档”和“基于已有文档继续更新”看成两类一等操作。

### 3.2 `createDocumentHandler(...)` 的意义

它把两类共性逻辑收敛起来：

1. 调用具体 kind 的内容生成实现
2. 在成功后统一 `saveDocument(...)`

因此每个具体 kind 的 server 文件只需要关心：

- 如何生成完整正文

而不必重复写：

- 如何保存版本
- 如何拼统一接口

---

## 4. `artifactKinds` 和 `ArtifactKind` 不是同一个东西

这是服务端维护时非常重要的一个边界。

### 4.1 `ArtifactKind`

来源：

- `components/chat/artifact.tsx`

代表：

- 前端当前已注册、知道怎么渲染的 Artifact 类型

### 4.2 `artifactKinds`

来源：

- `lib/artifacts/server.ts`

代表：

- 服务端 create tool 当前允许模型创建的 kind

两者可以重合，但不要求永远完全一致。

当前仓库中最明显的例子就是：

- `image` 在前端存在
- 但不在服务端 `artifactKinds` 中

---

## 5. `Document` 表的语义不是“一个文档一行”

`Document` 在这个项目里的语义是：

> 一个 Artifact 文档的一个版本记录。

所以同一个 Artifact 会有多条 `Document` 记录。

关键理解：

- `id`
  - 代表文档身份
- `createdAt`
  - 代表该文档的某个版本时间点

通常你会看到这些操作：

- 按 `id` 查询所有版本
- 按顺序选择最新版本
- 删除某个时间点之后的版本

所以这里实际上实现的是“版本链”，不是简单的覆盖式保存。

---

## 6. `/api/document` 路由提供了什么能力

### 6.1 `GET /api/document?id=...`

返回：

- 某个 `documentId` 的所有版本

主面板拿到它后，才能：

- 渲染更新时间
- 切换历史版本
- 进入 diff 模式

### 6.2 `POST /api/document?id=...`

这里有两种语义：

#### 普通保存

如果没有 `isManualEdit`：

- 调 `saveDocument(...)`
- 追加一条新版本

#### 手工编辑

如果 `isManualEdit === true` 且文档已存在：

- 调 `updateDocumentContent(...)`
- 直接改写当前最新版本

这是前端面板正文编辑使用的路径。

### 6.3 `DELETE /api/document?id=...&timestamp=...`

语义是：

- 删除某个时间点之后的所有版本

这主要服务于版本裁剪、回退这类操作。

---

## 7. AI 生成版本和手工编辑版本有什么区别

这是 Artifact 系统里一个很重要的语义分界。

### 7.1 AI 工具生成 / 更新

通常走：

- `createDocument`
- `updateDocument`
- `editDocument`

结果是：

- 形成新的版本记录

### 7.2 用户在右侧面板手工改正文

通常走：

- `POST /api/document` + `isManualEdit: true`

结果是：

- 直接改写当前最新版本内容

为什么这样设计：

- AI 工具改动更像“生成一个新版本”
- 用户在编辑器里细修更像“修当前稿”

这能避免版本链被每次键盘输入污染得过于细碎。

---

## 8. 当前服务端链路对 image 的限制

尽管 `api/document` 允许 `kind: "image"`，当前完整 Artifact 主链里仍然没有：

- image server handler
- image create tool kind

这意味着如果你要让 image 真正进入“模型可创建 Artifact”的主链，还需要至少补：

- `artifacts/image/server.ts`
- `documentHandlersByArtifactKind`
- `artifactKinds`
- 相关工具说明与测试

---

## 9. 服务端维护时最重要的检查点

### 9.1 新增一个 kind 后，模型为什么调不到

先检查：

- 是否加入 `artifactKinds`
- 是否加入 `documentHandlersByArtifactKind`
- tool 描述里是否允许模型选择它

### 9.2 前端能打开面板，但内容没有版本历史

先检查：

- handler 最后是否调用了 `saveDocument(...)`
- `documentId` 是否稳定
- `/api/document` 是否能按该 id 拉回记录

### 9.3 手工编辑后版本逻辑不对

先检查：

- 前端是否带了 `isManualEdit: true`
- 路由是否走到了 `updateDocumentContent(...)`

如果没带这个标记，系统会误以为你要新增一条版本。
