# `/agent` 模块梳理

本文档用于分析项目中的 `/agent` 相关代码，说明它的目标、主要文件、请求链路、UI 结构、工具调用方式，以及和主聊天模块的区别。

如果你现在想回答这些问题，这份文档就是给你准备的：

- `/agent` 页面到底是做什么的？
- 它和主聊天 `app/(chat)` 有什么区别？
- `lib/agent/` 里的每个文件分别负责什么？
- Agent 为什么只能操作 document 工具？
- 它怎么把工具结果显示成右侧 artifact 面板？
- 现在这套 agent 实现有哪些特点和限制？

---

## 1. `/agent` 是什么

你项目里的 `/agent` 不是主聊天页的简单别名，而是一个**独立的 agent demo 页面**。

它的定位可以概括为：

> 基于 AI SDK 的 `ToolLoopAgent`，围绕“文档类 Artifact 的创建、编辑、重写”做的一个演示型 Agent 界面。

当前它主要支持三类工具：

- `createDocument`
- `editDocument`
- `updateDocument`

也就是说，这个 agent 不是一个“通用自治代理”，而是一个：

- 面向文档/代码/表格 artifact 的工具代理
- 有自己独立页面和接口
- 能在对话中调用工具
- 能把工具返回的 artifact 打开到右侧面板中继续查看和编辑

---

## 2. 相关目录与文件

```text
app/
├── agent/page.tsx              # /agent 页面入口
└── api/agent/
    ├── route.ts                # Agent 后端接口
    └── schema.ts               # Agent 请求体校验

components/agent/
├── agent-artifact-panel.tsx    # Agent 右侧 artifact 面板
├── agent-demo.tsx              # Agent 主界面
├── agent-model-selector.tsx    # Agent 模型选择器
└── agent-session-label.tsx     # 顶部登录态标记

lib/agent/
├── agent.ts                    # ToolLoopAgent 构造入口
├── prompts.ts                  # Agent system instructions
├── sanitize-ui-messages.ts     # 发送给 Agent 前的消息清洗
├── tools/
│   └── plan-task.ts            # 一个未接入主链路的计划工具
└── types.ts                    # Agent 消息和工具类型定义
```

---

## 3. `/agent` 的整体目标

这个模块要解决的不是“普通问答”，而是：

- 根据用户描述，判断是否应该创建一个新 artifact
- 如果是修改已有 artifact，判断应该走：
  - 精确编辑 `editDocument`
  - 还是全文重写 `updateDocument`
- 工具执行后，把结果在对话区展示出来
- 同时自动打开右侧 Artifact 面板
- 让用户继续查看与编辑当前 artifact

你可以把它理解成：

> 一个“面向文档工具的聊天式工作台”。

它的核心体验不是长篇自然语言对话，而是：

1. 用户描述任务
2. Agent 选择是否调用工具
3. 工具执行后给出简短确认
4. 右侧打开对应 artifact
5. 用户继续迭代

---

## 4. 页面入口：`app/agent/page.tsx`

这个文件很薄，作用是：

- 提供 `/agent` 页面壳子
- 渲染返回主聊天页按钮
- 显示登录用户信息
- 挂载 `AgentDemo`

结构上它做了三件事：

### 4.1 页面布局

整页是一个全屏高度容器：

- `h-dvh`
- 背景做了径向渐变和浅色/深色适配
- 中间放一个最大宽度为 `max-w-6xl` 的主体区域

### 4.2 顶部导航

顶部左边：

- `Back to Chat`

顶部右边：

- `AgentSessionLabel`
  - 用于显示 `Signed in as xxx`

### 4.3 主内容

主内容只有一个：

- `AgentDemo`

因此 `page.tsx` 本身不承载业务逻辑，主要负责页面外壳与入口装配。

---

## 5. 后端接口：`app/api/agent/route.ts`

这是 `/agent` 模块最核心的服务端入口。

它的职责可以概括为：

1. 解析请求
2. 校验登录权限
3. 校验模型是否支持 tools
4. 构造 `ToolLoopAgent`
5. 把 UI messages 交给 agent 执行
6. 返回 agent 的 UI stream response

---

