# `resumeStream` / 可恢复流逻辑分析

本文档专门梳理这个项目里“流恢复（resume stream）”相关的实现、调用链、现状、缺口，以及为什么它当前是一个**部分接入、但尚未完全闭环**的能力。

如果你现在正在看这段代码：

```ts
function getStreamContext() {
  try {
    // 为 SSE 响应创建“可恢复流”上下文。
    // 这样在 Redis 可用时，前端断线后仍有机会继续消费同一条流。
    return createResumableStreamContext({ waitUntil: after });
  } catch (_) {
    // 本地开发或当前运行环境不支持时，直接降级为普通流，不阻塞主流程。
    return null;
  }
}
```

那么可以先说结论：

> 你的项目已经接入了“创建 resumable stream”的一半链路，也在前端接入了“尝试 resume”的入口；但**恢复端点本身还没有真正实现**，所以整个 resumeStream 能力目前更像“预埋 + 半成品”，而不是完整可用的断线续流方案。

---

## 1. 先说结论

当前项目的 resume 相关逻辑可以概括为 5 句话：

1. 前端已经拿到了 `useChat()` 暴露的 `resumeStream` 方法。
2. 页面加载时，项目会在特定条件下自动调用 `resumeStream()`。
3. 服务端在 `POST /api/chat` 的 SSE 输出阶段，已经尝试把当前流注册成 `resumable-stream`。
4. 数据库里也有 `Stream` 表来记录 `chatId -> streamId` 的映射。
5. 但默认的恢复入口 `GET /api/chat/[id]/stream` 现在只返回 `204`，**没有真正调用 `resumeExistingStream()`**，所以断线后并不能真正恢复 Redis 里的流。

也就是说：

- **创建 resumable stream：已部分实现**
- **记录 streamId：已实现**
- **前端尝试 resume：已实现**
- **服务端恢复已有 stream：未实现**

---

## 2. 这个项目里和 resumeStream 有关的文件

这套逻辑分散在几个文件里：

```text
hooks/
├── use-active-chat.tsx       # useChat 接入点，拿到 resumeStream
└── use-auto-resume.ts        # 页面加载时自动尝试 resume

app/(chat)/api/chat/
├── route.ts                  # 创建 SSE 流，并注册 resumable stream
└── [id]/stream/route.ts      # 恢复流的 GET 端点（当前只返回 204）

lib/db/
├── schema.ts                 # Stream 表定义
└── queries.ts                # createStreamId / getStreamIdsByChatId
```

建议阅读顺序：

1. `hooks/use-active-chat.tsx`
2. `hooks/use-auto-resume.ts`
3. `app/(chat)/api/chat/route.ts`
4. `app/(chat)/api/chat/[id]/stream/route.ts`
5. `lib/db/schema.ts`
6. `lib/db/queries.ts`

---

## 3. 前端：谁在调用 `resumeStream()`？

## 3.1 `hooks/use-active-chat.tsx`

这里是聊天主状态的入口。

项目使用：

```ts
const {
  messages,
  setMessages,
  sendMessage,
  status,
  stop,
  regenerate,
  resumeStream,
} = useChat<ChatMessage>({ ... })
```

关键点：

- 这里已经从 `useChat()` 中拿到了 `resumeStream`
- 说明项目已经使用了 AI SDK 的“恢复流”能力接口
- 但是它**没有直接开启一个 declarative 的 `resume: true` 配置**，而是走了自己的手动恢复逻辑

随后它把 `resumeStream` 传给了：

```ts
useAutoResume({
  autoResume: !isNewChat && !!chatData,
  initialMessages,
  resumeStream,
  setMessages,
});
```

也就是说：

> 真正决定“页面加载后是否要尝试恢复流”的，不是 `useChat` 配置本身，而是你自定义的 `useAutoResume()` hook。

---

## 3.2 `hooks/use-auto-resume.ts`

这是当前项目里“自动恢复”的核心入口。

### 第一段逻辑：什么时候触发 `resumeStream()`

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

这段逻辑的语义是：

- 只有在“不是新 chat，并且 chatData 已经加载出来”时才考虑自动恢复
- 如果数据库里当前 chat 的最后一条消息是 `user`
- 就认为：这个会话可能存在“用户消息已保存，但 assistant 还没完成”的情况
- 因此调用 `resumeStream()` 尝试恢复

### 这代表什么设计思路？

你项目当前的判断标准其实是一个**启发式规则**：

> 如果最后一条持久化消息还是 user，那么大概率 assistant 的那次生成被中断过，值得尝试 resume。

这个规则不是 AI SDK 强制要求的，而是你项目自己定义的恢复触发条件。

