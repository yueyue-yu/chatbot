# `artifacts/` 目录梳理

本文档用于说明仓库中 `artifacts/` 目录的定位、各子目录职责，以及它和 `components/chat/`、`lib/artifacts/`、`lib/ai/tools/` 之间的关系。

---

## 1. artifacts 是什么

在这个项目里，Artifact 可以理解为：

> 聊天过程中由模型生成、并以“可编辑富内容面板”形式展示给用户的对象。

它不是普通聊天文本，而是带有独立类型、独立编辑器、独立版本历史、独立工具栏的一类文档实体。

当前前端支持的 Artifact 类型有：

- `text`：文本文档
- `code`：代码文档
- `sheet`：表格/CSV 文档
- `image`：图片文档

其中真正接入到服务端文档处理注册表的类型是：

- `text`
- `code`
- `sheet`

`image` 目前只有前端展示定义，没有像其他三类一样接入 `lib/artifacts/server.ts` 的文档 handler 注册。

---

## 2. 目录结构

```text
artifacts/
├── actions.ts           # Artifact 共享 server action
├── code/
│   ├── client.tsx       # code 类型的前端定义
│   └── server.ts        # code 类型的服务端生成/更新逻辑
├── image/
│   └── client.tsx       # image 类型的前端定义
├── sheet/
│   ├── client.tsx       # sheet 类型的前端定义
│   └── server.ts        # sheet 类型的服务端生成/更新逻辑
└── text/
    ├── client.tsx       # text 类型的前端定义
    └── server.ts        # text 类型的服务端生成/更新逻辑
```

一个很重要的理解方式是：

- `artifacts/*/client.tsx`
  负责“这个 Artifact 在前端如何展示、如何响应流式数据、有哪些按钮和快捷操作”
- `artifacts/*/server.ts`
  负责“这个 Artifact 在服务端如何由模型创建、如何更新、往前端流式发送什么数据”
- `artifacts/actions.ts`
  放各类 Artifact 可能共享的服务端动作

---

## 3. 它在整体架构里的位置

Artifact 能力不是单靠 `artifacts/` 目录独立完成的，而是由几层协作完成：

### 3.1 `artifacts/`
定义每种 Artifact 的“类型实现”。

### 3.2 `components/chat/create-artifact.tsx`
定义 `Artifact` 类，是各类型 Artifact 的统一配置模型。一个 Artifact 需要提供：

- `kind`
- `description`
- `content`
- `actions`
- `toolbar`
- `initialize`
- `onStreamPart`

也就是说，`artifacts/text/client.tsx` 这类文件，本质上是在实例化这个配置类。

### 3.3 `components/chat/artifact.tsx`
这是 Artifact 面板的统一宿主组件：

- 注册所有前端 Artifact 定义
- 根据 `kind` 找到对应实现
- 拉取文档版本
- 处理保存、切换版本、diff 模式
- 渲染实际的编辑器内容

这里的注册表是：

- `textArtifact`
- `codeArtifact`
- `imageArtifact`
- `sheetArtifact`

### 3.4 `components/chat/data-stream-handler.tsx`
负责消费服务端发来的流式数据片段，并把这些片段分发给当前 Artifact：

- 通用片段：`data-id`、`data-title`、`data-kind`、`data-clear`、`data-finish`
- 类型专属片段：如 `data-textDelta`、`data-codeDelta`、`data-sheetDelta`、`data-imageDelta`、`data-suggestion`

### 3.5 `lib/artifacts/server.ts`
这是服务端 Artifact 文档处理注册中心，主要做两件事：

1. 通过 `createDocumentHandler()` 封装“生成/更新后保存文档”的通用逻辑
2. 维护 `documentHandlersByArtifactKind` 注册表

当前服务端注册了：

- `textDocumentHandler`
- `codeDocumentHandler`
- `sheetDocumentHandler`

并导出：

- `artifactKinds = ["text", "code", "sheet"]`

