# `data-*` UI 事件说明

这篇文档专门回答下面这些字段是什么、从哪里来、谁在消费：

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

如果你想看 Artifact 系统的整体设计，再看 [Artifact 文档索引](./artifacts/README.md)。
如果你想顺着 `/api/chat -> useChat -> DataStreamHandler -> useArtifact` 的真实主链路读懂这套实现，请继续看 [SSE 流处理文档集](./sse/README.md)。

---

## 1. 一句话先说清

这些名字大多数不是“写在某个 DOM 节点上的 `data-*` 属性”，而是：

> AI SDK UI message stream 里的自定义 data part 类型名。

它们的生命周期是：

1. 服务端通过 `dataStream.write({ type: "data-...", data })` 写进聊天流
2. 前端 `useChat({ onData })` 收到后放进本地 `dataStream`
3. `DataStreamHandler` 解释这些事件
4. Artifact 面板或 metadata 根据事件更新

只有 `data-suggestion-id` 这种才是真正写到 DOM 上的属性；它不在你这次列出来的名单里。

---

## 2. 名字是怎么来的

这套命名不是项目里随便拍脑袋起的，而是由两层一起决定的。

### 2.1 项目先声明“有哪些 data 类型”

文件：`lib/types.ts`

```ts
export type CustomUIDataTypes = {
  textDelta: string;
  imageDelta: string;
  sheetDelta: string;
  codeDelta: string;
  htmlDelta: string;
  suggestion: Suggestion;
  appendMessage: string;
  id: string;
  title: string;
  kind: ArtifactKind;
  clear: null;
  finish: null;
  "chat-title": string;
};
```

这里声明的是逻辑名字：

- `textDelta`
- `codeDelta`
- `id`
- `kind`

还不是最终流里看到的完整 `type` 字符串。

### 2.2 AI SDK 把逻辑名字映射成 `data-${NAME}`

文件：`node_modules/ai/src/ui/ui-messages.ts`

```ts
export type DataUIPart<DATA_TYPES extends UIDataTypes> = ValueOf<{
  [NAME in keyof DATA_TYPES & string]: {
    type: `data-${NAME}`;
    id?: string;
    data: DATA_TYPES[NAME];
  };
}>;
```

所以：

- `kind` 会变成 `data-kind`
- `id` 会变成 `data-id`
- `textDelta` 会变成 `data-textDelta`

这就是它们名字的“类型来源”。

但在运行时，项目里依然是显式写字符串，例如：

```ts
dataStream.write({
  type: "data-kind",
  data: kind,
  transient: true,
});
```

也就是说：

- `CustomUIDataTypes` 决定这类事件是否合法
- `DataUIPart` 规定它们的命名形状
- 各个 tool / handler 在运行时真正发出这些事件

---

## 3. 它们从哪里进入前端

完整链路如下：

1. `app/(chat)/api/chat/route.ts` 调用 `createUIMessageStream()`
2. `createChatAgent()` 把同一个 `dataStream` writer 传给 document tools
3. `createDocument` / `updateDocument` / `editDocument` / `requestSuggestions` 或各类 artifact handler 调用 `dataStream.write(...)`
4. `use-active-chat.tsx` 里的 `useChat({ onData })` 收到 data part
5. `onData` 把它追加到 `components/chat/data-stream-provider.tsx` 的 `dataStream` 状态
6. `components/chat/data-stream-handler.tsx` 逐条消费
7. 通用字段直接更新 `useArtifact()` 状态，类型专属字段交给对应 artifact 的 `onStreamPart`

可以把它理解成：

> 服务端发 UI 事件，前端并不把它们当聊天正文，而是把它们当“旁路控制信号”来驱动 Artifact 面板。

---

## 4. 每个字段到底是谁发的

下表只写你这次点名的字段。