### 这个规则的优点

- 简单
- 不需要额外维护 `activeStreamId` 字段
- 不必在 chat 表里显式标“这个 chat 正在生成中”

### 这个规则的局限

它只能说明“可能需要恢复”，不能说明“**一定有一个可恢复的流存在**”。

因为出现“最后一条是 user”的情况，不止一种：

1. assistant 真的还在生成，且 resumable stream 已经创建成功
2. assistant 生成已经失败，但消息还没落库
3. Redis 不可用，根本没创建 resumable stream
4. 流已结束，但 `assistant` 消息尚未成功保存
5. 用户刷新或关闭页面时，底层请求已经被中断，resumable stream 也未必还能恢复

所以当前前端的 `resumeStream()` 触发条件是：

- **有意义**
- 但只是“尝试恢复”
- 不能保证恢复一定成功

---

## 4. 前端：`resumeStream()` 恢复后，数据怎么回到页面？

`use-auto-resume.ts` 里还有第二段逻辑：

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

这里依赖的是 `components/chat/data-stream-provider` 维护的 `dataStream`。

含义是：

- 如果恢复流成功，SDK 可能会向前端发一个 `data-appendMessage`
- 这个事件携带一条完整消息
- hook 收到后，把它拼回 `initialMessages`

### 为什么这里不是逐 token 拼接？

因为恢复流和普通实时流不完全一样。

普通首次请求时，前端会持续收到完整 UI message stream 的各种片段；而恢复场景下，SDK 可能直接把要补回来的消息以 `appendMessage` 的方式交给客户端。

项目在 `lib/types.ts` 里也显式声明了这个自定义数据类型：

```ts
appendMessage: string;
```

说明这部分是你项目为恢复流预留的数据协议之一。

### 当前实现的一个细节问题

这里取的是：

```ts
const dataPart = dataStream[0];
```

也就是说它只看**第一条** data part，而不是遍历新增的所有 data parts。

这在恢复逻辑里可能会有两个后果：

- 如果恢复时同一批次有多条 `data-appendMessage`，这里只会处理第一条
- 如果第一条不是 `data-appendMessage`，后面即使有，也会被忽略

这并不一定立刻出 bug，但从稳健性上说，这里是一个值得注意的点。

---

## 5. 服务端：在哪里创建 resumable stream？

## 5.1 `app/(chat)/api/chat/route.ts`

恢复流的服务端创建逻辑在聊天主 POST 路由里。

核心入口是：

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

这段代码做了 4 件事：

### 第 1 件：只在 Redis 可用时启用

```ts
if (!process.env.REDIS_URL) {
  return;
}
```

也就是说：

- 没有 Redis，就不会创建 resumable stream
- 这种情况下系统仍然可以正常聊天，只是没有断线恢复能力

这符合“增强能力，不阻塞主流程”的设计。

### 第 2 件：创建 resumable stream 上下文

```ts
const streamContext = getStreamContext();
```

而 `getStreamContext()` 又是：

```ts
function getStreamContext() {
  try {
    return createResumableStreamContext({ waitUntil: after });
  } catch (_) {
    return null;
  }
}
```

这里的设计意图很明确：

- `resumable-stream` 需要运行环境支持相应能力
- `after` 允许响应返回后继续处理流持久化相关工作
- 如果环境不支持，就直接返回 `null` 降级

### 第 3 件：生成并持久化 `streamId`

```ts
const streamId = generateId();
await createStreamId({ streamId, chatId: id });
```

这一步把“本次流对应哪个 chat”记到了数据库里。

### 第 4 件：把 SSE 包装成可恢复流

```ts
await streamContext.createNewResumableStream(streamId, () => sseStream);
```

这一步才是真正把当前 SSE 输出接入到 `resumable-stream`。

也就是说：

> 从项目结构上看，当前聊天主 POST 已经具备“把当前响应注册到 resumable-stream”的能力。

---

## 6. `getStreamContext()` 这段代码到底在做什么？

你问到的这段代码，本质上是在做“**运行时能力探测 + 容错降级**”。

```ts
function getStreamContext() {
  try {
    return createResumableStreamContext({ waitUntil: after });
  } catch (_) {
    return null;
  }
}
```

可以拆成三层理解。

### 6.1 它不是在创建聊天流本身

聊天流本身是 `createUIMessageStreamResponse()` 返回给浏览器的 SSE。

`getStreamContext()` 不是创建这个原始流，而是创建一个：

- 针对 `resumable-stream` 的上下文对象
- 用来把已经存在的 SSE 流“注册成可恢复流”

所以它服务的是“流恢复机制”，不是普通聊天生成本身。

