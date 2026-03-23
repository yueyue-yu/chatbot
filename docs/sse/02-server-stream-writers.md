# 02. 服务端如何写流

这一章回答的是：

> 服务端到底是谁在调用 `dataStream.write(...)`，又分别写了什么事件？

结论先说：

> 聊天 POST 路由只负责创建流和把 writer 交给 agent；真正写 `data-*` 事件的，是各个 tool 和各类 Artifact server handler。它们共同定义了前端能看到的控制事件、内容事件和 metadata 事件。

---

## 1. `route.ts` 负责“建流 + 提供 writer”

先看最外层。

```ts
const stream = createUIMessageStream<ChatMessage>({
  originalMessages: uiMessages,
  execute: async ({ writer: dataStream }) => {
    const agent = createChatAgent({
      dataStream,
      modelId: chatModel,
      requestHints,
      session,
    });

    const agentStream = await createAgentUIStream({
      abortSignal: request.signal,
      agent,
      uiMessages,
      onError: (error) => { /* ... */ },
      sendReasoning: capabilities.reasoning,
    });

    dataStream.merge(
      agentStream as unknown as ReadableStream<
        Parameters<typeof dataStream.write>[0]
      >
    );

    if (titlePromise) {
      const title = await titlePromise;
      dataStream.write({ type: "data-chat-title", data: title });
      updateChatTitleById({ chatId: id, title });
    }
  },
});
```

这段代码最重要的不是某个单一事件，而是 writer 的归属：

- `createUIMessageStream()` 创建整条 UI stream
- `execute({ writer: dataStream })` 暴露一个统一 writer
- `createChatAgent({ dataStream })` 把同一个 writer 继续传给 agent/tool
- `dataStream.merge(agentStream)` 让工具输出和消息输出复用同一条主聊天流
- `data-chat-title` 说明这条流可以同时承载 UI 控制事件和普通聊天消息

所以这层回答的是：

> writer 从哪里来？

答案是：

> 来自 `createUIMessageStream()`，并通过 agent/tool 继续传递。

---

## 2. `createDocument`：新建 Artifact 的开场顺序

新建文档时，最重要的是先把前端面板切到正确的运行时状态。

```ts
const id = generateUUID();

dataStream.write({
  type: "data-kind",
  data: kind,
  transient: true,
});

dataStream.write({
  type: "data-id",
  data: id,
  transient: true,
});

dataStream.write({
  type: "data-title",
  data: title,
  transient: true,
});

dataStream.write({
  type: "data-clear",
  data: null,
  transient: true,
});

await documentHandler.onCreateDocument({
  id,
  title,
  dataStream,
  session,
  modelId,
});

dataStream.write({ type: "data-finish", data: null, transient: true });
```

这段代码按顺序改变了前端的几个关键信号：

- `data-kind`
  告诉前端“这次要打开什么类型的 Artifact”
- `data-id`
  给这次运行时面板一个稳定的 `documentId`
- `data-title`
  填好当前面板标题
- `data-clear`
  在正式灌正文前清空旧内容
- `data-finish`
  把 `streaming` 收尾回 `idle`

最重要的是顺序。

它并不是“先有正文，再告诉前端是什么 Artifact”，而是：

> 先把面板的身份和上下文搭好，再逐步推送正文。

---

## 3. `updateDocument`：已有 Artifact 的全量重写

对已有文档做大改时，writer 逻辑会简单很多。

```ts
dataStream.write({
  type: "data-clear",
  data: null,
  transient: true,
});

await documentHandler.onUpdateDocument({
  document,
  description,
  dataStream,
  session,
  modelId,
});

dataStream.write({ type: "data-finish", data: null, transient: true });
```

这段代码的含义是：

- 不再重新发 `data-id`
- 不再重新发 `data-title`
- 不再重新发 `data-kind`

因为这些信息在当前前端上下文里已经存在。

这里真正要表达的是：

> 我正在重写“当前这个已知 Artifact”的内容，而不是新开一个面板。

---

## 4. `editDocument`：先持久化，再广播替换后内容

精确编辑路径和全量重写路径最大的不同，是它不需要再次让模型逐 token 生成。

```ts
const updated = replace_all
  ? document.content.replaceAll(old_string, new_string)
  : document.content.replace(old_string, new_string);

await saveDocument({
  id: document.id,
  title: document.title,
  kind: document.kind,
  content: updated,
  userId: document.userId,
});

dataStream.write({
  type: "data-clear",
  data: null,
  transient: true,
});

if (document.kind === "code") {
  dataStream.write({
    type: "data-codeDelta",
    data: updated,
    transient: true,
  });
} else if (document.kind === "html") {
  dataStream.write({
    type: "data-htmlDelta",
    data: updated,
    transient: true,
  });
} else if (document.kind === "sheet") {
  dataStream.write({
    type: "data-sheetDelta",
    data: updated,
    transient: true,
  });
} else {
  dataStream.write({
    type: "data-textDelta",
    data: updated,
    transient: true,
  });
}

dataStream.write({ type: "data-finish", data: null, transient: true });
```

