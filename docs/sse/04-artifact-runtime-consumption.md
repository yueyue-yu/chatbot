# 04. Artifact 运行时状态如何消费流事件

这一章回答的是：

> `DataStreamProvider` 里已经有一批 `data-*` 事件了，它们最终是怎么变成右侧面板内容、标题、状态和 metadata 的？

结论先说：

> `DataStreamHandler` 是 data part 到 UI 状态的桥接层；`useArtifact` 是最终的轻量 store；各个 Artifact 客户端实现则负责解释自己专属的 delta 语义，例如 `text` append、`code/html/sheet` replace。

---

## 1. `useArtifact` 存的到底是什么

先看 `useArtifact` 提供的状态结构。

```ts
export const initialArtifactData: UIArtifact = {
  documentId: "init",
  content: "",
  kind: "text",
  title: "",
  status: "idle",
  isVisible: false,
  boundingBox: {
    top: 0,
    left: 0,
    width: 0,
    height: 0,
  },
};

export function useArtifact() {
  const { data: localArtifact, mutate: setLocalArtifact } = useSWR<UIArtifact>(
    "artifact",
    null,
    {
      fallbackData: initialArtifactData,
    }
  );

  const { data: localArtifactMetadata, mutate: setLocalArtifactMetadata } =
    useSWR<any>(
      () =>
        artifact.documentId ? `artifact-metadata-${artifact.documentId}` : null,
      null,
      {
        fallbackData: null,
      }
    );
}
```

这里的关键不是 SWR 语法本身，而是它表达的状态边界：

- `artifact`
  存当前右侧面板的主运行时状态
- `metadata`
  存当前文档对应的附属信息

它们故意分成两层：

- `artifact`
  关心 `documentId` / `kind` / `content` / `status`
- `metadata`
  关心 suggestions、console outputs、HTML view 之类的附属状态

所以：

> `useArtifact` 不是数据库 Document 读取器，而是当前 Artifact 面板的运行时真相来源。

---

## 2. `DataStreamHandler` 先复制，再清空，再解释

桥接层的第一件事不是更新 UI，而是先处理队列。

```ts
useEffect(() => {
  if (!dataStream?.length) {
    return;
  }

  const newDeltas = dataStream.slice();
  setDataStream([]);

  for (const delta of newDeltas) {
    if (delta.type === "data-chat-title") {
      mutate(unstable_serialize(getChatHistoryPaginationKey));
      continue;
    }

    const artifactDefinition = artifactDefinitions.find(
      (currentArtifactDefinition) =>
        currentArtifactDefinition.kind === artifact.kind
    );

    if (artifactDefinition?.onStreamPart) {
      artifactDefinition.onStreamPart({
        streamPart: delta,
        setArtifact,
        setMetadata,
      });
    }
  }
}, [dataStream, setArtifact, setMetadata, artifact, setDataStream, mutate]);
```

这段代码带来的状态语义是：

- `dataStream.slice()`
  复制当前批次，防止边迭代边修改原数组
- `setDataStream([])`
  立刻清空队列，避免同一批 delta 被重复消费
- `data-chat-title`
  直接走 sidebar 刷新逻辑
- `artifactDefinition?.onStreamPart(...)`
  先给当前 Artifact 类型一个处理自己专属 delta 的机会

也就是说，队列本身不是历史记录，而是：

> 一批待消费事件，一旦开始处理就立即出队。

---

## 3. 通用控制事件由 `setArtifact` 统一处理

类型专属 delta 处理完以后，通用控制事件会统一进入 `setArtifact`。

```ts
setArtifact((draftArtifact) => {
  if (!draftArtifact) {
    return { ...initialArtifactData, status: "streaming" };
  }

  switch (delta.type) {
    case "data-id":
      return {
        ...draftArtifact,
        documentId: delta.data,
        status: "streaming",
      };

    case "data-title":
      return {
        ...draftArtifact,
        title: delta.data,
        status: "streaming",
      };

    case "data-kind":
      return {
        ...draftArtifact,
        kind: delta.data,
        status: "streaming",
      };

    case "data-clear":
      return {
        ...draftArtifact,
        content: "",
        status: "streaming",
      };

    case "data-finish":
      return {
        ...draftArtifact,
        status: "idle",
      };

    default:
      return draftArtifact;
  }
});
```

这段 switch 改写的是所有 Artifact 共用的主状态：

- `data-id`
  切换当前文档身份
- `data-title`
  切换当前标题
- `data-kind`
  切换当前 Artifact 类型
- `data-clear`
  清正文
- `data-finish`
  结束 streaming

所以这层处理的不是“正文怎么写进去”，而是：

> 面板主状态机怎么在不同阶段切换。

---

## 4. `textArtifact`：真正的 append 语义