### 6.2 `after` 的作用

`after` 来自 `next/server`。

它的意义是：

- 即使 HTTP 响应已经开始或返回
- 仍然允许后续工作继续执行

对于 resumable stream 来说，这很关键，因为：

- 前端消费 SSE 是一个实时过程
- 后端还需要把这些流数据同步到 Redis
- 如果没有类似 `after` 的机制，响应发出后很多运行时会直接终止后续工作

### 6.3 为什么要 try/catch

因为这类能力依赖运行环境。

可能失败的场景包括：

- 本地开发运行时不支持
- 非预期部署环境不支持
- `resumable-stream` 上下文初始化失败
- 某些 edge/node runtime 组合不兼容

所以作者这里选择：

- 能创建就创建
- 失败就返回 `null`
- 不影响主聊天流程

这是一种典型的“best effort enhancement（尽力增强）”设计。

---

## 7. 数据层：项目如何记录 stream？

## 7.1 `lib/db/schema.ts`

项目定义了一个 `Stream` 表：

```ts
export const stream = pgTable(
  "Stream",
  {
    id: uuid("id").notNull().defaultRandom(),
    chatId: uuid("chatId").notNull(),
    createdAt: timestamp("createdAt").notNull(),
  },
  ...
)
```

这说明当前数据模型里：

- 一个 stream 有自己的 `id`
- 它属于某个 `chatId`
- 会记录创建时间 `createdAt`

这是一个**附属映射表**，不是把 active stream 直接挂在 `Chat` 表上。

---

## 7.2 `lib/db/queries.ts`

目前和 resume 直接相关的查询有两个：

### `createStreamId`

```ts
export async function createStreamId({ streamId, chatId }) {
  await db.insert(stream).values({ id: streamId, chatId, createdAt: new Date() });
}
```

作用：

- 在创建新 resumable stream 时落一条记录

### `getStreamIdsByChatId`

```ts
export async function getStreamIdsByChatId({ chatId }) {
  const streamIds = await db
    .select({ id: stream.id })
    .from(stream)
    .where(eq(stream.chatId, chatId))
    .orderBy(asc(stream.createdAt))
    .execute();

  return streamIds.map(({ id }) => id);
}
```

作用：

- 按 chatId 查出所有 streamId
- 按创建时间升序返回

### 关键观察

这个查询函数目前**没有被项目实际使用**。

这点很关键，因为它说明：

> 项目虽然已经有了“查 chat 下有哪些 streamId”的数据访问层，但恢复端点并没有用它把这些 stream 真正接回来。

也就是说，数据库层已经为“恢复”准备了一部分能力，但还没有接入主链路。

---

## 8. 真正的恢复端点现在是什么状态？

## 8.1 `app/(chat)/api/chat/[id]/stream/route.ts`

当前文件内容是：

```ts
export function GET() {
  return new Response(null, { status: 204 });
}
```

这意味着：

- 当前恢复路由永远返回 `204 No Content`
- 不会去数据库查 streamId
- 不会去 Redis 调 `resumeExistingStream()`
- 不会返回 `UI_MESSAGE_STREAM_HEADERS`
- 不会把原来的生成流接回前端

### 这意味着什么？

当前前端即使调用了：

```ts
resumeStream()
```

它最终命中的默认恢复端点很可能就是：

```text
GET /api/chat/[id]/stream
```

但这个端点现在固定返回 204，所以实际上是：

- 前端“尝试恢复”了
- 服务端“礼貌地说没有内容”
- 但并没有真正恢复任何流

这就是为什么我前面说：

> 当前的 resume 逻辑是“半接入”，不是完整闭环。

---

## 9. 当前项目的 resume 逻辑，完整时序是什么？

如果按照当前代码的实际行为，时序更接近下面这样：

```text
用户发送消息
  -> POST /api/chat
  -> 服务端开始 streamText + SSE
  -> 如果 REDIS_URL 存在：尝试 createNewResumableStream(streamId)
  -> 同时把 streamId 写入 Stream 表
  -> 前端收到流并展示

用户刷新页面 / 重新进入 chat
  -> useAutoResume 发现最后一条消息是 user
  -> 调用 resumeStream()
  -> useChat 默认请求 GET /api/chat/[id]/stream
  -> 当前 route.ts 直接返回 204
  -> 恢复结束，无内容返回
```

所以“链路上发生了什么”和“真正是否恢复成功”要分开看：

- **尝试恢复这个动作：有**
- **恢复成功这个结果：当前没有**

---

## 10. 和 AI SDK 官方推荐方案相比，项目差在哪里？

官方推荐闭环大致是：

