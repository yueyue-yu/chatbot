# `app/(chat)/api/chat/route.ts` 逻辑梳理

本文档专门解释聊天主接口 `app/(chat)/api/chat/route.ts` 的职责、执行流程，以及普通聊天流与工具审批流的差异。

如果你在读源码时对这些问题有疑惑，这份文档就是为它准备的：

- 这个路由到底负责什么？
- `message` 和 `messages` 分别代表什么？
- 为什么有时新增消息，有时更新已有消息？
- 流式输出、工具调用、标题生成、可恢复流是怎么串起来的？

---

## 1. 这个文件负责什么

`route.ts` 是聊天主 API，主要处理两类请求：

- `POST /api/chat`
  发起或继续一次聊天生成
- `DELETE /api/chat?id=...`
  删除一个聊天会话

其中 `POST` 是核心，负责把下面这些能力串起来：

1. 解析请求体
2. 用户鉴权
3. Bot 防护校验
4. 限流与额度校验
5. 加载或创建 chat
6. 组装消息上下文
7. 调用模型并流式返回
8. 支持工具调用
9. 保存消息与标题
10. 在 Redis 可用时注册可恢复流

你可以把它理解成“聊天请求的总编排器”。

---

## 2. 它依赖的几类核心能力

### 2.1 认证与权限

- `auth()`
  获取当前登录用户
- `getChatById()`
  查询 chat，并用于校验是否属于当前用户

### 2.2 限流与额度

- `checkIpRateLimit(ipAddress(request))`
  基于 IP 的快速限流
- `getMessageCountByUserId()`
  查询当前用户最近一段时间的消息量
- `entitlementsByUserType`
  按用户类型决定每小时可发送消息数

### 2.3 模型与 Prompt

- `resolveChatModel()`
  规范化前端传入的模型 id
- `getLanguageModel()`
  拿到底层模型实例
- `getModelCapabilities()`
  判断模型是否支持 `tools` / `reasoning`
- `systemPrompt()`
  拼出系统提示词

### 2.4 工具调用

当前注册的工具包括：

- `createDocument`
- `editDocument`
- `updateDocument`
- `requestSuggestions`

这些工具由模型在生成过程中按需触发。

### 2.5 持久化

- `saveChat()`
  创建 chat
- `saveMessages()`
  插入消息
- `updateMessage()`
  更新已有消息的 `parts`
- `updateChatTitleById()`
  回写 chat 标题
- `createStreamId()`
  保存可恢复流的映射关系

---

## 3. 请求体里的关键字段

`POST` 先通过 `postRequestBodySchema` 校验请求体，核心字段有：

- `id`
  chat id
- `message`
  当前这次新提交的一条消息
- `messages`
  当前 chat 的完整消息列表
- `selectedChatModel`
  前端当前选中的模型
- `selectedVisibilityType`
  新 chat 的可见性

最容易混淆的是 `message` 和 `messages`。

### 3.1 `message` 是什么

`message` 表示“这次用户刚发出的新消息”。

普通聊天时，请求通常只带这一个字段，后端会把它和数据库里的历史消息拼起来，再交给模型。

### 3.2 `messages` 是什么

`messages` 表示“前端当前持有的完整消息列表”。

它主要用于 **工具审批继续执行** 的场景：

1. 模型先生成一个 tool call
2. 前端要求用户批准或拒绝
3. 用户操作后，前端把完整 `messages` 回传给后端
4. 后端基于已有消息继续生成

所以源码里有一句：

- `const isToolApprovalFlow = Boolean(messages);`

它不是在判断“有没有历史消息”，而是在判断：

- **这是不是一次工具审批后的继续执行请求**

---

## 4. POST 主流程总览

按执行顺序，`POST` 可以拆成下面 10 步。

### 第 1 步：解析并校验请求体

先执行：

- `await request.json()`
- `postRequestBodySchema.parse(json)`

如果 JSON 非法或字段不符合 schema，直接返回：

- `new ChatbotError("bad_request:api").toResponse()`

