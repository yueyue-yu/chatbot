# Artifact 全生命周期深潜

本文档面向准备维护、扩展、二开这个项目的开发者。

如果你只想先知道仓库大图，先看 [project-structure.md](./project-structure.md)。
如果你想按步骤带着自己读源码，再看 [project-learning-path.md](./project-learning-path.md)。

---

## 1. Artifact 到底是什么

在这个项目里，Artifact 不是一条普通聊天消息，而是：

> 模型在聊天过程中创建或修改的、以侧边面板形式展示的富内容文档对象。

它有几个非常鲜明的特征：

- 有独立的 `kind`
- 有自己的展示组件和交互动作
- 有独立的流式更新协议
- 会持久化到 `Document` 表
- 支持版本历史
- 可以通过 AI tool 继续编辑

当前前端支持四种 Artifact：

- `text`
- `code`
- `sheet`
- `image`

但“支持显示”和“支持完整后端链路”不是一回事。当前真正接入服务端 Artifact handler 注册表的只有：

- `text`
- `code`
- `sheet`

`image` 目前只接了前端类型定义、预览和数据库枚举，没有接入 `lib/artifacts/server.ts` 的服务端 handler 注册，也不在 `createDocument` 的 kind 枚举里。

---

## 2. 先建立边界感：Artifact 相关的 4 层对象

阅读这条链路时，最容易混淆的是“到底哪个对象才是 Artifact”。实际上这里至少有 4 层。

| 层级 | 它是什么 | 典型来源 | 作用 |
| --- | --- | --- | --- |
| chat message | 聊天消息里的 `parts` | `useChat()`、`/api/chat` | 承载文本、reasoning、tool call、tool result |
| tool output | `tool-createDocument` / `tool-updateDocument` 等输出 | `lib/agent/tools/*` | 告诉前端“创建/更新了哪个文档” |
| document record | `Document` 表中的版本记录 | `saveDocument()` / `updateDocumentContent()` | 真正持久化 Artifact 内容 |
| UI artifact state | 当前侧边面板显示状态 | `hooks/use-artifact.ts` | 控制当前打开了哪个文档、显示什么内容、是否展开 |

可以把它们理解成：

1. 聊天消息里出现“某个 Artifact 被创建/更新了”
2. 前端根据 tool 结果和流事件打开侧边面板
3. 面板内部再去拉 `Document` 历史版本
4. 用户继续编辑或让模型继续修改这个 Artifact

---

## 3. 核心契约：这条链路里的关键类型

这一节是二开时最重要的“事实上的公共契约”。

## 3.1 `Artifact` 配置模型

文件：`components/chat/create-artifact.tsx`

这里定义了 Artifact 类型系统的统一配置类。每一种 Artifact 本质上都是：

```ts
new Artifact({
  kind,
  description,
  content,
  actions,
  toolbar,
  initialize,
  onStreamPart,
});
```

各字段职责：

- `kind`
  类型标识，例如 `text`、`code`
- `description`
  给模型和 UI 使用的类型说明
- `content`
  该类型在侧边面板中的主内容组件
- `actions`
  面板右侧纵向动作按钮，例如复制、运行、切版本
- `toolbar`
  悬浮工具栏里的快捷消息动作
- `initialize`
  当一个已有文档被打开时执行的初始化逻辑，通常用来加载 metadata
- `onStreamPart`
  当服务端流式推来 `data-*` 片段时，如何更新当前 Artifact 面板

理解重点：

- `artifacts/*/client.tsx` 不是普通 React 组件集合
- 它们是在“实例化一种 Artifact 类型”

## 3.2 `ArtifactKind` 与 `UIArtifact`

文件：`components/chat/artifact.tsx`

前端通过 `artifactDefinitions` 注册所有类型：

- `textArtifact`
- `codeArtifact`
- `imageArtifact`
- `sheetArtifact`

然后用这个注册表派生：

- `ArtifactKind`
  当前前端认可的所有 kind 联合类型
- `UIArtifact`
  当前侧边面板本地状态

`UIArtifact` 关注的是“当前打开的是什么”，而不是数据库里的完整历史：

- `title`
- `documentId`
- `kind`
- `content`
- `isVisible`
- `status`
- `boundingBox`

`boundingBox` 主要服务于移动端/卡片点击后的展开动画。

## 3.3 `CustomUIDataTypes`

文件：`lib/types.ts`

这是服务端流向前端的 UI 数据协议。Artifact 相关的关键事件包括：