| 字段 | 服务端发送方 | 何时发送 | `data` 内容 | 前端消费方 | 作用 |
| --- | --- | --- | --- | --- | --- |
| `data-kind` | `lib/agent/tools/create-document.ts` | 新建 Artifact 开始时 | `kind` 字符串 | `DataStreamHandler` | 设置当前面板类型 |
| `data-id` | `lib/agent/tools/create-document.ts` | 新建 Artifact 开始时 | 新生成的 UUID | `DataStreamHandler` | 设置 `documentId` |
| `data-title` | `lib/agent/tools/create-document.ts` | 新建 Artifact 开始时 | 标题字符串 | `DataStreamHandler` | 设置面板标题 |
| `data-clear` | `create-document.ts`、`update-document.ts`、`edit-document.ts` | 开始写新内容前 | `null` | `DataStreamHandler` | 清空当前 `artifact.content` |
| `data-textDelta` | `artifacts/text/server.ts`；`edit-document.ts` 在普通 text 分支也会发 | text 生成或重写时；text 精确替换后 | 文本增量或完整替换后的文本 | `artifacts/text/client.tsx` | 追加到文本内容 |
| `data-codeDelta` | `artifacts/code/server.ts`；`edit-document.ts` 的 code 分支 | code 生成或重写时；code 精确替换后 | 当前完整代码快照 | `artifacts/code/client.tsx` | 用最新完整代码覆盖编辑器内容 |
| `data-sheetDelta` | `artifacts/sheet/server.ts`；`edit-document.ts` 的 sheet 分支 | sheet 生成或重写时；sheet 精确替换后 | 当前完整 CSV 快照 | `artifacts/sheet/client.tsx` | 用最新完整 CSV 覆盖表格内容 |
| `data-imageDelta` | 当前主链路里没有发送方 | 暂无 | 预期是图片内容 | `artifacts/image/client.tsx` | 前端保留了接收逻辑，但仓库里没有实际 sender |
| `data-suggestion` | `lib/agent/tools/request-suggestions.ts` | 请求写作建议时 | `Suggestion` 对象 | `artifacts/text/client.tsx` | 追加到 text artifact 的 metadata.suggestions |
| `data-finish` | `create-document.ts`、`update-document.ts`、`edit-document.ts` | 当前一次 artifact 写入流程结束时 | `null` | `DataStreamHandler` | 把 `artifact.status` 设回 `idle` |

---

## 5. 时序上怎么理解最不容易错

这些字段不是总会一起出现。不同工具发出的序列不一样。

### 5.1 `createDocument` 的典型顺序

文件：`lib/agent/tools/create-document.ts`

顺序是：

1. `data-kind`
2. `data-id`
3. `data-title`
4. `data-clear`
5. 若干条类型专属 delta
6. `data-finish`

也就是先把“我要开一个什么面板”告诉前端，再开始灌正文。

### 5.2 `updateDocument` 的典型顺序

文件：`lib/agent/tools/update-document.ts`

顺序是：

1. `data-clear`
2. 若干条类型专属 delta
3. `data-finish`

这里不会重新发：

- `data-id`
- `data-title`
- `data-kind`

因为这是对已有 Artifact 的重写，前端已经知道当前面板是谁。

### 5.3 `editDocument` 的典型顺序

文件：`lib/agent/tools/edit-document.ts`

顺序是：

1. 先把替换后的内容保存到数据库
2. `data-clear`
3. 一条类型专属 delta
4. `data-finish`

和 `updateDocument` 的区别在于：

- `updateDocument` 是重新调用模型生成
- `editDocument` 是本地字符串替换后直接广播新结果

### 5.4 `requestSuggestions` 是一条旁路

文件：`lib/agent/tools/request-suggestions.ts`

它只会发 `data-suggestion`，不会发：

- `data-clear`
- `data-finish`

因为 suggestion 不属于正文重写，它只是给 text artifact 增加附加 metadata。

---

## 6. 为什么 `textDelta` 是“追加”，而 `codeDelta` / `sheetDelta` 是“覆盖”

这是这套协议里最容易忽略的细节。

### 6.1 `data-textDelta`

发送方：`artifacts/text/server.ts`

服务端每次只把本次新出来的 `delta.text` 发给前端：

```ts
dataStream.write({
  type: "data-textDelta",
  data: delta.text,
  transient: true,
});
```

前端消费时是：

```ts
content: draftArtifact.content + streamPart.data
```