这一步的目标是：后面的逻辑只处理结构正确的数据。

### 第 2 步：校验 bot 防护并获取登录态

这里通过 `Promise.all` 并行做两件事：

1. 在 Vercel 生产环境下执行 `checkBotId()`
2. 执行 `auth()` 获取当前用户

然后立刻检查：

- `if (!session?.user)`

未登录直接返回：

- `unauthorized:chat`

### 第 3 步：规范化模型并进行限流

先执行：

- `resolveChatModel(selectedChatModel)`

然后进行两层限制：

1. `checkIpRateLimit()`
   防止同一 IP 高频请求
2. `getMessageCountByUserId()`
   检查当前用户最近 1 小时消息数量

如果超出 `entitlementsByUserType[userType].maxMessagesPerHour`，返回：

- `rate_limit:chat`

### 第 4 步：判断是不是工具审批流

关键代码：

```ts
const isToolApprovalFlow = Boolean(messages);
```

含义：

- `false`：普通聊天流
- `true`：工具审批继续执行流

这会直接影响后面的：

- 消息上下文如何组装
- 流结束后是插入消息还是更新消息
- `createUIMessageStream` 是否传 `originalMessages`

### 第 5 步：加载或创建 chat

先查：

- `const chat = await getChatById({ id })`

分两种情况：

#### 情况 A：chat 已存在

1. 校验 `chat.userId === session.user.id`
2. 用 `getMessagesByChatId({ id })` 读取历史消息

如果 chat 不属于当前用户，返回：

- `forbidden:chat`

#### 情况 B：chat 不存在，且当前请求是用户首条消息

执行：

- `saveChat()`

先创建一条标题为 `New chat` 的 chat 记录。

然后：

- `titlePromise = generateTitleFromUserMessage({ message })`

这里不会立刻阻塞等待标题，而是先拿到一个 Promise，后面等模型流开始后再把标题写回。

这样做的好处是：

- 创建 chat 更快
- 标题生成不会阻塞主流程

### 第 6 步：组装本次要送给模型的消息上下文

这一段是整个文件最关键的分叉点。

#### 普通聊天流

普通聊天时：

1. 历史消息来自数据库
2. 当前请求中的 `message` 是本次新增用户消息

所以直接：

```ts
uiMessages = [
  ...convertToUIMessages(messagesFromDb),
  message as ChatMessage,
];
```

含义就是：

- 历史消息 + 当前用户新消息

#### 工具审批流

工具审批流时：

1. 数据库里已经有之前的消息
2. 前端传回的 `messages` 里带有最新的工具审批状态
3. 需要把“前端最新状态”合并到“数据库消息”上

这里特别关注两种状态：

- `approval-responded`
- `output-denied`

代码会先从前端 `messages` 中提取这些状态，按 `toolCallId` 建一个 `Map`，然后再遍历数据库消息，把对应 `part` 的状态覆盖成前端最新值。

这样做的原因是：

- **数据库是历史消息的主来源**
- **前端 `messages` 是审批状态的最新来源**

最后得到的 `uiMessages` 才是“当前真正应该送给模型继续推理”的消息列表。

### 第 7 步：提取请求提示信息并保存用户消息

先通过：

- `geolocation(request)`

提取：

- `longitude`
- `latitude`
- `city`
- `country`

这些信息被放进 `requestHints`，再传给 `systemPrompt()`。

它的作用不是业务鉴权，而是给模型更多上下文，例如位置相关问题时更容易给出合理回答。

接着，如果 `message?.role === "user"`，会立即执行 `saveMessages()` 把用户新消息写入数据库。

这么做的目的很重要：

- 即使后续模型生成失败，用户输入本身也已经保存
- 聊天记录不会因为流中断而缺失用户这条消息

### 第 8 步：确定模型能力并转换消息格式

先读取模型能力：

- `const capabilities = getModelCapabilities()`

拆成：

- `isReasoningModel`
- `supportsTools`

它们会影响三件事：