## 5.1 请求体校验：`app/api/agent/schema.ts`

请求 schema 非常简单：

```ts
export const postRequestBodySchema = z.object({
  messages: z.array(z.unknown()),
  selectedModel: z.string().trim().optional().default(""),
});
```

含义：

- `messages`
  前端当前对话消息数组
- `selectedModel`
  当前选中的模型 id，可为空

这里没有像主聊天那样带：

- `chatId`
- `visibility`
- `message` / `messages` 的双形态
- 文件附件
- 工具审批状态

说明 `/agent` 的接口设计更轻量，是一个 demo 型 endpoint。

---

## 5.2 鉴权逻辑

`route.ts` 中：

```ts
const session = await auth();

if (!session?.user || session.user.type === "guest") {
  return new ChatbotError("unauthorized:agent").toResponse();
}
```

说明：

- 必须登录
- guest 用户也不允许使用 `/agent`

这和主聊天不一样。主聊天一般允许更广泛的使用方式，而 `/agent` 更像一个只对正式用户开放的高级 demo。

---

## 5.3 模型能力限制

代码会先读：

```ts
const capabilities = getModelCapabilities();

if (!capabilities.tools) {
  return Response.json(..., { status: 400 });
}
```

意思是：

- `/agent` 必须依赖工具调用能力
- 如果当前 provider 根本不支持 tools
- 那整个 `/agent` demo 就不能运行

这很合理，因为当前 Agent 的价值几乎全部建立在 document tools 之上。

---

## 5.4 构造 Agent

```ts
const agent = createArtifactAgent({
  modelId: resolveChatModel(requestBody.selectedModel),
  session,
});
```

这里通过 `lib/agent/agent.ts` 统一创建 ToolLoopAgent。

---

## 5.5 返回 UI 流

最终调用：

```ts
return await createAgentUIStreamResponse({
  abortSignal: request.signal,
  agent,
  uiMessages: sanitizeAgentUIMessages(requestBody.messages),
});
```

这说明 `/agent` 不是走普通 `streamText -> createUIMessageStreamResponse` 的套路，而是：

- 直接使用 AI SDK 提供的 agent UI stream response 能力
- 把 `ToolLoopAgent` 和 UI messages 直接对接起来

这也是 `/agent` 和主聊天最大的不一样之一：

### 主聊天
是“chat route 编排器”模式：

- 手工拼 system prompt
- 手工注册 tools
- 手工 merge UI stream
- 手工持久化消息

### `/agent`
是“Agent 抽象”模式：

- 先构造 `ToolLoopAgent`
- 再让 SDK 帮你跑 agent loop 和 UI stream

---

## 6. Agent 核心：`lib/agent/agent.ts`

这个文件定义了 `/agent` 实际用到的 agent。

### 6.1 `createNoopDataStream()`

```ts
function createNoopDataStream(): UIMessageStreamWriter<ChatMessage> {
  return {
    merge(_stream) {},
    onError: undefined,
    write(_part) {},
  };
}
```

这个函数看起来很重要，因为 document tools 本来是为主聊天那套 artifact streaming 体系设计的。

例如 `createDocument`、`updateDocument` 这些工具在主聊天里会往 `dataStream` 里写：

- `data-kind`
- `data-id`
- `data-title`
- `data-clear`
- `data-textDelta`
- `data-codeDelta`
- `data-sheetDelta`
- `data-finish`

但在 `/agent` 中，并没有使用主聊天的 `data-stream-provider` / `data-stream-handler` 那套 artifact 流式同步协议。

所以这里传了一个 noop data stream，作用是：

> 让这些通用 document tools 能继续复用，但它们写出来的 artifact delta 被静默吞掉，不走主聊天的 artifact streaming 渲染链路。

这意味着 `/agent` 对 document tools 的复用方式是：

- 复用工具执行能力和数据库保存能力
- 不复用工具的前端实时 artifact delta 渲染能力

这是当前设计的一个关键点。

---

### 6.2 `createArtifactAgent()`

```ts
return new ToolLoopAgent({
  model: getLanguageModel(modelId),
  instructions: agentArtifactsPrompt,
  stopWhen: stepCountIs(4),
  tools: {
    createDocument,
    editDocument,
    updateDocument,
  },
});
```

