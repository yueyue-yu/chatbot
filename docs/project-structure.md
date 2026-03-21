# 项目结构说明

本文档用于快速理解这个仓库的目录职责、主要入口，以及前后端的调用关系。

## 1. 总览

这是一个基于 `Next.js App Router` 的聊天应用，核心能力包括：

- 聊天会话与消息流式输出
- 登录与游客会话
- 文档/代码/表格/图片类 Artifact 生成与编辑
- PostgreSQL 持久化
- Redis 限流与流恢复辅助
- OpenAI 兼容接口模型接入

当前仓库的主干可以理解为四层：

1. `app/`
   负责页面、路由、Server Action、API Route
2. `components/` + `hooks/`
   负责聊天 UI、交互状态和客户端行为
3. `lib/`
   负责 AI provider、数据库、编辑器、工具、通用能力
4. `tests/`
   负责端到端测试和测试辅助

## 2. 顶层目录

```text
.
├── app/                    # App Router 页面、布局、API、Server Actions
├── artifacts/              # Artifact 类型注册与客户端/服务端适配
├── components/             # 业务组件与基础 UI 组件
├── docs/                   # 项目文档
├── hooks/                  # React hooks
├── lib/                    # 核心业务逻辑与基础设施
├── public/                 # 静态资源
├── tests/                  # Playwright E2E 与测试辅助
├── drizzle.config.ts       # Drizzle 配置
├── next.config.ts          # Next.js 配置
├── proxy.ts                # 请求拦截/鉴权入口
├── playwright.config.ts    # E2E 配置
└── README.md               # 项目概览与启动说明
```

开发时可以忽略这些运行产物或外部依赖目录：

- `.next/`
- `node_modules/`
- `playwright-report/`
- `test-results/`

## 3. app 目录

### 3.1 全局入口

- `app/layout.tsx`
  应用根布局，挂载主题、全局 provider、认证相关基础能力。
- `app/globals.css`
  全局样式入口。
- `app/favicon.ico`
  站点图标。

### 3.2 认证相关

```text
app/(auth)/
├── actions.ts
├── auth.config.ts
├── auth.ts
├── layout.tsx
├── login/page.tsx
├── register/page.tsx
└── api/auth/
    ├── [...nextauth]/route.ts
    └── guest/route.ts
```

职责说明：

- `auth.ts`
  NextAuth 的主配置与导出入口。
- `auth.config.ts`
  登录页、路由 base path 等认证基础配置。
- `actions.ts`
  登录/注册相关的 Server Action。
- `api/auth/guest/route.ts`
  游客登录入口。
- `login/page.tsx` / `register/page.tsx`
  登录和注册页面。

### 3.3 聊天主模块

```text
app/(chat)/
├── actions.ts
├── layout.tsx
├── page.tsx
├── chat/[id]/page.tsx
└── api/
    ├── chat/
    │   ├── route.ts
    │   ├── schema.ts
    │   └── [id]/stream/route.ts
    ├── document/route.ts
    ├── files/upload/route.ts
    ├── history/route.ts
    ├── messages/route.ts
    ├── models/route.ts
    ├── suggestions/route.ts
    └── vote/route.ts
```

关键文件：

- `layout.tsx`
  聊天页外层布局，挂载侧边栏、数据流 provider、Pyodide 资源。
- `page.tsx`
  新会话页。
- `chat/[id]/page.tsx`
  指定会话页。
- `actions.ts`
  聊天相关 Server Action，例如保存模型 cookie、更新可见性、裁剪消息。
- `api/chat/route.ts`
  最核心的聊天接口：鉴权、限流、模型调用、消息保存、工具调用都在这里串起来。
- `docs/chat-route.md`
  对 `app/(chat)/api/chat/route.ts` 的专项逻辑梳理，适合阅读聊天主流程时配合查看。
- `api/chat/schema.ts`
  聊天请求体校验。
- `api/models/route.ts`
  向前端暴露当前模型配置和能力开关。
- `api/messages/route.ts`
  拉取单个聊天会话的消息与权限信息。
- `api/history/route.ts`
  拉取侧边栏聊天历史。
- `api/document/route.ts`
  Artifact 文档读取/写入接口。
- `api/files/upload/route.ts`
  文件上传接口。
- `api/suggestions/route.ts`
  建议相关接口。
- `api/vote/route.ts`
  消息投票接口。
- `api/chat/[id]/stream/route.ts`
  流恢复相关接口。
  更详细的实现现状、链路分析和待补齐点见：`docs/resume-stream.md`

## 4. components 目录

### 4.1 业务组件：components/chat

这是聊天产品的 UI 主体，包含：