### 3.6 `lib/ai/tools/*`
AI 工具层会调用 Artifact handler：

- `create-document.ts`：创建新 Artifact
- `update-document.ts`：大范围重写 Artifact
- `edit-document.ts`：精确替换内容
- `request-suggestions.ts`：给 text Artifact 生成建议

---

## 4. 通用工作流

一个 Artifact 从“用户提出需求”到“面板里可编辑”，大致会经过下面这条链路。

### 4.1 创建流程

1. 用户在聊天中提出需求
2. 模型调用 `createDocument` 工具
3. `lib/ai/tools/create-document.ts`：
   - 生成 `id`
   - 向前端发送 `data-kind` / `data-id` / `data-title` / `data-clear`
   - 根据 `kind` 找到对应 `documentHandler`
4. 具体 handler（如 `artifacts/text/server.ts`）开始调用模型流式生成内容
5. handler 持续发送类型专属 delta：
   - text → `data-textDelta`
   - code → `data-codeDelta`
   - sheet → `data-sheetDelta`
6. `components/chat/data-stream-handler.tsx` 接收这些流片段
7. 对应的 `artifacts/*/client.tsx` 通过 `onStreamPart` 更新当前 Artifact 面板内容
8. 生成完成后发送 `data-finish`
9. `lib/artifacts/server.ts` 在服务端把最终内容保存到数据库

### 4.2 更新流程

更新主要有两种：

#### A. 全量重写
通过 `updateDocument` 工具触发：

- 先查已有文档
- 找到对应 kind 的 handler
- 重新流式生成完整内容
- 保存为新版本

#### B. 精确编辑
通过 `editDocument` 工具触发：

- 查文档内容
- 用 `old_string -> new_string` 做精确替换
- 直接写回数据库
- 再通过 `data-codeDelta` / `data-sheetDelta` / `data-textDelta` 把最新内容推回前端

### 4.3 建议流程（仅 text）

`text` Artifact 额外支持建议：

1. `textArtifact.initialize()` 调用 `artifacts/actions.ts` 中的 `getSuggestions`
2. 从数据库拉取当前文档已有建议
3. `requestSuggestions` 工具流式返回 `data-suggestion`
4. `artifacts/text/client.tsx` 将建议写入 metadata
5. `Editor` 组件显示建议高亮和修改意见

---

## 5. 每个文件的作用

## 5.1 `artifacts/actions.ts`

```ts
export async function getSuggestions({ documentId }: { documentId: string })
```

作用：

- 给 text Artifact 提供服务端查询能力
- 根据 `documentId` 拉取数据库里的 suggestions
- 供 `text/client.tsx` 初始化 metadata 时使用

这个文件目前主要服务于文本文档，不是所有 Artifact 通用都会用到。

---

## 5.2 `artifacts/text/`

### `artifacts/text/client.tsx`

作用：定义文本文档在前端的行为。

核心职责：

- `kind: "text"`
- 初始化时加载 suggestions
- 接收 `data-textDelta` 追加正文内容
- 接收 `data-suggestion` 追加建议列表
- 用 `Editor` 渲染正文
- 支持 diff 模式查看版本差异
- 支持复制、前后版本切换、查看修改
- 工具栏支持：
  - `Add final polish`
  - `Request suggestions`

它是四类 Artifact 里功能最完整的一类，因为既支持编辑，又支持版本 diff，又支持 suggestion 体系。

### `artifacts/text/server.ts`

作用：定义文本文档在服务端如何生成与更新。

核心逻辑：

- `onCreateDocument`
  - 用 `streamText()` 根据标题/主题生成文档
  - system prompt 允许 Markdown、鼓励使用标题
  - 流式发送 `data-textDelta`
- `onUpdateDocument`
  - 基于旧内容和修改描述进行全文更新
  - 同样流式发送 `data-textDelta`

特点：

- 使用 `smoothStream({ chunking: "word" })`，让文本流更平滑
- 客户端是“增量拼接”模式：每次只把新 delta 追加到已有内容