- `textDelta`
- `codeDelta`
- `sheetDelta`
- `imageDelta`
- `suggestion`
- `id`
- `title`
- `kind`
- `clear`
- `finish`

对应到真实流事件名就是：

- `data-textDelta`
- `data-codeDelta`
- `data-sheetDelta`
- `data-imageDelta`
- `data-suggestion`
- `data-id`
- `data-title`
- `data-kind`
- `data-clear`
- `data-finish`

这层协议非常关键。新增一种 Artifact 时，如果要有新的流片段类型，不能只写前端组件，还要同步扩展这里。

## 3.4 `DocumentHandler`

文件：`lib/artifacts/server.ts`

服务端每种 Artifact 都通过 `DocumentHandler` 接入统一注册：

```ts
type DocumentHandler = {
  kind: T;
  onCreateDocument: (...) => Promise<void>;
  onUpdateDocument: (...) => Promise<void>;
};
```

`createDocumentHandler()` 做了两件通用工作：

1. 调用具体类型自己的创建/更新实现，拿到最终完整内容
2. 在成功后统一写入 `Document` 表

这意味着：

- 各类型只负责“怎么生成内容”
- 保存版本这件事被统一封装在 `lib/artifacts/server.ts`

## 3.5 `Document` 与 `Suggestion`

文件：`lib/db/schema.ts`

`Document` 表不是“每个文档一行”，而是“每个版本一行”。

关键点：

- 主键是 `(id, createdAt)`
- 同一个 Artifact 的多个版本共享同一个 `id`
- 新版本靠新的 `createdAt` 区分

因此，“当前文档”其实是：

- 按 `id` 查询所有版本
- 按 `createdAt` 排序
- 取最新的一条

`Suggestion` 不是只绑定到 `documentId`，而是绑定到：

- `documentId`
- `documentCreatedAt`

这代表 suggestion 实际上依附的是“某个文档版本”，而不是抽象的文档名义 ID。

---

## 4. Artifact 在整体架构里的位置

如果只看 `artifacts/` 目录，会误以为 Artifact 能力都在这里。实际上它横跨了前后端多层。

| 层 | 关键文件 | 责任 |
| --- | --- | --- |
| 页面与聊天入口 | `app/(chat)/api/chat/route.ts` | 接请求、组装 agent、返回流 |
| Agent / tools | `lib/agent/agent.ts`、`lib/agent/tools/*` | 选择调用哪个 Artifact 工具 |
| 服务端 handler 注册 | `lib/artifacts/server.ts` | 按 kind 找到生成/更新逻辑并统一保存 |
| 类型实现 | `artifacts/*/server.ts`、`artifacts/*/client.tsx` | 每种 Artifact 的服务端生成逻辑和前端展示逻辑 |
| 流式消费 | `components/chat/data-stream-handler.tsx` | 消费 `data-*` 事件并写入本地面板状态 |
| 面板宿主 | `components/chat/artifact.tsx` | 统一渲染侧边面板、拉版本、切版本、保存手工编辑 |
| 持久化 | `app/(chat)/api/document/route.ts`、`lib/db/queries.ts` | 文档读取、手工保存、版本删除 |

建议建立一个心智模型：

> `artifacts/` 目录定义“这个类型是什么”，而不是独立完成“Artifact 系统”。

---

## 5. 一条完整时序：Artifact 怎么流起来

下面以“用户让模型创建一个文档/代码/表格 Artifact”为例。

## 5.1 从聊天请求进入 agent

入口文件：`app/(chat)/api/chat/route.ts`

关键链路：

1. 前端 `useChat()` 发送用户消息到 `/api/chat`
2. `route.ts` 创建 `ToolLoopAgent`
3. `createChatAgent()` 给 agent 注册 4 个 Artifact 相关工具：
   - `createDocument`
   - `editDocument`
   - `updateDocument`
   - `requestSuggestions`
4. 模型根据 system prompt 决定是否调工具

Artifact 能力并不是前端自己“猜”出来的，而是模型真正调用 tool 触发的。

## 5.2 `createDocument` 工具先发通用事件，再交给具体类型

文件：`lib/agent/tools/create-document.ts`

创建时，工具会先生成一个新的 `id`，然后依次向 UI 数据流写入：

1. `data-kind`
2. `data-id`
3. `data-title`
4. `data-clear`

这四个事件让前端知道：

- 将要打开的是什么类型
- 这个文档的 ID 是什么
- 面板标题是什么
- 先把旧内容清空

然后工具再根据 `kind` 去 `documentHandlersByArtifactKind` 里找具体 handler。