- 页面外壳
  - `shell.tsx`
  - `chat-header.tsx`
  - `app-sidebar.tsx`
  - `sidebar-history.tsx`
  - `sidebar-history-item.tsx`
  - `sidebar-user-nav.tsx`
- 消息与输入
  - `messages.tsx`
  - `message.tsx`
  - `message-editor.tsx`
  - `message-actions.tsx`
  - `message-reasoning.tsx`
  - `multimodal-input.tsx`
  - `preview-attachment.tsx`
  - `suggested-actions.tsx`
- Artifact 编辑器
  - `artifact.tsx`
  - `artifact-actions.tsx`
  - `artifact-messages.tsx`
  - `code-editor.tsx`
  - `text-editor.tsx`
  - `sheet-editor.tsx`
  - `image-editor.tsx`
  - `document.tsx`
  - `document-preview.tsx`
- 数据流与状态同步
  - `data-stream-provider.tsx`
  - `data-stream-handler.tsx`
  - `toast.tsx`
- 其他辅助
  - `visibility-selector.tsx`
  - `icons.tsx`
  - `slash-commands.tsx`

可以把 `components/chat/` 看成产品层 UI。

### 4.2 AI 相关通用组件：components/ai-elements

这层更偏“聊天/生成式 UI 原语”，例如：

- `message.tsx`
- `conversation.tsx`
- `prompt-input.tsx`
- `model-selector.tsx`
- `tool.tsx`
- `reasoning.tsx`
- `suggestion.tsx`

这些组件不是业务路由本身，而是可复用的 AI 交互组件。

### 4.3 基础组件：components/ui

这一层是通用 UI 基础设施，主要来自 `shadcn/ui` 风格封装，例如：

- `button.tsx`
- `dialog.tsx`
- `dropdown-menu.tsx`
- `popover.tsx`
- `sidebar.tsx`
- `command.tsx`
- `input.tsx`
- `textarea.tsx`

## 5. hooks 目录

主要是聊天页状态管理和交互逻辑：

- `use-active-chat.tsx`
  当前聊天会话的核心 hook，负责：
  - 当前 chatId
  - 消息列表
  - 模型选择
  - 可见性
  - `useChat()` 传输配置
- `use-chat-visibility.ts`
  聊天公开/私有状态管理。
- `use-artifact.ts`
  Artifact 面板状态管理。
- `use-auto-resume.ts`
  流式恢复逻辑。
- `use-messages.tsx`
  消息相关衍生逻辑。
- `use-scroll-to-bottom.tsx`
  消息滚动行为。
- `use-mobile.ts`
  移动端检测。

## 6. lib 目录

`lib/` 是项目的核心逻辑层。

### 6.1 AI 相关：lib/ai

```text
lib/ai/
├── entitlements.ts
├── models.mock.ts
├── models.test.ts
├── models.ts
├── prompts.ts
├── provider-config.ts
├── providers.ts
└── tools/
    ├── create-document.ts
    ├── edit-document.ts
    ├── request-suggestions.ts
    └── update-document.ts
```

职责说明：

- `provider-config.ts`
  当前模型服务配置来源，读取环境变量并产出默认模型与能力开关。
- `providers.ts`
  AI SDK provider 初始化入口。
- `models.ts`
  前后端共享的模型元数据类型。
- `prompts.ts`
  system prompt 和请求提示构造。
- `entitlements.ts`
  按用户类型限制可用额度。
- `tools/`
  工具调用实现。
- `models.mock.ts` / `models.test.ts`
  测试与 mock 模型支持。

### 6.2 数据库：lib/db

```text
lib/db/
├── migrate.ts
├── queries.ts
├── schema.ts
├── utils.ts
└── migrations/
```

- `schema.ts`
  Drizzle schema 定义。
- `queries.ts`
  数据访问层，所有聊天、用户、消息、文档、投票等查询都在这里。
- `migrate.ts`
  本地/构建阶段数据库迁移入口。
- `migrations/`
  已生成的 SQL 迁移文件。

### 6.3 Artifact 能力：lib/artifacts

- `server.ts`
  Artifact 类型在服务端的统一装配。

### 6.4 编辑器能力：lib/editor

- `config.ts`
- `functions.tsx`
- `react-renderer.tsx`
- `suggestions.tsx`
- `diff.js`

主要负责文档编辑、差异展示、建议渲染等编辑器能力。

### 6.5 其他公共能力

- `constants.ts`
  运行环境常量。
- `errors.ts`
  统一错误模型与消息映射。
- `ratelimit.ts`
  Redis 限流。
- `types.ts`
  共享类型定义。
