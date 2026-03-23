# 项目学习路径：从 Artifact 出发做二开

这份文档不是仓库目录手册，而是一条“上手维护和二开”的读码路线。

假设你的目标是：

- 搞清这个项目怎么跑
- 读懂 Artifact 子系统
- 能自己改一个现有 Artifact
- 能规划新增一种 Artifact

如果你还没看过仓库大图，先看 [project-structure.md](./project-structure.md)。
如果你想先把聊天页状态分层、`useContext` 与轻量 store 的边界弄清楚，先看 [chat-state-architecture.md](./chat-state-architecture.md)。
如果你想深入 Artifact 机制，再配合 [Artifact 文档索引](./artifacts/README.md) 一起看。

---

## 1. 项目地图：先把仓库分成 3 层

这个仓库可以先粗分成三层。

## 1.1 产品层

主要目录：

- `app/`
- `components/chat/`
- `hooks/`

这层回答的问题是：

- 页面从哪里进
- 聊天 UI 怎么组织
- 输入、消息、侧边栏、Artifact 面板怎么联动

如果你更关心“用户看到什么、交互怎么发生”，先多看这一层。

## 1.2 编排层

主要目录：

- `app/(chat)/api/chat/route.ts`
- `lib/agent/`
- `lib/artifacts/`

这层回答的问题是：

- 用户消息怎么送进 agent
- 模型什么时候调用 tool
- tool 又怎么把 Artifact 接到前后端

如果你更关心“请求怎么流起来”，重点在这一层。

## 1.3 基础设施层

主要目录：

- `lib/db/`
- `lib/ai/`
- `lib/editor/`

这层回答的问题是：

- 数据怎么存
- provider 怎么接
- 编辑器怎么实现
- suggestion / diff / schema 这些基础能力放哪

如果你准备做持续维护或大一点的二开，这层迟早要补课。

---

## 2. 一条 90 分钟的读码路线

下面是一条适合第一次真正进入这个项目的路线。不是唯一答案，但比较顺。

## 2.1 第 0-10 分钟：先看顶层说明

先读：

1. `README.md`
2. `docs/project-structure.md`

目标：

- 知道项目是 Next.js App Router 聊天应用
- 知道 Artifact 是仓库主能力之一
- 知道有哪些关键目录

不要在这个阶段就钻细节，先建立目录感。

## 2.2 第 10-30 分钟：看聊天主入口

接着读：

1. `app/(chat)/api/chat/route.ts`
2. `docs/chat-route.md`
3. `lib/agent/agent.ts`

目标：

- 知道聊天请求怎么进入后端
- 知道 agent 是怎么创建的
- 知道 Artifact tool 是怎么注册进去的

到了这一步，你应该知道：

- Artifact 不是前端局部功能
- 它是聊天主链路的一部分

## 2.3 第 30-55 分钟：看 Artifact 主链

接着读：

1. `components/chat/artifact.tsx`
2. `hooks/use-artifact.ts`
3. `components/chat/data-stream-handler.tsx`
4. `lib/types.ts`
5. `lib/artifacts/server.ts`

目标：

- 弄清面板状态存在什么地方
- 弄清 `data-*` 流事件是谁发、谁收
- 弄清 `DocumentHandler` 的服务端注册方式

这是最关键的一段，因为它把前后端真正连起来了。

## 2.4 第 55-75 分钟：挑一种具体类型深挖

推荐先看 `text`：

1. `artifacts/text/client.tsx`
2. `artifacts/text/server.ts`
3. `lib/agent/tools/request-suggestions.ts`
4. `artifacts/actions.ts`

为什么先看 `text`：

- 它能力最完整
- 同时涉及正文、suggestion、diff、metadata
- 看完它，再对比 `code` / `sheet` 会更容易

## 2.5 第 75-90 分钟：对比第二种类型并回到消息层

推荐接着看：

1. `artifacts/code/client.tsx`
2. `artifacts/code/server.ts`
3. `components/chat/message.tsx`
4. `components/chat/document-preview.tsx`

目标：

- 看出 `text` 和 `code` 的流式语义差异
- 理解 Artifact 为什么既出现在消息区，也出现在侧边面板

90 分钟结束时，你应该已经具备“能改现有 Artifact”的基础。

---

## 3. 三条必走链路

如果你打算维护这个项目，下面三条链路最好都亲手走一遍。

## 3.1 链路一：新建一个 Artifact

阅读顺序：

1. `app/(chat)/api/chat/route.ts`
2. `lib/agent/agent.ts`
3. `lib/agent/tools/create-document.ts`
4. `lib/artifacts/server.ts`
5. `artifacts/<kind>/server.ts`
6. `components/chat/data-stream-handler.tsx`
7. `artifacts/<kind>/client.tsx`
8. `components/chat/artifact.tsx`

你要回答的问题：

- tool 何时被调用
- `data-kind` / `data-id` / `data-title` / `data-clear` 是谁发的
- 类型专属 delta 是谁发的
- 面板何时显示、正文何时写入
- 最终哪里保存到数据库

## 3.2 链路二：修改一个已有 Artifact

这个“修改”其实分成三种不同路径。

### A. 让 agent 全量重写

看：

- `lib/agent/tools/update-document.ts`
- `artifacts/<kind>/server.ts`

关键点：

- 这是新版本
- 走 handler
- 会重新流式生成完整内容

### B. 让 agent 精确替换

看：

- `lib/agent/tools/edit-document.ts`

关键点：

- 这是新版本
- 不走模型生成
- 直接做字符串替换后保存

### C. 在编辑器里手工改

看：