## 5.3 具体 handler 负责流式产出内容

文件：

- `artifacts/text/server.ts`
- `artifacts/code/server.ts`
- `artifacts/sheet/server.ts`

不同类型产出的流片段不同：

| kind | 服务端流事件 | 客户端更新方式 |
| --- | --- | --- |
| `text` | `data-textDelta` | 把增量追加到已有内容 |
| `code` | `data-codeDelta` | 用当前完整代码覆盖面板内容 |
| `sheet` | `data-sheetDelta` | 用当前完整 CSV 覆盖面板内容 |

其中最值得注意的差异：

- `text` handler 每次发送的是“新增长的一小段”
- `code` / `sheet` handler 每次发送的是“截至当前的完整草稿”

这就是为什么三个前端 `onStreamPart` 实现长得不一样。

## 5.4 `DataStreamHandler` 把服务端事件写进本地 Artifact 状态

文件：`components/chat/data-stream-handler.tsx`

它处理两类事情：

### A. 通用事件

由统一 switch 处理：

- `data-id`
- `data-title`
- `data-kind`
- `data-clear`
- `data-finish`

### B. 类型专属事件

交给当前 Artifact 的 `onStreamPart`：

- `textArtifact.onStreamPart`
- `codeArtifact.onStreamPart`
- `sheetArtifact.onStreamPart`
- `imageArtifact.onStreamPart`

每种类型自己决定：

- 如何更新 `artifact.content`
- 何时自动把面板设为可见
- 是否需要同步 metadata

## 5.5 `Artifact` 面板宿主负责展示、拉版本、保存

文件：`components/chat/artifact.tsx`

宿主组件做的事情比名字看起来多很多：

- 根据 `artifact.kind` 找到对应类型定义
- 通过 `/api/document?id=...` 拉这个文档的所有版本
- 维护 `edit` / `diff` 模式
- 维护当前版本索引
- 渲染具体的 `artifactDefinition.content`
- 把 `onSaveContent` 传给编辑器
- 在右侧挂载该类型的 `actions`
- 在底部挂载通用版本切换区

它不是“某一种 Artifact 的组件”，而是整个 Artifact 子系统的统一宿主。

## 5.6 创建完成后统一保存到数据库

文件：`lib/artifacts/server.ts`

无论是 `onCreateDocument` 还是 `onUpdateDocument`，最终都会：

1. 等待具体类型返回完整草稿字符串
2. 调用 `saveDocument()`
3. 以新的 `createdAt` 写入 `Document` 表

最后 tool 再发送：

- `data-finish`

前端收到后把 `artifact.status` 设回 `idle`。

---

## 6. 文档版本与保存语义

这是理解 Artifact 的核心之一，因为“更新内容”在这个项目里并不总是同一种写法。

## 6.1 版本是怎么定义的

同一个 Artifact 的多个版本：

- `Document.id` 相同
- `Document.createdAt` 不同

因此：

- `getDocumentsById({ id })` 会返回同一个文档的所有版本
- `getDocumentById({ id })` 会返回最新版本
- UI 中的版本切换，本质上是在切同一个 `id` 的不同 `createdAt`

## 6.2 四种改动路径的保存行为

| 路径 | 入口 | 保存方式 | 是否新增版本 |
| --- | --- | --- | --- |
| create | `createDocument` | `saveDocument()` | 是 |
| full rewrite | `updateDocument` | `saveDocument()` | 是 |
| exact replace | `editDocument` | `saveDocument()` | 是 |
| manual edit | `/api/document` + `isManualEdit: true` | `updateDocumentContent()` | 否，原地更新最新版本 |

## 6.3 逐条说明

### A. create

`createDocument` 会生成新 `documentId`，然后由 handler 生成初稿并保存。

结果：

- 新建一个 Artifact
- `Document` 表新增一行

### B. full rewrite

`updateDocument` 会先读取已有文档，再调用对应 handler 生成完整新内容。

结果：

- 复用原来的 `document.id`
- 新增一条更晚的 `createdAt`
- 形成一个新版本

### C. exact replace

`editDocument` 会对最新版本做精确字符串替换，然后再次 `saveDocument()`。

结果：

- 同样复用原来的 `document.id`
- 也会形成一个新版本

### D. manual edit

手工编辑来自侧边面板内的编辑器保存，入口是：

- `components/chat/artifact.tsx` 的 `saveContent()`
- `POST /api/document?id=...`

当请求体里有 `isManualEdit: true` 时，`app/(chat)/api/document/route.ts` 会调用：