`text` 客户端最能体现“增量流”的语义。

```ts
onStreamPart: ({ streamPart, setMetadata, setArtifact }) => {
  if (streamPart.type === "data-suggestion") {
    setMetadata((metadata) => {
      return {
        suggestions: [...metadata.suggestions, streamPart.data],
      };
    });
  }

  if (streamPart.type === "data-textDelta") {
    setArtifact((draftArtifact) => {
      return {
        ...draftArtifact,
        content: draftArtifact.content + streamPart.data,
        isVisible:
          draftArtifact.status === "streaming" &&
          draftArtifact.content.length > 400 &&
          draftArtifact.content.length < 450
            ? true
            : draftArtifact.isVisible,
        status: "streaming",
      };
    });
  }
},
```

这一段最关键的两点是：

- `data-suggestion`
  进入 `metadata.suggestions`
- `data-textDelta`
  进入 `draftArtifact.content + streamPart.data`

也就是说，`text` 客户端默认假设：

> 服务端发来的 `data-textDelta` 是“本次新增的那一小段文本”。

这是最标准的 append 语义。

---

## 5. `code` / `html` / `sheet`：完整快照覆盖语义

和 `text` 相比，其他类型的客户端实现都更接近 replace。

### 5.1 `code`

```ts
onStreamPart: ({ streamPart, setArtifact }) => {
  if (streamPart.type === "data-codeDelta") {
    setArtifact((draftArtifact) => ({
      ...draftArtifact,
      content: streamPart.data,
      isVisible:
        draftArtifact.status === "streaming" &&
        draftArtifact.content.length > 300 &&
        draftArtifact.content.length < 310
          ? true
          : draftArtifact.isVisible,
      status: "streaming",
    }));
  }
},
```

### 5.2 `html`

```ts
onStreamPart: ({ setArtifact, setMetadata, streamPart }) => {
  if (streamPart.type === "data-htmlDelta") {
    setMetadata((currentMetadata: Metadata | null) => {
      if (currentMetadata?.view === "source") {
        return currentMetadata;
      }

      return {
        ...(currentMetadata ?? {}),
        view: "source",
      };
    });

    setArtifact((draftArtifact) => ({
      ...draftArtifact,
      content: streamPart.data,
      isVisible:
        draftArtifact.status === "streaming" &&
        draftArtifact.content.length > 200 &&
        draftArtifact.content.length < 260
          ? true
          : draftArtifact.isVisible,
      status: "streaming",
    }));
  }
},
```

### 5.3 `sheet`

```ts
onStreamPart: ({ setArtifact, streamPart }) => {
  if (streamPart.type === "data-sheetDelta") {
    setArtifact((draftArtifact) => ({
      ...draftArtifact,
      content: streamPart.data,
      isVisible: true,
      status: "streaming",
    }));
  }
},
```

这三种实现的共同点是：

- 都直接用 `streamPart.data` 覆盖 `content`
- 都不做 `draftArtifact.content + ...`
- `html` 还额外同步改 metadata，把视图切回 `source`

所以这些类型的客户端默认假设：

> 服务端发来的不是“增量字符”，而是“当前完整正文快照”。

---

## 6. `metadata` 和 `artifact` 为什么必须分开

从实际消费看，`metadata` 和 `artifact` 的职责差异非常明显。

### `artifact` 负责：

- 当前正文
- 当前标题
- 当前类型
- 当前 `documentId`
- 当前 `streaming / idle`

### `metadata` 负责：

- text suggestions
- code console outputs
- html 当前视图

如果把这两者混在一个对象里，会有几个问题：

- 文档切换时附属状态容易串
- 每种 Artifact 类型都会把主状态对象塞得越来越重
- 读取某个局部附属状态时很难保持边界

所以这里按 `documentId` 给 metadata 单独命名空间，是非常关键的设计。

---

## 7. 当前实现里最值得记住的 tricky 点

这里有一个非常值得记住的现实：

- `text` client 明确按 append 处理 `data-textDelta`
- 但 `editDocument` 在 `text` 场景下发的却是完整 `updated` 字符串

这说明当前实现里：

- 事件名不总能完整表达负载粒度
- 读协议时必须同时看发送方和消费方

这也是为什么这套 SSE 文档不能只做字段表，而必须贴着真实实现讲。

---

## 8. 这一章读完要记住什么

- `useArtifact` 是最终 UI 真相来源，`artifact` 和 `metadata` 是两层状态。
- `DataStreamHandler` 负责把当前批次 data parts 翻译成 UI 状态。
- 通用控制事件由 `setArtifact` 统一处理。
- `text` 默认按 append 语义消费 `data-textDelta`。
- `code/html/sheet` 默认按 replace/snapshot 语义消费各自 delta。