- `components/chat/artifact.tsx`
- `app/(chat)/api/document/route.ts`
- `lib/db/queries.ts`

关键点：

- 这是原地更新最新版本
- 不新增版本

这三条路径读懂以后，版本语义就不会混淆。

## 3.3 链路三：打开历史版本

阅读顺序：

1. `lib/db/schema.ts`
2. `lib/db/queries.ts`
3. `components/chat/artifact.tsx`
4. `components/chat/version-footer.tsx`
5. `components/chat/diffview.tsx`

你要回答的问题：

- 同一文档的版本靠什么区分
- 历史版本是怎么查询出来的
- `diff` 模式看的到底是哪两份内容
- 删除某个时间点之后的版本会删掉什么

---

## 4. 三个实战练习

下面的练习适合“刚读完源码，想开始动手”的阶段。

## 4.1 练习一：给现有 Artifact 新增一个 toolbar 动作

推荐目标：

- 给 `text` 或 `sheet` 再加一个快捷消息按钮

建议阅读：

- `components/chat/create-artifact.tsx`
- `artifacts/text/client.tsx`
- `artifacts/sheet/client.tsx`
- `components/chat/toolbar.tsx`

你会学到：

- toolbar 本质上是 `sendMessage()` 的快捷入口
- 它不是直接改内容，而是引导模型继续工作

## 4.2 练习二：给现有 Artifact 增加 metadata

推荐目标：

- 模仿 `text.suggestions` 或 `code.outputs`
- 给某种 Artifact 增加一份只属于它的前端派生状态

建议阅读：

- `hooks/use-artifact.ts`
- `components/chat/create-artifact.tsx`
- `artifacts/text/client.tsx`
- `artifacts/code/client.tsx`

你会学到：

- metadata 如何按 `documentId` 分桶
- `initialize()` 和 `onStreamPart()` 分别适合做什么

## 4.3 练习三：设计一个新 Artifact 的接入方案

推荐目标：

- 不急着写代码，先设计 `diagram` / `slides` / `html` 这样的新 kind

建议对照：

- [05-extension-guide.md](./artifacts/05-extension-guide.md) 里的“新增一种 Artifact 时，真实需要改哪些地方”
- `lib/types.ts`
- `lib/artifacts/server.ts`
- `app/(chat)/api/document/route.ts`
- `components/chat/document-preview.tsx`

你会学到：

- 新类型接入为什么不是“加一个文件夹”这么简单
- 哪些地方看似边角，实际上会在运行时卡住

---

## 5. 二开时最值得先记住的几个事实

下面这些事实不是抽象概念，而是改代码时很快会碰到的。

## 5.1 Artifact 是跨层能力

不要把它当成：

- 一个前端组件
- 一个数据库表
- 一个 tool

它横跨：

- 聊天路由
- agent tools
- 服务端 handler
- 流式协议
- 面板宿主
- 数据库版本化

## 5.2 `text` 和 `code/sheet` 的流式思路不同

现状：

- `text` 走追加流
- `code` / `sheet` 走整稿流

你写新类型时，先想清楚你要哪一种。

## 5.3 手工保存和 agent 修改不是同一种版本语义

现状：

- agent create / update / edit 新增版本
- 编辑器手工保存原地改最新版本

这个点会直接影响你怎么设计审计、回滚和 diff。

## 5.4 `image` 是现成的反例样本

它很好地说明了：

- 前端已注册
- 数据库已允许
- 不等于后端链路完整

如果你想快速看“一个半接通的新类型是什么样”，直接研究 `image` 很有帮助。

---

## 6. 概念对照表

| 名词 | 它是什么 | 常见来源 | 容易混淆成什么 |
| --- | --- | --- | --- |
| `chatId` | 一次聊天会话 ID | URL / `useActiveChat` | `documentId` |
| `message.id` | 一条聊天消息的 ID | `useChat()` / DB message | `documentId` |
| `documentId` | 一个 Artifact 的稳定文档 ID | `createDocument` | 版本 ID |
| tool part | assistant 消息里的工具调用/结果片段 | `message.parts` | 真实文档记录 |
| stream delta | `data-*` UI 流事件 | `dataStream.write()` | DB 更新 |
| document version | 同一 `documentId` 下某个 `createdAt` 的记录 | `Document` 表 | `documentId` 本身 |

如果你在调试时感觉“怎么有三个 ID 都像同一个东西”，优先回来看这张表。

---

## 7. 一个实用的读码策略

如果你准备连续几天都在这个仓库里工作，推荐用下面的节奏。

第一天：

- 读 `README.md`
- 读 `docs/project-structure.md`
- 读 `docs/chat-route.md`
- 跑通聊天主入口

第二天：

- 读 `docs/artifacts/README.md`
- 跟着 Artifact 主链看源码
- 选 `text` 深挖

第三天：

- 看 `code` / `sheet`
- 做一个小改动，例如加 toolbar 或 metadata

第四天：

- 设计一个新 kind 的接入清单
- 把需要动的文件列出来
- 再开始实现

这种节奏比“一口气从头翻到尾”更容易形成稳定理解。

---

## 8. 读到什么程度算“学会了”

你不需要一开始就把每个文件都背下来。

能做到下面这些，基本就算真正入门了：

1. 能从聊天请求一路讲到 Artifact 如何出现在侧边面板
2. 能解释 create / update / edit / manual edit 的版本差异
3. 能说出新增一个 kind 至少要检查哪些接入点
4. 能独立给现有 Artifact 增加一个小能力

如果你已经能做到这四点，后面的工作主要就从“理解系统”变成“按系统约束改它”了。