这段代码很关键，因为它暴露了当前协议的真实语义：

- 先保存数据库里的新内容
- 再广播给前端
- 广播的 delta 不一定是“增量”

尤其最后一个 `else` 分支最值得注意：

- `editDocument` 在 `text` 场景下发的是完整 `updated`
- 但 `textArtifact` 客户端默认按 append 语义消费 `data-textDelta`

这说明：

> `data-textDelta` 在不同 writer 路径下可能承载不同粒度的数据，读协议时不能只看名字，要结合发送方看具体语义。

---

## 5. `requestSuggestions`：正文主链路之外的 metadata 旁路

`requestSuggestions` 不重写正文，它只追加 suggestions metadata。

```ts
for await (const partialOutput of partialOutputStream) {
  if (!partialOutput) {
    continue;
  }

  for (let i = processedCount; i < partialOutput.length; i++) {
    const element = partialOutput[i];
    if (
      !element?.originalSentence ||
      !element?.suggestedSentence ||
      !element?.description
    ) {
      continue;
    }

    const suggestion = {
      originalText: element.originalSentence,
      suggestedText: element.suggestedSentence,
      description: element.description,
      id: generateUUID(),
      documentId,
      isResolved: false,
    };

    dataStream.write({
      type: "data-suggestion",
      data: suggestion as Suggestion,
      transient: true,
    });
  }
}
```

这段代码带来的状态变化是：

- 不会发 `data-clear`
- 不会发 `data-finish`
- 不会重写 `artifact.content`
- 只会往 text artifact 的 metadata 里追加 suggestions

所以它本质上是一条旁路：

> 同样复用主聊天流，但目标不是正文内容，而是附属 metadata。

---

## 6. 为什么不同 Artifact server handler 写出来的 delta 语义不同

这是最容易让人误解的地方。

### 6.1 `text`：发真正增量

```ts
let draftContent = "";

for await (const delta of fullStream) {
  if (delta.type === "text-delta") {
    draftContent += delta.text;
    dataStream.write({
      type: "data-textDelta",
      data: delta.text,
      transient: true,
    });
  }
}

return draftContent;
```

这里 writer 发出去的是：

- 这次新增的 `delta.text`
- 不是当前完整正文

所以 `text` 的服务端语义是：

> 真正逐段 append 的增量流。

### 6.2 `code` / `html` / `sheet`：发当前完整快照

```ts
let draftContent = "";

for await (const delta of fullStream) {
  if (delta.type === "text-delta") {
    draftContent += delta.text;
    dataStream.write({
      type: "data-codeDelta",
      data: stripFences(draftContent),
      transient: true,
    });
  }
}

return stripFences(draftContent);
```

`html` 和 `sheet` 也是同样模式，只是事件类型不同。

这里 writer 发出去的是：

- “当前为止已经生成好的完整内容快照”
- 不是这次新加的那几个字符

所以这些类型的服务端语义是：

> 每一帧都用当前完整正文覆盖前端。

---

## 7. 事件对照表

这一章把最常见的事件放在一起对照。

| 事件 | 主要发送方 | 作用 |
| --- | --- | --- |
| `data-kind` | `createDocument` | 告诉前端当前要打开哪种 Artifact |
| `data-id` | `createDocument` | 设置当前 `documentId` |
| `data-title` | `createDocument` | 设置当前面板标题 |
| `data-clear` | `createDocument` / `updateDocument` / `editDocument` | 清空当前正文，进入新一轮写入 |
| `data-finish` | `createDocument` / `updateDocument` / `editDocument` | 把当前 Artifact 状态收尾到 `idle` |
| `data-textDelta` | `text` handler / `editDocument(text)` | text 内容更新 |
| `data-codeDelta` | `code` handler / `editDocument(code)` | code 内容更新 |
| `data-htmlDelta` | `html` handler / `editDocument(html)` | html 内容更新 |
| `data-sheetDelta` | `sheet` handler / `editDocument(sheet)` | sheet 内容更新 |
| `data-suggestion` | `requestSuggestions` | 追加 text suggestions metadata |
| `data-chat-title` | `route.ts` | 刷新聊天标题与 sidebar 历史 |

注意：

- “谁发送”比“名字看起来像什么”更重要。
- 同一个事件类型在不同发送路径下，负载粒度可能不完全一样。

---

## 8. 这一章读完要记住什么

- `route.ts` 负责建流和分发 writer，不是所有 `data-*` 的直接发送者。
- `createDocument` 决定了新建 Artifact 的开场控制事件顺序。
- `updateDocument` 和 `editDocument` 都会重写内容，但语义不同。
- `requestSuggestions` 不是正文链路，而是 metadata 旁路。
- `text` handler 发真实增量，`code/html/sheet` handler 发当前完整快照。