---

## 5.3 `artifacts/code/`

### `artifacts/code/client.tsx`

作用：定义代码 Artifact 在前端的展示和交互。

核心职责：

- `kind: "code"`
- 接收 `data-codeDelta` 更新代码内容
- 用 `CodeEditor` 渲染代码
- 支持复制代码、版本切换
- 支持工具栏快捷指令：
  - 添加注释
  - 添加日志
- 额外支持“运行代码”

最有特点的是 `Run` 动作：

- 使用浏览器中的 `Pyodide`
- 目前仅支持 Python 执行
- 捕获 stdout 输出到 `Console`
- 自动识别 `matplotlib` / `plt.`，为图像输出补装处理逻辑
- 若绘图，能把图片以 `data:image/png;base64,...` 的形式输出到控制台面板

因此，code Artifact 不只是代码展示器，还是一个轻量的 Python 运行环境。

### `artifacts/code/server.ts`

作用：定义代码文档在服务端如何生成与更新。

核心逻辑：

- `onCreateDocument`
  - 调用模型生成代码
  - 强制模型只输出代码本体，不要解释、不加 markdown fence
- `onUpdateDocument`
  - 基于旧代码和修改描述输出完整新代码
- 流式发送 `data-codeDelta`

额外细节：

- 用 `stripFences()` 去掉模型可能输出的 ``` 包裹
- 客户端接收到的是“完整当前代码快照”，而不是单个 token 追加后的局部文本

---

## 5.4 `artifacts/sheet/`

### `artifacts/sheet/client.tsx`

作用：定义表格 Artifact 的前端行为。

核心职责：

- `kind: "sheet"`
- 接收 `data-sheetDelta`
- 用 `SpreadsheetEditor` 渲染 CSV 内容
- 支持复制为 `.csv`
- 支持版本切换
- 提供两类工具栏动作：
  - 清洗/格式化数据
  - 分析并可视化数据（要求创建新的 code Artifact）

这里的 sheet 本质上是“CSV 驱动的表格编辑器”。

### `artifacts/sheet/server.ts`

作用：定义表格文档在服务端如何生成与更新。

核心逻辑：

- `onCreateDocument`
  - 调用模型生成 CSV 原始数据
  - system prompt 明确要求“只输出 raw CSV data”
- `onUpdateDocument`
  - 基于旧 CSV 和修改描述生成新的 CSV
- 流式发送 `data-sheetDelta`

特点：

- 客户端拿到的是当前完整 CSV 内容
- 和 code 类似，也更接近“完整快照覆盖”模式

---

## 5.5 `artifacts/image/`

### `artifacts/image/client.tsx`

作用：定义图片 Artifact 在前端的展示行为。

核心职责：

- `kind: "image"`
- 接收 `data-imageDelta`
- 用 `ImageEditor` 渲染图片
- 支持复制图片到剪贴板
- 支持版本切换

### 当前状态说明

和 `text` / `code` / `sheet` 相比，`image` 目前是“前端可识别类型”，但不是完整接入的服务端文档类型：

- `lib/artifacts/server.ts` 没有注册 `imageDocumentHandler`
- `artifactKinds` 里也没有 `image`
- `createDocument` 工具不能直接创建 `image` Artifact
- 仓库内也没有对应的 `artifacts/image/server.ts`

因此目前更合理的理解是：

> `image` 已经具备 UI 容器能力，但尚未完成和服务端文档创建/更新链路的统一接入。

---

## 6. 四类 Artifact 的差异对比

| 类型 | 前端文件 | 服务端文件 | 是否接入文档 handler | 内容形式 | 特色能力 |
|---|---|---|---|---|---|
| text | `artifacts/text/client.tsx` | `artifacts/text/server.ts` | 是 | Markdown/普通文本 | suggestions、diff、编辑 |
| code | `artifacts/code/client.tsx` | `artifacts/code/server.ts` | 是 | 代码文本 | Pyodide 执行、控制台输出 |
| sheet | `artifacts/sheet/client.tsx` | `artifacts/sheet/server.ts` | 是 | CSV | 表格编辑、复制 CSV |
| image | `artifacts/image/client.tsx` | 无 | 否 | base64 图片 | 图片展示、复制图片 |

---

## 7. 为什么要把 artifacts 单独做成一个目录

这样拆分有几个明显好处：

### 7.1 按类型隔离复杂度

不同 Artifact 的交互差异非常大：

- 文本要 suggestions 和 diff
- 代码要运行和 console
- 表格要 CSV 解析和清洗
- 图片要剪贴板复制

如果都写在一个文件里，复杂度会迅速失控。

### 7.2 前后端逻辑天然成对

每种 Artifact 通常都有两类实现：

- 客户端渲染 / 动作 / 流数据处理
- 服务端生成 / 更新 / 输出协议

按 `kind` 聚合在一个目录下，阅读和扩展都更直观。

### 7.3 方便新增类型

如果未来要新增 `slides`、`diagram`、`html` 等 Artifact，通常只需要沿着同一模式补齐：

1. `artifacts/new-kind/client.tsx`
2. `artifacts/new-kind/server.ts`
3. 在 `components/chat/artifact.tsx` 注册前端定义
4. 在 `lib/artifacts/server.ts` 注册服务端 handler
5. 让工具层允许创建该 kind

---

## 8. 新增一个 Artifact 时通常要改哪些地方

以新增 `diagram` 为例，最少需要关注这些位置：

### 前端

- `artifacts/diagram/client.tsx`
  - 定义 `new Artifact({...})`
- `components/chat/artifact.tsx`
  - 把 `diagramArtifact` 加入 `artifactDefinitions`
- `components/chat/data-stream-handler.tsx`
  - 一般不用专门改，只要沿用现有流分发机制即可

### 服务端

- `artifacts/diagram/server.ts`
  - 实现 `createDocumentHandler`
- `lib/artifacts/server.ts`
  - 注册 `diagramDocumentHandler`
  - 扩充 `artifactKinds`

### 工具层

- `lib/ai/tools/create-document.ts`
  - 允许模型选择新的 kind
- 如有必要，补充：
  - `update-document.ts`
  - `edit-document.ts`
  - 类型专属工具

### 数据与协议

- 确定新的流式事件类型，如 `data-diagramDelta`
- 在客户端 `onStreamPart` 中消费它

---

## 9. 可以记住的核心结论

如果只记三件事，可以记下面这三个结论：

### 结论 1
`artifacts/` 不是单纯的“静态模板目录”，而是 Artifact 类型实现层。

### 结论 2
每个 `client.tsx` 负责前端交互，每个 `server.ts` 负责服务端生成/更新；二者通过流式数据协议衔接。

### 结论 3
当前真正完整跑通的服务端 Artifact 类型是：

- `text`
- `code`
- `sheet`

而 `image` 目前更像是一个已准备好的前端容器，尚未完全接入统一文档生成链路。

---

## 10. 相关阅读

建议结合以下文件一起看：

- `components/chat/create-artifact.tsx`
- `components/chat/artifact.tsx`
- `components/chat/data-stream-handler.tsx`
- `lib/artifacts/server.ts`
- `lib/ai/tools/create-document.ts`
- `lib/ai/tools/update-document.ts`
- `lib/ai/tools/edit-document.ts`
- `lib/ai/tools/request-suggestions.ts`

如果是第一次接手这个模块，推荐阅读顺序：

1. `components/chat/create-artifact.tsx`
2. `components/chat/artifact.tsx`
3. `components/chat/data-stream-handler.tsx`
4. `lib/artifacts/server.ts`
5. `artifacts/text/client.tsx`
6. `artifacts/text/server.ts`
7. 其他 kind 的 `client.tsx` / `server.ts`