这个 agent 的特点非常明确：

#### 模型
- 使用当前选中的语言模型

#### instructions
- 使用 `agentArtifactsPrompt`

#### step 限制
- 最多执行 4 个 step
- 防止 agent 无限循环调用工具

#### tools
只开放 3 个工具：

- `createDocument`
- `editDocument`
- `updateDocument`

并没有开放：

- `requestSuggestions`
- 聊天主链路里的其他可能工具
- 浏览器类工具
- RAG / 搜索类工具

说明当前 `/agent` 的目标非常聚焦，就是围绕 artifact 文档操作。

---

## 7. Agent Prompt：`lib/agent/prompts.ts`

这个 prompt 很值得单独讲，因为它几乎定义了 `/agent` 的产品行为。

### 7.1 角色定义

开头就写得很清楚：

> You are the /agent document assistant.

也就是说它不是一个通用 agent，而是一个 document assistant。

---

### 7.2 核心工具规则

prompt 中规定：

1. 一次响应最多只能用一个工具
2. 工具调用后必须停止继续调用工具，并给一个简短确认消息
3. 工具调用后不要把完整 artifact 内容贴回聊天区

这三条非常关键：

- 控制 agent 行为稳定性
- 防止多工具链路把 demo 搞复杂
- 避免聊天区被大段文档淹没
- 把“内容主体”留在右侧 artifact 面板

---

### 7.3 create / edit / update 的选择规则

prompt 明确区分了三类工具的使用时机：

#### `createDocument`
用于：
- write / draft / create / build / generate / produce substantial artifact

并且明确 kind 选择：
- `code`：脚本、实现、算法、编程请求
- `text`： prose / report / notes / plans / docs
- `sheet`：表格、CSV、dataset

#### `editDocument`
用于：
- 精确局部修改
- 必须知道 document id
- 必须知道 exact old text

#### `updateDocument`
用于：
- 高层次、大范围改写
- 已知 artifact id
- 但没有足够安全的 exact replacement text

这使得 `/agent` 在工具选择上比普通聊天 route 更“规范化”。

---

### 7.4 什么时候不用工具

prompt 也给了明确边界：

- 只是解释问题
- 普通问答
- 请求太模糊
- 需求很小，适合直接聊天回答

这意味着 `/agent` 不会强制每条消息都调用工具。

它仍然允许纯文本回答。

---

## 8. 消息清洗：`lib/agent/sanitize-ui-messages.ts`

这个文件的作用是：

> 在消息再次发给 agent 前，移除不该继续参与上下文的遗留 tool part。

当前主要清理：

```ts
part.type === "tool-planTask"
```

这说明项目里曾经有或预留过一个 `planTask` 工具，但当前 `/agent` 主链路并没有启用它。

清洗规则是：

1. 遍历 message parts
2. 过滤掉 `tool-planTask`
3. 如果 assistant 消息过滤后已经空了，则整条 assistant 消息丢弃

### 为什么要这么做？

主要是为了避免：

- 历史遗留工具结果污染后续上下文
- 把无意义的 tool part 再发给 agent
- 导致模型混淆当前对话状态

### 这透露出的信号

这份代码说明 `/agent` 模块有过演进：

- 可能以前接过 `planTask`
- 后来主链路只保留 document tools
- 但为了兼容已有消息结构，保留了 sanitize 逻辑

---

## 9. 类型定义：`lib/agent/types.ts`

这个文件的作用是给 `/agent` UI 和工具部分提供静态类型支撑。

### 9.1 `AgentTools`

它声明了 agent 会返回的工具类型集合：

- `createDocument`
- `editDocument`
- `updateDocument`

### 9.2 `AgentMessage`

```ts
export type AgentMessage = UIMessage<unknown, never, AgentTools>;
```

意思是：

- metadata 不强调具体结构，用 `unknown`
- 自定义 data part 这里不用，所以是 `never`
- tool 部分则严格绑定到 `AgentTools`

这和主聊天 `ChatMessage` 不一样。

主聊天消息还带有各种自定义 data part，而 `/agent` 更依赖 tool part 自身来表达状态。