所以 text 的语义是：

> 发增量，前端自己 append。

### 6.2 `data-codeDelta`

发送方：`artifacts/code/server.ts`

服务端每次发的是“当前已经生成好的完整代码”：

```ts
dataStream.write({
  type: "data-codeDelta",
  data: stripFences(draftContent),
  transient: true,
});
```

前端消费时直接整体覆盖：

```ts
content: streamPart.data
```

所以 code 的语义是：

> 发完整快照，前端整体替换。

### 6.3 `data-sheetDelta`

sheet 跟 code 一样，发的是当前完整 CSV 快照，不是单个 token 增量。

这样做的好处是：

- code / html / sheet 更容易保持“当前内容总是可解析的完整稿”
- text 更适合自然语言逐段追加显示

---

## 7. 前端到底在哪里消费这些字段

消费分两层。

### 7.1 通用字段由 `DataStreamHandler` 统一处理

文件：`components/chat/data-stream-handler.tsx`

它直接处理：

- `data-id`
- `data-title`
- `data-kind`
- `data-clear`
- `data-finish`

对应效果分别是：

- 设置当前文档 ID
- 设置标题
- 设置 artifact kind
- 清空内容
- 结束 streaming 状态

### 7.2 类型专属字段交给各自 artifact

同一个 `DataStreamHandler` 会先根据当前 `artifact.kind` 找到 `artifactDefinitions` 里的定义，然后调用对应的 `onStreamPart`。

当前对应关系是：

| kind | 客户端文件 | 消费的字段 |
| --- | --- | --- |
| `text` | `artifacts/text/client.tsx` | `data-textDelta`、`data-suggestion` |
| `code` | `artifacts/code/client.tsx` | `data-codeDelta` |
| `sheet` | `artifacts/sheet/client.tsx` | `data-sheetDelta` |
| `html` | `artifacts/html/client.tsx` | `data-htmlDelta` |
| `image` | `artifacts/image/client.tsx` | `data-imageDelta` |

你这次问的名单里没有 `data-htmlDelta`，但仓库当前实际上已经有这条链路。

---

## 8. `data-suggestion` 和 `data-suggestion-id` 不是一回事

这两个特别容易混。

### 8.1 `data-suggestion`

它是流里的 UI 事件：

- 来源：`request-suggestions.ts`
- 载荷：一个 `Suggestion` 对象
- 去向：`textArtifact` 的 metadata

### 8.2 `data-suggestion-id`

它是真正的 DOM 属性：

- 来源：`lib/editor/functions.tsx`
- 写入位置：ProseMirror decoration 的属性对象
- 读取位置：`components/chat/text-editor.tsx` 的 click handler

对应代码是：

```ts
{
  class: "suggestion-highlight",
  "data-suggestion-id": suggestion.id,
}
```

点击高亮时，编辑器会这样读取：

```ts
const id = highlight.getAttribute("data-suggestion-id");
```

所以：

- `data-suggestion` 是聊天流里的事件类型
- `data-suggestion-id` 是浏览器 DOM 上的属性

这两者属于完全不同的层。

---

## 9. 一个最实用的心智模型

如果你以后再看到新的 `data-*` 字段，可以按下面四个问题去定位：

1. `lib/types.ts` 里有没有这个 key
2. 哪个服务端文件在 `dataStream.write({ type: "data-..." })`
3. `use-active-chat.tsx` 收到后有没有交给 `DataStreamHandler`
4. 最终是谁在 `onStreamPart` 或通用 switch 里消费它

套回这次这批字段，可以简化成一句：

> `data-id` / `data-title` / `data-kind` / `data-clear` / `data-finish` 是通用 Artifact 控制事件；`data-textDelta` / `data-codeDelta` / `data-sheetDelta` / `data-imageDelta` 是类型专属内容事件；`data-suggestion` 是 text artifact 的 metadata 事件。

---

## 10. 相关但不在这次问题里的字段

仓库里还存在几条同类事件：

- `data-htmlDelta`
- `data-chat-title`
- `data-appendMessage`

它们和这篇文档讲的是同一套机制，只是用途不同。