- `utils.ts`
  通用工具函数。

## 7. artifacts 目录

这个目录定义各类 Artifact 的类型实现，是聊天主链路里“富文档对象”的实现层。

```text
artifacts/
├── actions.ts
├── code/
├── image/
├── sheet/
└── text/
```

这里最值得先知道的只有三件事：

1. `artifacts/*/client.tsx`
   定义该类型在前端如何展示、如何处理流式 delta、有哪些动作和工具栏。
2. `artifacts/*/server.ts`
   定义该类型在服务端如何创建和更新，并向前端发送什么 `data-*` 事件。
3. Artifact 系统并不只在这个目录里完成。
   真正的主链还会经过 `components/chat/artifact.tsx`、`components/chat/data-stream-handler.tsx`、`lib/artifacts/server.ts`、`lib/agent/tools/*`、`app/(chat)/api/document/route.ts`。

当前目录里的四种类型是：

- `text`
- `code`
- `sheet`
- `image`

如果你需要更细的内容，请继续读：

- [docs/artifacts.md](./artifacts.md)
  Artifact 的定位、核心契约、流式协议、版本语义、扩展清单、已知坑点。
- [docs/project-learning-path.md](./project-learning-path.md)
  面向维护者/二开者的读码路线、实战练习和概念对照表。

## 8. tests 目录

```text
tests/
├── e2e/
├── pages/
├── prompts/
├── fixtures.ts
└── helpers.ts
```

- `e2e/`
  Playwright 端到端测试。
- `pages/`
  Page Object 封装。
- `prompts/`
  Prompt 测试辅助。
- `fixtures.ts`
  测试上下文装配。
- `helpers.ts`
  通用测试工具。

## 9. 请求与数据流

### 9.1 一条聊天消息的主链路

1. 用户在 `components/chat/multimodal-input.tsx` 输入消息
2. `hooks/use-active-chat.tsx` 通过 `useChat()` 组装请求
3. 请求发送到 `app/(chat)/api/chat/route.ts`
4. 服务端完成：
   - 鉴权
   - 限流
   - 读取 chat/历史消息
   - 调用 `lib/ai/providers.ts`
   - 执行工具
   - 保存消息到 `lib/db/queries.ts`
5. 数据流通过 `data-stream-provider.tsx` / `data-stream-handler.tsx` 回到页面

### 9.2 模型配置链路

1. 环境变量在 `.env.local` 中配置
2. `lib/ai/provider-config.ts` 读取配置
3. `lib/ai/providers.ts` 创建 provider
4. `app/(chat)/api/models/route.ts` 向前端暴露默认模型和能力
5. `components/chat/multimodal-input.tsx` 负责模型选择 UI

### 9.3 可见性链路

1. `components/chat/visibility-selector.tsx` 触发切换
2. `hooks/use-chat-visibility.ts` 先更新本地状态
3. `app/(chat)/actions.ts` 持久化到数据库
4. 历史列表和当前聊天页同步展示

## 10. 新人阅读建议

如果你第一次接手这个项目，推荐按下面顺序阅读：

1. [README.md](/Users/z/Projects/chatbot/README.md)
2. [app/(chat)/api/chat/route.ts](/Users/z/Projects/chatbot/app/(chat)/api/chat/route.ts)
3. [hooks/use-active-chat.tsx](/Users/z/Projects/chatbot/hooks/use-active-chat.tsx)
4. [components/chat/shell.tsx](/Users/z/Projects/chatbot/components/chat/shell.tsx)
5. [components/chat/multimodal-input.tsx](/Users/z/Projects/chatbot/components/chat/multimodal-input.tsx)
6. [lib/ai/provider-config.ts](/Users/z/Projects/chatbot/lib/ai/provider-config.ts)
7. [lib/db/queries.ts](/Users/z/Projects/chatbot/lib/db/queries.ts)

读完这几处，基本就能理解：

- 请求从哪里发起
- 模型从哪里接入
- 消息如何落库
- 页面状态如何同步

## 11. 后续维护建议

- 新增 API 时，优先放到 `app/(chat)/api/` 下对应语义目录
- 新增数据库查询时，统一收敛到 `lib/db/queries.ts`
- 新增模型配置能力时，优先改 `lib/ai/provider-config.ts` 与 `lib/ai/providers.ts`
- 新增 UI 原子组件放 `components/ui/`
- 新增聊天业务组件放 `components/chat/`
- 新增通用 AI 交互组件放 `components/ai-elements/`

如果目录职责开始变得模糊，优先按“页面层 / 组件层 / 业务逻辑层 / 数据层”重新归位，而不是继续堆在同一层。