### 9.3 tool part 提取类型

文件中还定义了：

- `CreateDocumentToolPart`
- `EditDocumentToolPart`
- `UpdateDocumentToolPart`
- `AgentArtifactToolPart`

这些类型直接服务于前端渲染逻辑，例如 `agent-demo.tsx` 里会根据不同 tool part 决定如何展示工具卡片。

---

## 10. 一个未接入主链路的工具：`lib/agent/tools/plan-task.ts`

这个文件定义了 `createPlanTaskTool()`。

它的能力是：

- 根据一个 goal
- 拆成短计划
- 输出：
  - `goal`
  - `summary`
  - `steps`
  - `firstAction`

内部逻辑主要是：

- 标准化 goal
- 用 `then / after that / next / . ;` 做简单分段
- 生成 3 步式计划

### 但它目前的状态是：

- 文件存在
- sanitize 逻辑也知道它
- 但 `createArtifactAgent()` 没有把它注册到 tools 里

因此当前可以认为：

> `plan-task.ts` 是一个未接入生产链路的预留/实验工具。

它对理解当前 `/agent` 有价值，因为能看出模块曾经或将来有“先规划再执行”的演进方向。

---

## 11. 前端主界面：`components/agent/agent-demo.tsx`

这是 `/agent` 的核心前端文件。

可以把它拆成 6 个部分理解。

---

## 11.1 输入与 transport

组件中先创建了一个 `DefaultChatTransport`：

```ts
new DefaultChatTransport({
  api: "/api/agent",
  fetch: (request, init) => fetchWithErrorHandlers(request, init, "agent"),
  prepareSendMessagesRequest(request) {
    return {
      body: {
        messages: sanitizeAgentUIMessages(request.messages),
        selectedModel: selectedModelRef.current,
        ...request.body,
      },
    };
  },
})
```

这说明 `/agent` 的前端消息发送过程会做两件事：

1. 发送前再次清洗消息
2. 把当前模型 id 一起发给服务端

然后：

```ts
const { messages, sendMessage, status, stop } = useChat<AgentMessage>({...})
```

说明 `/agent` 的前端对话体验依然建立在 `useChat()` 之上。

---

## 11.2 聊天区

消息显示使用的是 `components/ai-elements/*` 这套更偏“原语”的聊天 UI 组件：

- `Conversation`
- `Message`
- `PromptInput`
- `Tool`
- `Shimmer`

这与主聊天页大量使用 `components/chat/*` 业务组件不同。

说明 `/agent` 更像一个实验/演示页面，采用了较轻量、较独立的 UI 装配方式。

---

## 11.3 消息渲染逻辑

`AgentMessageItem` 会遍历每条消息的 `parts`。

### 如果是 `text`
就用：

- `MessageContent`
- `MessageResponse`

渲染普通文本。

### 如果是 tool part
仅处理三类：

- `tool-createDocument`
- `tool-editDocument`
- `tool-updateDocument`

然后：

1. 用 `AgentToolPart` 显示工具卡片
2. 如果工具结果可解析出 artifact 信息
3. 再额外显示一个 `DocumentPreview`

这使得用户在对话区能同时看到：

- 工具调用输入/输出
- 简要 artifact 结果卡片

---

## 11.4 工具结果解析

这里有两个关键函数：

### `getResolvedArtifactOutput()`
负责从 tool part 中提取：

- `id`
- `kind`
- `title`
- `toolCallId`

前提是：

- `state === "output-available"`
- 没有 error
- `output` 中有 `id/title/kind`

### `findLatestArtifactOutput()`
会从最新消息开始，倒序查找最后一个可用 artifact 工具结果。

作用是：

> 在消息变化后，自动找到“最近一次成功创建/编辑/更新的 artifact”。

---

## 11.5 自动打开右侧 Artifact 面板

`AgentDemo` 里有一个很关键的 `useEffect`：

- 当 messages 更新时
- 找到最新 artifact output
- 如果它不是刚刚已经打开过的同一条 tool call
- 就调用 `setArtifact()` 更新全局 artifact 状态

具体会设置：

- `documentId`
- `isVisible: true`
- `kind`
- `status: "idle"`
- `title`