- `updateDocumentContent({ id, content })`

这里不是插入新行，而是：

1. 找到这个 `id` 的最新版本
2. 直接更新那一条记录的 `content`

结果：

- 不会新增版本
- 当前最新版本被原地改写

这个差异很重要。不要把“面板里敲字保存”和“让 agent 改文档”混为一谈。

## 6.4 建议系统和版本的关系

`Suggestion` 通过 `(documentId, documentCreatedAt)` 指向某个具体版本。

这意味着：

- suggestion 概念上是版本相关的
- 但当前 `getSuggestionsByDocumentId()` 查询只按 `documentId` 取，不按版本过滤

文档里应该把这视为“当前实现现状”，不要脑补成严格的版本隔离建议系统。

---

## 7. 四类 Artifact 对比

## 7.1 对比总表

| kind | 客户端定义 | 服务端 handler | 流片段 | metadata | 代表能力 |
| --- | --- | --- | --- | --- | --- |
| `text` | `artifacts/text/client.tsx` | 有 | `data-textDelta` | `suggestions` | 富文本编辑、diff、建议 |
| `code` | `artifacts/code/client.tsx` | 有 | `data-codeDelta` | `outputs` | 代码编辑、Pyodide 运行、控制台输出 |
| `sheet` | `artifacts/sheet/client.tsx` | 有 | `data-sheetDelta` | 空对象 | 表格编辑、CSV 复制、数据操作快捷消息 |
| `image` | `artifacts/image/client.tsx` | 无 | `data-imageDelta` | 无 | 图片展示、复制图片 |

## 7.2 `text`

特点：

- 流式协议是“追加文本”
- `initialize()` 会通过 `artifacts/actions.ts` 读取已有 suggestion
- `requestSuggestions` 工具还会继续流式推送 `data-suggestion`
- 支持 `diff` 模式查看版本差异
- 是四类中功能最完整的一种

适合重点阅读的文件：

- `artifacts/text/client.tsx`
- `artifacts/text/server.ts`
- `components/chat/text-editor.tsx`
- `lib/agent/tools/request-suggestions.ts`
- `lib/editor/suggestions.tsx`

## 7.3 `code`

特点：

- 服务端发送的是“当前完整代码草稿”
- 客户端每次直接覆盖 `artifact.content`
- metadata 里维护 `outputs`
- `Run` 动作会在浏览器里通过 Pyodide 执行 Python
- 悬浮工具栏支持“Add comments”“Add logs”

适合重点阅读的文件：

- `artifacts/code/client.tsx`
- `artifacts/code/server.ts`
- `components/chat/code-editor.tsx`
- `components/chat/console.tsx`

## 7.4 `sheet`

特点：

- 本质上是 CSV 文本
- 服务端同样发送完整草稿
- 客户端使用 `SpreadsheetEditor`
- 工具栏更偏“继续向模型发消息”，例如清洗数据、分析并创建新的 code Artifact

适合重点阅读的文件：

- `artifacts/sheet/client.tsx`
- `artifacts/sheet/server.ts`
- `components/chat/sheet-editor.tsx`

## 7.5 `image`

特点：

- 前端有 Artifact 类型定义
- `Document` schema 允许 `kind: "image"`
- 预览组件、骨架屏、复制动作都已接入

但它目前不是一条完整链路，因为：

- `lib/artifacts/server.ts` 没有 `imageDocumentHandler`
- `artifactKinds` 不包含 `image`
- `createDocument` 不能创建 `image`
- 仓库里没有 `artifacts/image/server.ts`
- `editDocument` 对 `image` 也没有单独分支，默认会走 text delta 分支

因此，当前更准确的说法是：

> `image` 是前端已留口、后端未完整接通的 Artifact 类型。

---

## 8. metadata、动作与工具栏是怎么分层的

这部分很适合二开时参考。

## 8.1 metadata

文件：`hooks/use-artifact.ts`

Artifact metadata 不是存在 `UIArtifact` 里，而是单独走了另一份 SWR 状态：

- key 规则：`artifact-metadata-${artifact.documentId}`

这意味着：

- metadata 是按 `documentId` 分桶缓存的
- 切换到不同文档时，metadata 也会跟着切桶
- 常见用法是保存“不是正文内容，但和该 Artifact 强相关的前端状态”

当前已有例子：

- `text`：`suggestions`
- `code`：`outputs`

## 8.2 `actions`

文件：

- `components/chat/artifact-actions.tsx`
- `components/chat/create-artifact.tsx`