1. `systemPrompt` 如何生成
2. `experimental_activeTools` 是否启用工具
3. `toUIMessageStream({ sendReasoning })` 是否返回推理内容

然后把 UI 消息转换成底层模型消息：

- `convertToModelMessages(uiMessages)`

### 第 9 步：创建并执行流式生成

这里通过 `createUIMessageStream()` 封装整个流式过程。

它主要包含三个部分：

#### 9.1 `originalMessages`

```ts
originalMessages: isToolApprovalFlow ? uiMessages : undefined
```

只有工具审批流才传。

作用是让 SDK 知道“当前不是全新对话，而是基于已有 UI 消息继续”。

#### 9.2 `execute`

`execute` 里真正调用了：

- `streamText()`

传入内容包括：

- 模型实例
- `systemPrompt`
- 全量消息
- 最多 5 个 step 的停止条件
- 当前允许的 tools
- telemetry 配置

其中：

- 如果模型是 reasoning model 但不支持 tools，则 `experimental_activeTools` 置空
- 否则启用当前注册的工具列表

拿到 `result` 后，再执行：

- `result.toUIMessageStream({ sendReasoning: isReasoningModel })`

并通过 `dataStream.merge(...)` 合并到返回给前端的 SSE 流里。

也就是说：

- **底层模型流**
  先生成
- **UI 消息流**
  再包装并输出给前端

#### 9.3 新 chat 的标题回写

如果前面拿到了 `titlePromise`，这里会：

1. `await titlePromise`
2. 用 `dataStream.write()` 把标题推给前端
3. 调用 `updateChatTitleById()` 回写数据库

这意味着新建 chat 时，前端不必等整个对话完成才知道标题。

### 第 10 步：流结束后持久化消息

这部分在 `onFinish` 里执行。

这里又分成两种模式。

#### 普通聊天流：直接新增消息

普通聊天时，本次生成出来的 assistant 消息通常都是全新的，所以直接：

- `saveMessages(finishedMessages.map(...))`

即可。

#### 工具审批流：可能是更新旧消息，也可能是新增新消息

工具审批流复杂一些，因为这次结束时的 `finishedMessages` 里，既可能有：

- 旧消息的 `parts` 被更新

也可能有：

- 新生成的 assistant 消息

所以这里会逐条检查：

```ts
const existingMsg = uiMessages.find((m) => m.id === finishedMsg.id);
```

如果找到了，说明这条消息本来就存在：

- 调 `updateMessage()`

如果没找到，说明它是新的：

- 调 `saveMessages()`

这就是为什么你会看到“同一个 `onFinish` 里既 update 又 save”。

---

## 5. 可恢复流是怎么接进来的

`createUIMessageStreamResponse()` 返回响应时，还传入了：

- `consumeSseStream`

这段逻辑不是聊天主流程本身，而是“增强能力”：

1. 先检查 `process.env.REDIS_URL`
2. 没有 Redis 就直接跳过
3. 有 Redis 时，尝试 `getStreamContext()`
4. 生成 `streamId`
5. 调 `createStreamId({ streamId, chatId: id })`
6. 把当前 SSE 流注册成 resumable stream

这样前端断线后，理论上可以通过 stream id 找回流状态。

注意这里是 **尽力而为** 的增强逻辑：

- 失败不会影响主聊天响应
- 所以异常被吞掉，只做静默降级

---

## 6. POST 的时序图（简化版）

```text
前端发 POST /api/chat
  -> 解析请求体并校验 schema
  -> 校验 bot / 获取 session
  -> 校验登录、IP 限流、用户额度
  -> 查询 chat 与历史消息
  -> 识别普通聊天流 or 工具审批流
  -> 组装 uiMessages
  -> 若有新用户消息，先落库
  -> 转换成 modelMessages
  -> streamText 调模型并持续输出 SSE
  -> 如有标题，生成后写给前端并更新 chat title
  -> onFinish 持久化 assistant / tool 相关消息
  -> 如启用 Redis，则注册可恢复流
```

