# 05. 可恢复流与几个关键边界

这一章回答两个问题：

1. 这个项目里的可恢复流到底接到了什么程度？
2. SSE / UI message stream / data parts / Artifact 状态之间的边界到底怎么分？

结论先说：

> 当前项目已经接入了“创建 resumable stream”和“前端尝试 resume”的入口，但恢复端点还没有真正接回已有 stream，所以这仍然是一条未闭环的高级分支。与此同时，主链路里最需要守住的边界是：消息流不等于 data parts，data parts 不等于 Artifact store，`useActiveChat` 不等于 `DataStreamHandler`。

---

## 1. 服务端：POST 路由已经尝试注册 resumable stream

先看 POST 路由的收尾。

```ts
return createUIMessageStreamResponse({
  stream,
  async consumeSseStream({ stream: sseStream }) {
    if (!process.env.REDIS_URL) {
      return;
    }
    try {
      const streamContext = getStreamContext();
      if (streamContext) {
        const streamId = generateId();
        await createStreamId({ streamId, chatId: id });
        await streamContext.createNewResumableStream(
          streamId,
          () => sseStream
        );
      }
    } catch (_) {
      // 可恢复流是增强能力，失败不影响主聊天流程。
    }
  },
});
```

这段代码说明：

- 主聊天流本身始终会返回
- 只有在 `REDIS_URL` 存在时，才尝试注册 resumable stream
- 当前 chat 会被绑定一个新的 `streamId`
- 注册失败不会中断普通聊天主流程

所以这不是“聊天必须依赖的底层能力”，而是：

> 一个挂在主 SSE 流之上的增强能力。

---

## 2. 但恢复端点还没有真正实现

如果只看前端调用点，很容易误以为恢复能力已经完整可用。

但恢复端点现在是这样的：

```ts
export function GET() {
  return new Response(null, { status: 204 });
}
```

这意味着：

- 它没有根据 `chatId` 查 `streamId`
- 没有调用 `resumeExistingStream()`
- 没有把 Redis 里的流重新接出来

所以当前真实状态是：

- “创建 resumable stream”这半边：已接入
- “真正恢复已有 stream”这半边：未接入

也正因为如此，这一章只把它当作高级分支解释，而不是当成主 happy path 的一部分。

---

## 3. 前端：`useAutoResume` 已经会尝试 `resumeStream()`

前端恢复入口在 `use-auto-resume.ts`。

```ts
useEffect(() => {
  if (!autoResume) {
    return;
  }

  const mostRecentMessage = initialMessages.at(-1);

  if (mostRecentMessage?.role === "user") {
    resumeStream();
  }
}, [autoResume, initialMessages.at, resumeStream]);
```

这段逻辑代表的是一种启发式判断：

- 当前不是新 chat
- 并且服务端历史已经拿到
- 如果最后一条持久化消息还是 `user`
- 就猜测 assistant 上次可能没跑完，尝试 `resumeStream()`

这不是强一致状态机，而是业务层启发式。

它的含义不是：

- “一定存在一个可以恢复的流”

而是：

- “当前值得试一把恢复”

---

## 4. `data-appendMessage`：为恢复流预留的补消息协议

`useAutoResume` 里还有另一段逻辑：

```ts
useEffect(() => {
  if (!dataStream) {
    return;
  }
  if (dataStream.length === 0) {
    return;
  }

  const dataPart = dataStream[0];

  if (dataPart.type === "data-appendMessage") {
    const message = JSON.parse(dataPart.data);
    setMessages([...initialMessages, message]);
  }
}, [dataStream, initialMessages, setMessages]);
```

这段代码说明了两件事：

- 项目已经为恢复场景预留了 `data-appendMessage`
- 恢复流回来时，前端可能不是逐 token 重放，而是直接追加完整 message

配合 `lib/types.ts`：

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

可以看出：

- 这条协议已经被类型系统承认
- 但在当前仓库源码里，并没有我们自己显式写出 `data-appendMessage` 的发送方

因此更准确的表述是：

> 这是一条为恢复流预留的客户端接收协议，而不是当前主 happy path 上必走的 writer 分支。

---

## 5. 几组最容易混淆的边界

下面这张表是这套实现里最值得反复看的“边界对照表”。

| 概念 | 当前项目里的真实含义 | 不要把它误认为 |
| --- | --- | --- |
| SSE 流 | 浏览器与 `/api/chat` 之间的流式响应通道 | 前端最终业务状态 |
| UI message stream | AI SDK 封装后的复合流，里面既有 messages 也有 data parts | 只有 assistant 文本 token |
| data parts | 驱动 Artifact / sidebar / metadata 的旁路控制事件 | 聊天正文消息 |
| `messages` | 聊天时间线 | Artifact 面板状态 |
| `DataStreamProvider` | 当前批次待解释事件队列 | Artifact store |
| `useActiveChat` | 当前会话 orchestration | `data-*` 事件解释器 |
| `DataStreamHandler` | data part -> UI 状态桥接层 | 消息主流消费者 |
| `useArtifact` | 当前 Artifact 面板轻量 store | 数据库 Document 真相 |

如果这几组边界记不住，读代码时就很容易出现这些错觉：

- “`useChat` 已经收到 `data-textDelta` 了，为什么 UI 还没变？”
- “`dataStream` 里已经有事件了，为什么这不算最终状态？”
- “既然叫 `textDelta`，为什么某些路径下看起来像完整文本？”

这些问题的答案都藏在边界里。

---

## 6. 为什么这章放在最后

恢复流和边界问题都很重要，但它们不是读主链路的最佳入口。

如果一开始就先研究：

- Redis 开关
- `streamId`
- `GET /api/chat/[id]/stream`
- `resumeStream()`

很容易还没搞懂 happy path，就先陷进半成品分支里。

所以更好的顺序是：

1. 先搞懂普通 `/api/chat` -> Artifact 面板的完整主链路
2. 再回来看“如果这条流断了，系统原本想怎么恢复”
3. 最后用边界表把整套心智模型收紧

---

## 7. 这一章读完要记住什么

- 当前项目的恢复流能力仍然没有闭环，恢复端点还没真正接回已有 stream。
- `resumeStream()` 在前端已经有入口，但成功与否取决于后端恢复链路是否完整。
- `data-appendMessage` 是恢复分支的接收协议，不是当前主 happy path 的常规 writer。
- 读这套实现时，一定要把“消息流”“data parts”“事件队列”“Artifact store”分开看。