`actions` 是面板右侧竖着的一列按钮，典型能力包括：

- 复制
- 前后版本切换
- 切到 diff 模式
- 运行代码

这些动作直接拿到当前 Artifact 内容、版本信息、metadata。

## 8.3 `toolbar`

文件：`components/chat/toolbar.tsx`

`toolbar` 更像“继续和模型协作”的快捷入口。它做的不是本地 UI 操作，而是调用 `sendMessage()`，让模型再继续工作。

例如：

- text: Add final polish
- text: Request suggestions
- code: Add comments
- code: Add logs
- sheet: Format and clean data
- sheet: Analyze and visualize data

额外注意：

- 如果 code Artifact 的控制台输出里出现错误，`Toolbar` 会插入一个动态的 `Fix error` 工具
- 这个工具实际还是通过发消息，提示模型用 `updateDocument` 改现有脚本

---

## 9. 聊天消息是如何打开 Artifact 面板的

除了侧边面板本身，聊天区域里还有两类与 Artifact 强相关的组件。

## 9.1 `DocumentPreview`

文件：`components/chat/document-preview.tsx`

这是消息气泡里看到的 Artifact 卡片预览。

它负责：

- 展示 tool 输出对应的卡片
- 流式创建中显示 skeleton
- 点击卡片后把 `documentId`、`title`、`kind` 写进 `UIArtifact`
- 用 `boundingBox` 记录点击区域，服务于展开动画

## 9.2 `DocumentToolResult`

文件：`components/chat/document.tsx`

`requestSuggestions` 这种场景不展示整张预览卡，而是展示一枚更轻量的结果按钮。

点击后同样会：

- 写入 `documentId`
- 打开 Artifact 面板

## 9.3 `message.tsx`

文件：`components/chat/message.tsx`

这里负责把 assistant 消息里的 tool parts 渲染成不同的 UI：

- `tool-createDocument` -> `DocumentPreview`
- `tool-editDocument` -> `DocumentPreview`
- `tool-updateDocument` -> `DocumentPreview`
- `tool-requestSuggestions` -> `DocumentToolResult`

因此，Artifact 不只是“侧边栏一个区域”，它和消息渲染层是联动的。

---

## 10. 新增一种 Artifact 时，真实需要改哪些地方

这一节按“最容易漏掉的真实改动点”来列，不按目录树表面来列。

假设我们要新增 `diagram`。

## 10.1 前端类型定义与注册

至少要改：

- `artifacts/diagram/client.tsx`
  定义 `new Artifact({...})`
- `components/chat/artifact.tsx`
  把 `diagramArtifact` 加入 `artifactDefinitions`

这一步会影响：

- `ArtifactKind`
- `UIArtifact.kind`
- Artifact 宿主按 kind 找实现

## 10.2 流事件类型

至少要改：

- `lib/types.ts`

你要决定是否新增：

- `diagramDelta`

如果新增，就要同步保证服务端写 `data-diagramDelta`，前端 `onStreamPart` 也认这个事件。

## 10.3 服务端 handler 注册

至少要改：

- `artifacts/diagram/server.ts`
- `lib/artifacts/server.ts`

具体包括：

- 写 `diagramDocumentHandler`
- 加入 `documentHandlersByArtifactKind`
- 把 `diagram` 加进 `artifactKinds`

否则：

- `createDocument` 无法创建它
- `updateDocument` 无法重写它

## 10.4 tool 与流协议适配

至少要确认这些地方是否需要分支：

- `lib/agent/tools/create-document.ts`
- `lib/agent/tools/update-document.ts`
- `lib/agent/tools/edit-document.ts`

尤其是 `editDocument`。它当前只对：

- `code`
- `sheet`

做了专门 delta 分支，其他类型默认走 `data-textDelta`。

如果新类型不能复用 text delta，就必须补一个明确分支。

## 10.5 面板内容与预览内容

至少要改：

- `components/chat/document-preview.tsx`
  内联预览分支
- `components/chat/document-skeleton.tsx`
  skeleton 分支

否则即使主面板能渲染，消息里的卡片预览也可能不对。

## 10.6 文档接口与数据库

至少要改：

- `app/(chat)/api/document/route.ts`
  `kind` 校验 schema
- `lib/db/schema.ts`
  `Document.kind` 枚举
- `lib/db/migrations/*`
  对应 migration

这一步经常被忽略。当前 `image` 之所以能通过文档接口和 schema，是因为数据库和接口枚举都已经允许它，但后端 handler 链路没补完。