这意味着 `/agent` 复用了主聊天的 `useArtifact` 全局状态，而不是自己重新造一套 artifact store。

所以它和主聊天之间有一个很重要的共享点：

> Artifact 的“查看/编辑状态容器”是共用的。

只是 `/agent` 不使用主聊天的 artifact 流式数据协议，而是通过工具最终结果直接切换当前 artifact。

---

## 11.6 输入区与 stop

输入区使用 `PromptInput` 套件。

行为很简单：

- 输入内容 trim 后发消息
- 清空输入框
- 忙碌时按钮变成 stop
- `PromptInputSubmit` 的 `onStop={stop}`

这里 stop 作用于 `useChat()` 当前请求。

和主聊天一样，它能中断本次生成，但 `/agent` 并没有做 resume stream 那套恢复逻辑。

---

## 12. 右侧面板：`components/agent/agent-artifact-panel.tsx`

这个文件非常关键，因为它解释了 `/agent` 为什么能“打开 artifact”，但行为又和主聊天不完全一样。

### 12.1 数据来源

它从 `useArtifact()` 读取当前 artifact 状态，再通过 SWR 请求：

```ts
/api/document?id=${artifact.documentId}
```

也就是说：

- `/agent` 打开 artifact 后，真正的内容不是从 tool part 里拿
- 而是重新从数据库文档接口拉最新版本

这很重要，因为工具本身只返回：

- id
- title
- kind
- 简要结果说明

真正的 document content 仍然靠 `/api/document` 获取。

---

### 12.2 初始化 metadata

如果 artifact definition 有 `initialize()`，它会调用：

```ts
artifactDefinition.initialize({ documentId, setMetadata })
```

因此：

- text artifact 的 suggestions 初始化逻辑在 `/agent` 面板里仍然可用
- code / sheet 的对应 metadata 初始化也可以沿用

这说明 `/agent` 面板是在尽量复用现有 artifact definition 能力。

---

### 12.3 编辑保存

当用户在面板中修改内容时：

- 会 debounce 2 秒
- 然后 `POST /api/document?id=...`
- body 里带上：
  - `content`
  - `isManualEdit: true`
  - `kind`
  - `title`

所以 `/agent` 面板并不只是展示，它实际上支持：

- 打开文档
- 直接编辑文档
- 自动保存新版本

---

### 12.4 和主聊天的 Artifact 面板差异

主聊天 `components/chat/artifact.tsx` 支持更多能力：

- 版本切换
- diff 模式
- toolbar 动作
- artifact actions
- streaming 自动滚动
- console error 透传

而 `/agent` 这个面板是精简版：

- 只展示当前最新文档
- 不做版本切换 UI
- 不展示主聊天 toolbar
- 更像一个轻量编辑面板

所以可以理解为：

> `/agent` 复用了 artifact definition 的内容组件，但用自己定制的壳子做了一个更简单的查看/编辑面板。

---

## 13. 模型选择器：`components/agent/agent-model-selector.tsx`

这个组件负责 `/agent` 的模型选择。

### 13.1 数据来源

通过：

```ts
/api/models
```

拿到：

- `models`
- `defaultModel`
- `capabilities`

### 13.2 初始值逻辑

优先级是：

1. `agent-model` cookie
2. `defaultModel.id`
3. 第一个 configured model

和主聊天的 `chat-model` cookie 分离，说明：

> `/agent` 和主聊天允许使用不同的模型偏好。

### 13.3 自定义模型

如果输入的 query 不在已配置模型中，会提供一个：

- `Use custom model: xxx`

说明 `/agent` 同样支持用户直接输入任意模型 id，只要后端 provider 能处理。

### 13.4 能力图标

它还会展示：

- tools
- vision
- reasoning

不过对 `/agent` 来说，最关键的其实是 tools，因为没有 tools 就不能运行。

---

## 14. 登录态标签：`components/agent/agent-session-label.tsx`

这个组件很简单：

- `useSession()` 读取登录状态
- loading 时显示 skeleton
- 有邮箱时显示 `Signed in as ...`

它只负责页面顶部的弱提示，不参与任何业务逻辑。

---

## 15. `/agent` 的完整请求链路