---

## 7. 为什么普通聊天流和工具审批流要分开

因为两者的“输入”和“持久化方式”不一样。

### 普通聊天流的特点

- 输入是当前这条新用户消息
- 历史上下文主要来自数据库
- 结束时生成的消息通常都是新增消息

所以逻辑偏简单：

- 拼接历史消息
- 保存用户消息
- 保存 assistant 消息

### 工具审批流的特点

- 输入不是一条新问题，而是“对已有 tool call 的批准/拒绝结果”
- 前端 `messages` 里有最新审批状态
- 完成后可能只是更新已有消息的 `parts`

所以逻辑会更复杂：

- 合并数据库消息和前端审批状态
- 继续生成
- 结束时区分 `updateMessage()` 和 `saveMessages()`

---

## 8. DELETE 做了什么

`DELETE` 的逻辑相对简单：

1. 从 query string 读取 `id`
2. 校验 `id` 是否存在
3. 获取当前登录用户
4. 查询 chat
5. 校验 chat 是否属于当前用户
6. 调 `deleteChatById({ id })`
7. 返回删除结果

它的核心原则是：

- 只允许用户删除自己的 chat

---

## 9. 阅读这个文件时的推荐心智模型

理解 `route.ts` 最好的方式，不是从上到下死抠每一行，而是记住下面这条主线：

### 主线 1：这是一个“聊天请求编排器”

它本身不实现模型、不实现数据库、不实现工具，只负责把它们串起来。

### 主线 2：它有两条分支流

- 普通聊天流
- 工具审批继续执行流

理解这两个分支，整份代码会清晰很多。

### 主线 3：它先保用户输入，再跑模型生成

也就是：

- 用户消息优先保存
- assistant/tool 相关结果在流结束后再落库

### 主线 4：增强能力都不阻塞主流程

例如：

- 标题生成是异步回写
- 可恢复流失败会静默降级

所以主流程永远围绕“先把这次对话跑通”展开。

---

## 10. 最容易卡住的几个点

### 10.1 为什么 `messages` 一出现就代表工具审批流？

因为普通聊天只需要当前新消息 `message`。

只有在“基于已有消息继续执行”时，前端才需要把完整 `messages` 传回来，而当前实现里这个场景主要就是工具审批。

### 10.2 为什么工具审批流不是直接用前端传回来的 `messages`？

因为数据库里的历史消息更可靠，前端传回来的完整消息主要是为了补充最新审批状态。

所以当前实现采取的是：

- 数据库消息为主
- 前端审批状态为补丁

### 10.3 为什么 `onFinish` 里要逐条判断消息是否已存在？

因为工具审批流结束后，本次结果不一定全是“新消息”：

- 有些是老消息状态更新
- 有些才是新增消息

所以不能像普通聊天流那样一把全 insert。

### 10.4 为什么 Redis 相关逻辑失败了也没关系？

因为它只负责“断线恢复流”这类增强体验，不是聊天生成本身的必要条件。

---

## 11. 结合源码时建议重点看这些位置

- `app/(chat)/api/chat/route.ts:42`
  `POST` 开始，整体主流程入口
- `app/(chat)/api/chat/route.ts:97`
  用户额度校验
- `app/(chat)/api/chat/route.ts:105`
  `isToolApprovalFlow` 判断
- `app/(chat)/api/chat/route.ts:128`
  普通聊天流 / 工具审批流分叉
- `app/(chat)/api/chat/route.ts:198`
  `createUIMessageStream` 与模型执行
- `app/(chat)/api/chat/route.ts:252`
  `onFinish` 持久化逻辑
- `app/(chat)/api/chat/route.ts:303`
  `DELETE` 删除 chat

---

## 12. 一句话总结

`app/(chat)/api/chat/route.ts` 的本质是：

> 把一次聊天请求从“进入系统”到“拿到模型流式结果并保存状态”的全过程串起来，并根据是普通聊天还是工具审批继续执行，选择不同的消息组装和持久化策略。