## 10.7 学习型结论

新增一种 Artifact 不是只加一个 `artifacts/new-kind/client.tsx`。

至少要沿着这条线检查一遍：

1. 前端类型定义
2. 前端注册
3. 流类型
4. 服务端 handler
5. tool 分发
6. 预览分支
7. skeleton
8. API schema
9. DB schema / migration

---

## 11. 已知限制与容易踩坑的地方

这一节只记录当前实现现状，不代表理想设计。

## 11.1 `image` 不是完整接通的 Artifact

现状：

- 前端支持 `image`
- 数据库 schema 允许 `image`
- 预览和复制 UI 已存在

但：

- 服务端没有 `imageDocumentHandler`
- tool 创建入口不允许 `image`

所以不要把 `image` 理解成和 `text` / `code` / `sheet` 同级完整。

## 11.2 `text`、`code`、`sheet` 的流式语义不一样

现状：

- `text` 是追加增量
- `code` / `sheet` 是整稿覆盖

这会直接影响：

- `onStreamPart` 的写法
- 编辑器如何感知内容变化
- 你调试“为什么内容重复/覆盖”时该看哪里

## 11.3 metadata 是按 `documentId` 分桶，不是按版本分桶

现状：

- key 只和 `documentId` 绑定
- 不和 `createdAt` 绑定

这对一些“严格版本隔离的前端派生状态”来说不一定够精细。

## 11.4 手工编辑不会新增版本

这是最容易误判的一点。

现状：

- agent 的 create / update / edit 会新增版本
- 面板内手工编辑保存会原地改最新版本

所以如果你在看版本历史时发现“有些修改没生成新版本”，优先想到的是这条语义差异。

## 11.5 当前缺少 Artifact 专项测试

仓库里有：

- 聊天页基础 E2E
- API 与建议相关测试

但没有围绕 Artifact 全生命周期的专项测试，例如：

- 不同 kind 的创建与更新
- 版本新增语义
- 手工编辑的原地更新语义
- `image` 的半接入状态边界

做二开时，建议优先把这部分测试补起来。

---

## 12. 推荐读码顺序

如果你要真正读懂 Artifact，不要一上来钻 `artifacts/text/client.tsx`。

推荐顺序如下。

## 12.1 先看宿主和状态

先读：

1. `components/chat/artifact.tsx`
2. `hooks/use-artifact.ts`

目标：

- 弄清“面板怎么打开”
- 弄清“当前打开哪个文档”存在什么状态里
- 弄清“版本和保存”是谁在管

## 12.2 再看流式消费

再读：

1. `components/chat/data-stream-handler.tsx`
2. `lib/types.ts`

目标：

- 弄清有哪些 `data-*` 事件
- 弄清通用事件和类型事件分别在哪里消费

## 12.3 再看服务端注册中心

再读：

1. `lib/artifacts/server.ts`
2. `lib/agent/tools/create-document.ts`
3. `lib/agent/tools/update-document.ts`
4. `lib/agent/tools/edit-document.ts`

目标：

- 弄清 handler 怎么注册
- 弄清 create / update / edit 的差别
- 弄清为什么有的路径新增版本，有的不新增

## 12.4 然后挑一种具体类型深挖

推荐先看 `text`：

1. `artifacts/text/client.tsx`
2. `artifacts/text/server.ts`
3. `lib/agent/tools/request-suggestions.ts`
4. `lib/editor/suggestions.tsx`

看完 `text` 后，再看 `code`，会更容易对比出“增量流”和“整稿流”的不同。

## 12.5 最后回到聊天主入口

最后再回看：

1. `app/(chat)/api/chat/route.ts`
2. `lib/agent/agent.ts`
3. `components/chat/message.tsx`
4. `components/chat/document-preview.tsx`

目标：

- 把 Artifact 主链和聊天主链闭环
- 理解为什么 Artifact 同时出现在消息区和侧边面板

---

## 13. 读完后你应该能回答的 4 个问题

如果这份文档起作用了，你读完后应该能独立回答：

1. Artifact 是什么，它和聊天消息、数据库文档、tool output 分别是什么关系？
2. 一个 Artifact 从模型决定创建，到前端面板出现、再到数据库落盘，中间经过了哪些文件？
3. 为什么有些修改会新增版本，有些不会？
4. 如果我要新增一个新的 Artifact kind，真实需要补哪些接入点？

只要这四个问题你能答出来，就已经不仅是“会用 Artifact”，而是开始具备维护和二开的基础了。