如果把整个 `/agent` 流程串起来，大致是这样：

```text
用户进入 /agent
  -> app/agent/page.tsx 渲染页面壳子
  -> AgentDemo 挂载
  -> AgentModelSelector 从 /api/models 拉模型配置

用户输入一条指令
  -> AgentDemo 调 useChat().sendMessage()
  -> DefaultChatTransport 请求 /api/agent
  -> 请求体里附带：
       - sanitize 后的 messages
       - selectedModel

服务端 /api/agent
  -> 校验 schema
  -> 校验登录且不是 guest
  -> 校验 provider 支持 tools
  -> createArtifactAgent()
  -> createAgentUIStreamResponse()
  -> ToolLoopAgent 运行
       - 可能直接文本回答
       - 也可能调用 createDocument / editDocument / updateDocument

如果工具被调用
  -> 工具保存/更新数据库里的 Document
  -> agent 响应里返回 tool part + output

前端收到新的 messages
  -> AgentMessageItem 渲染文本 + tool 卡片
  -> findLatestArtifactOutput() 找到最近成功的 artifact 工具输出
  -> setArtifact() 打开右侧面板
  -> AgentArtifactPanel 通过 /api/document 拉文档内容
  -> 用户在右侧面板继续编辑并自动保存
```

---

## 16. `/agent` 和主聊天模块的差异

这是理解项目结构时最容易混淆的地方。

| 维度 | 主聊天 | `/agent` |
|---|---|---|
| 页面入口 | `app/(chat)` | `app/agent/page.tsx` |
| 后端模式 | 手工编排 chat route | `ToolLoopAgent` |
| 核心接口 | `/api/chat` | `/api/agent` |
| 工具调用 | 主聊天 route 统一注册 | agent 内部注册 3 个 document tools |
| Artifact 展示 | 主聊天 artifact 面板 + data stream 协议 | 精简面板 + 通过 tool output 打开文档 |
| 持久化聊天历史 | 有 chat/message/vote/history 体系 | 当前更偏临时 demo 会话 |
| resume stream | 主聊天有预埋 | `/agent` 未接入 |
| 权限 | 聊天支持更广 | `/agent` 禁止 guest |

一句话总结：

> 主聊天是完整产品流，`/agent` 更像围绕 document tools 的独立实验/演示工作台。

---

## 17. 当前实现的几个关键设计选择

## 17.1 复用 document tools，但不用它们的 data stream

这是 `/agent` 最重要的架构选择。

它通过 `createNoopDataStream()`：

- 保留工具的数据库写入能力
- 保留工具的返回结构
- 放弃 artifact delta 的实时流式 UI 同步

这样做的好处：

- 复用成本低
- 不需要把主聊天 artifact streaming 协议整体搬进 `/agent`
- 架构更简单

代价是：

- 工具执行中的 artifact 生成细节不会边生成边显示在右侧
- 右侧主要依赖工具结束后再从 `/api/document` 拉内容

---

## 17.2 agent 被明确限制为“单工具、短确认”模式

prompt 中要求：

- 单次最多一个工具
- 工具后只给简短确认

这让 `/agent` 的行为更像：

- “工具助手”

而不是：

- “长链自治代理”

这种限制有利于控制 demo 体验和调试复杂度。

---

## 17.3 `/agent` 没有自己的消息持久化体系

当前看到的 `/agent` 代码里，没有像主聊天那样：

- saveChat
- saveMessages
- getHistory
- vote
- stream resume

这意味着：

- `/agent` 更偏 demo / 临时会话
- artifact 是落库的
- 但 agent 对话本身没有做完整 chat history 产品化

---

## 18. 当前实现的限制与注意点

## 18.1 只支持三种工具

目前只接：

- `createDocument`
- `editDocument`
- `updateDocument`

没有 suggestions、没有 plan-task、没有外部世界交互。

这使得它适合文档工作流，但不适合更通用的 agent 任务。

---

## 18.2 `image` 类型在 agent 类型里出现，但实际工具不创建 image

前端有：

```ts
kind: "text" | "code" | "image" | "sheet"
```

但当前 document tools 和服务端 handler 里，真正完整接入的还是：