1. POST 创建新流
2. `consumeSseStream` 中创建 resumable stream
3. 持久化 activeStreamId
4. GET `/api/chat/[id]/stream` 读取 activeStreamId
5. `resumeExistingStream(activeStreamId)`
6. 流结束后清除 activeStreamId

你的项目目前实现到：

1. POST 创建新流 ✅
2. `consumeSseStream` 中创建 resumable stream ✅
3. 持久化 streamId ✅
4. GET 恢复端点读取 streamId ❌
5. `resumeExistingStream()` ❌
6. 流结束后清理 active 状态 ❌

也就是说，当前缺的不是一个小 patch，而是**恢复半边链路**。

---

## 11. 当前设计里几个很重要的特点

## 11.1 你没有存“active stream”，而是存了“历史 stream 记录”

这和官方示例不同。

官方示例通常是：

- `Chat.activeStreamId`

而你现在是：

- 单独一张 `Stream` 表
- 一个 chat 可以对应多条 stream 记录

这会带来两个结果：

### 好处

- 可以保留历史 stream 轨迹
- 后续更容易做审计、排查、诊断
- 不会污染 `Chat` 主表结构

### 问题

恢复时必须回答一个关键问题：

> “到底应该恢复哪一条 stream？”

如果只是简单取最新一条，也未必总是对的，因为：

- 最新的一条可能已经结束
- 最新的一条可能创建成功但 Redis 已过期
- 同一个 chat 可能快速连续发过多次请求

而当前项目还没有实现这部分判定逻辑。

---

## 11.2 你用“最后一条消息是否是 user”作为恢复触发条件

这是一种业务层启发式，不是底层流状态真相。

它只能说明：

- assistant 结果可能还没完整落库

但不能说明：

- Redis 一定还持有可恢复流
- 该流一定没有完成
- 恢复端点一定能接回去

所以它更适合当“尝试恢复”的信号，而不是“恢复是否可行”的最终判断依据。

---

## 11.3 可恢复流失败不会影响主流程

这点在代码里贯彻得很一致：

- `getStreamContext()` 失败返回 `null`
- `consumeSseStream()` 外层 try/catch 吞错误
- 没有 Redis 时直接 return

这意味着架构上它被定义为：

> enhancement，而不是 critical path。

这是合理的，但也意味着如果你真的想依赖断线恢复作为正式能力，现在还需要把这块补完整。

---

## 12. 当前实现里存在的主要问题

这里我按“从高到低”的影响程度来列。

## 12.1 最大问题：恢复 GET 端点未实现

这是当前最大缺口。

因为没有 `resumeExistingStream()`，所以：

- `resumeStream()` 几乎不会产生真正恢复效果
- 现在的自动恢复更多只是“发起一次空恢复请求”

---

## 12.2 没有 active / finished 状态管理

当前只记录：

- `chatId`
- `streamId`
- `createdAt`

没有记录：

- 是否仍在进行中
- 是否已完成
- 是否已失效

这会导致恢复时无法可靠判断：

- 哪一条是当前活跃流
- 哪些已经不该再尝试恢复

---

## 12.3 `getStreamIdsByChatId()` 已有，但未接入

这说明你已经意识到恢复端点需要“按 chat 查 streamId”，但主链路还没补完。

这是一个非常明显的“已设计但未落地”的信号。

---

## 12.4 前端 `data-appendMessage` 处理只看第一条 data part

```ts
const dataPart = dataStream[0];
```

这会让恢复逻辑对批量事件不够稳健。

更保险的做法通常是：

- 遍历新增 data parts
- 找出所有 `data-appendMessage`
- 顺序合并

---

## 12.5 `stop()` 与 resume 机制存在天然冲突风险

AI SDK 官方文档明确提醒：

- abort/stop 和 resumable stream 机制并不兼容
- 刷新页面、关闭页面也可能触发 abort

而你的项目在 UI 中是有 `stop` 能力的。

这意味着：

- 即使未来补上恢复端点
- 也仍然要明确“stop 后不应该再 resume”或者“resume 只用于非主动中断场景”

否则用户会遇到预期不一致的问题。

---

## 12.6 恢复端点未来需要补权限校验

当前 `GET /api/chat/[id]/stream` 只是 204，因此暂时没有安全问题。

但一旦你实现真实恢复逻辑，必须做：

- 登录校验
- chat 所属权校验
- 只允许恢复当前用户自己的 chat 流

否则就可能造成越权订阅别人的实时生成内容。

---

## 13. 现在这套逻辑的真实状态评估

如果从“工程成熟度”来评估，我会这样判断：

### 已完成