- text
- code
- sheet

所以 `/agent` 前端类型层面兼容 image，但实际主链路并没有完整 image document 创建能力。

---

## 18.3 `plan-task.ts` 属于未使用代码

这类文件会给维护者一个信号：

- 项目在演进中
- 存在实验性或遗留方向

如果后续不打算启用，建议要么删除，要么在文档中明确标记为实验代码。

---

## 18.4 右侧面板是精简版，不支持完整版本管理体验

当前 `AgentArtifactPanel` 没有主聊天那么强的版本切换 / diff / toolbar 体系。

这意味着 `/agent` 更适合：

- 快速创建
- 打开查看
- 小范围继续修改

而不是深度版本审阅。

---

## 19. 适合怎么理解 `lib/agent/`

如果只看 `lib/agent/` 目录本身，可以把它理解成四层：

### 19.1 `agent.ts`
Agent 装配层
- 负责创建 ToolLoopAgent
- 决定使用哪些工具

### 19.2 `prompts.ts`
Agent 行为规则层
- 定义工具使用策略和产品边界

### 19.3 `types.ts`
类型层
- 给前端消息渲染和工具结果解析提供静态约束

### 19.4 `sanitize-ui-messages.ts`
上下文清洗层
- 防止不合适的 tool part 回流到 agent 上下文中

### 19.5 `tools/plan-task.ts`
实验/预留工具层
- 当前未接入主链路

---

## 20. 一句话总结每个文件的作用

### `app/agent/page.tsx`
`/agent` 页面壳子。

### `app/api/agent/route.ts`
Agent 后端入口，鉴权、能力校验、运行 ToolLoopAgent。

### `app/api/agent/schema.ts`
校验 `/api/agent` 请求体。

### `lib/agent/agent.ts`
构造只包含 document tools 的 `ToolLoopAgent`。

### `lib/agent/prompts.ts`
定义 `/agent` 的 system prompt 和工具使用规则。

### `lib/agent/sanitize-ui-messages.ts`
移除遗留 `tool-planTask` part，保证上下文干净。

### `lib/agent/types.ts`
定义 AgentMessage 和工具 part 类型。

### `lib/agent/tools/plan-task.ts`
一个目前未接入主链路的规划工具。

### `components/agent/agent-demo.tsx`
`/agent` 核心 UI，聊天、工具结果显示、自动打开 artifact。

### `components/agent/agent-artifact-panel.tsx`
Agent 右侧 artifact 查看/编辑面板。

### `components/agent/agent-model-selector.tsx`
Agent 的模型选择器，支持 cookie 和记忆、自定义模型。

### `components/agent/agent-session-label.tsx`
顶部登录态展示。

---

## 21. 最终总结

如果要用一句话概括你项目里的 `/agent` 模块：

> `/agent` 是一个基于 `ToolLoopAgent` 的文档工具代理演示页，它复用了项目现有的 document tools 与 artifact 体系，但采用了更轻量的 agent UI 和更简化的 artifact 展示逻辑，用来完成“创建/编辑/重写 Artifact”这一类任务。

如果再拆细一点，可以记住这 4 个核心点：

1. `/agent` 不是主聊天的别名，而是独立 demo 页面。
2. 它的核心能力不是普通对话，而是 document tool 调用。
3. 它复用了 artifact 存储和编辑能力，但没有复用主聊天的完整 artifact 流式链路。
4. 它当前更适合作为“文档代理实验台”，而不是完整产品化 agent 系统。

---

## 22. 相关阅读

建议继续结合这些文件阅读：

- `lib/ai/tools/create-document.ts`
- `lib/ai/tools/edit-document.ts`
- `lib/ai/tools/update-document.ts`
- `components/chat/artifact.tsx`
- `hooks/use-artifact.ts`
- `docs/artifacts/README.md`
- `docs/chat-route.md`

如果你愿意，我下一步可以继续帮你做两件事：

1. 再补一篇 `docs/agent-vs-chat.md`，专门比较 `/agent` 和主聊天两套架构差异
2. 直接继续帮你整理 `lib/agent/` 的重构建议，比如哪些是 demo 代码、哪些适合抽成通用层