- 前端接入 `resumeStream()` 方法
- 自动恢复触发 hook
- 服务端 `consumeSseStream` 接入 `resumable-stream`
- 数据库存储 `streamId`
- 删除 chat 时会清理 `Stream` 表记录

### 未完成

- 恢复端点真正接回 Redis 中的流
- 恢复时选择正确 streamId
- active stream 生命周期管理
- finish 后清理 active 状态
- 失败流 / 过期流处理
- 安全校验

### 因此当前可下的结论

> 这套 resume 方案目前更像“架构预埋 + 局部实现”，说明你已经把可恢复流纳入系统设计，但还没有把它做成真正可工作的产品能力。

---

## 14. 如果要把它补完整，建议怎么设计

下面是最符合你当前项目结构的补齐方案。

## 14.1 方案 A：沿用当前 `Stream` 表设计

如果你想保留“一个 chat 对应多条 stream 历史”的设计，可以这样做：

### 数据层
给 `Stream` 表增加状态字段，例如：

- `status: active | finished | failed | expired`
- 或者简单一点：`isActive: boolean`

### POST `/api/chat`
创建新流时：

1. 将同 chat 旧 active stream 置为 inactive
2. 插入新 stream 记录，标记 active
3. 调 `createNewResumableStream`
4. 在 `onFinish` 中把当前 stream 标为 finished/inactive

### GET `/api/chat/[id]/stream`
1. 校验用户身份和 chat 归属
2. 查当前 chat 的 active stream
3. 没有 active stream → 返回 204
4. 有 active stream → `resumeExistingStream(streamId)`
5. 返回带 `UI_MESSAGE_STREAM_HEADERS` 的 response

这是最贴合你现有结构的方案。

---

## 14.2 方案 B：简化成 `Chat.activeStreamId`

如果你不需要保留完整 stream 历史，可以更简单：

- 直接在 `Chat` 表上挂一个 `activeStreamId`
- 新流开始时写入
- finish 时清空
- GET 端点直接拿它恢复

这种实现更简单，也更符合官方示例，但会失去 stream 历史记录能力。

---

## 15. 一张图看懂你项目当前的 resume 现状

```text
[前端 useChat]
   │
   ├─ sendMessage()
   │    └─ POST /api/chat
   │          ├─ streamText() 生成 SSE
   │          ├─ consumeSseStream()
   │          ├─ createStreamId(chatId, streamId)
   │          └─ createNewResumableStream(streamId, sseStream)
   │
   └─ 页面重载后 useAutoResume()
        ├─ 若最后一条消息是 user
        └─ 调 resumeStream()
              └─ GET /api/chat/[id]/stream
                    └─ 当前固定返回 204
```

一句话总结这张图：

> “创建端”已有，“恢复端”缺失。

---

## 16. 你这段 `getStreamContext()` 代码在项目里的准确定位

最后回到你给出的函数本身。

它在项目里的定位可以精确描述为：

> `getStreamContext()` 是聊天主接口里用于初始化 `resumable-stream` 运行时上下文的容错包装器；它只服务于“把当前 SSE 注册成可恢复流”这件事，不负责恢复已有流，也不决定前端是否真正能 resume 成功。

也就是说它负责的是：

- 可恢复流创建侧的上下文初始化

而不负责：

- 选择哪个 stream 恢复
- 恢复端点返回什么
- 前端是否成功拿回未完成消息

---

## 17. 最终结论

如果要非常直接地评价你项目当前的 `resumeStream` 逻辑：

### 现在已经有的

- 前端自动尝试恢复
- 服务端创建 resumable stream
- 数据库存 stream 记录

### 现在缺失的

- 真正的恢复 API 实现
- 活跃流状态管理
- 流完成后的清理
- 恢复安全校验

### 所以当前真实状态是

> 你的项目已经完成了 resumable stream 的“创建侧接入”和“客户端尝试恢复入口”，但还没有完成“恢复侧闭环”；因此现在的 `resumeStream` 更像一个预埋能力，而不是已经完全工作的断线续流功能。

---

## 18. 相关阅读

建议和这份文档一起看：

- `hooks/use-active-chat.tsx`
- `hooks/use-auto-resume.ts`
- `app/(chat)/api/chat/route.ts`
- `app/(chat)/api/chat/[id]/stream/route.ts`
- `lib/db/schema.ts`
- `lib/db/queries.ts`
- `docs/chat-route.md`

如果你愿意，下一步我可以继续帮你两件事：

1. **把这套 resume 流闭环真正补齐**，直接实现 `GET /api/chat/[id]/stream`
2. **继续写第二篇文档**，给你画出“正常流 / 重载恢复流 / stop 中断流”三条时序图
