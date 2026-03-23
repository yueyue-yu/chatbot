# 新增一种 Artifact 的改造清单

这一章专门给维护者用，回答一个非常实际的问题：

> 如果我要新增一种 Artifact，到底要改哪些文件？

---

## 1. 先决定你要的是哪一类 Artifact

新增前先判断目标属于哪种模式。

### 1.1 仅前端可渲染类型

特点：

- 面板知道怎么显示
- 可能能从已有数据打开
- 但模型不一定能主动创建它

更接近当前仓库里的：

- `image`

### 1.2 完整主链类型

特点：

- 前端能显示
- 模型能创建/更新
- 服务端有 handler
- 能写 `data-*` 流
- 能落库形成版本链

更接近当前仓库里的：

- `text`
- `code`
- `html`
- `sheet`

如果你要的是一个真正可被模型操作的新 Artifact，大多数情况下应该走第 2 类。

---

## 2. 最小改造面

完整新增一种 Artifact，通常至少涉及下面这些位置。

### 2.1 类型定义与前端注册

- 新建 `artifacts/<kind>/client.tsx`
- 在 `components/chat/artifact.tsx` 中注册到 `artifactDefinitions`

目的：

- 让前端知道这种 kind 的内容组件、actions、toolbar、stream 处理方式

### 2.2 流事件类型

- 修改 `lib/types.ts`

目的：

- 把新的 `data-xxx` 事件加入 `CustomUIDataTypes`

如果不改这里，类型系统不会承认你的新事件。

### 2.3 服务端生成实现

- 新建 `artifacts/<kind>/server.ts`
- 在 `lib/artifacts/server.ts` 中注册 handler

目的：

- 让服务端知道如何创建 / 更新这种文档

### 2.4 工具入口

- `lib/agent/tools/create-document.ts`
- 可能还包括 `update-document.ts` / `edit-document.ts`

目的：

- 让模型真的有机会选择这种 kind

### 2.5 持久化入口

- `app/(chat)/api/document/route.ts`

目的：

- 确保 `kind` 校验允许该类型

---

## 3. 推荐的实施顺序

### 第一步：先做前端类型定义

新建：

```txt
artifacts/<kind>/client.tsx
```

至少要提供：

- `kind`
- `description`
- `content`
- `actions`
- `toolbar`
- `initialize`
- `onStreamPart`

然后注册到：

```ts
artifactDefinitions
```

### 第二步：定义流事件

如果这种 Artifact 需要自己的正文增量事件，新增：

- `data-<kind>Delta`

并同步更新：

- `lib/types.ts`

### 第三步：补服务端 handler

新建：

```txt
artifacts/<kind>/server.ts
```

然后在：

```ts
documentHandlersByArtifactKind
```

中注册。

### 第四步：把 kind 暴露给 create tool

更新：

- `artifactKinds`
- `create-document.ts` 的描述与 schema

这样模型才可能真正创建它。

### 第五步：确认持久化层允许这个 kind

更新：

- `/api/document` 的 kind 校验

---

## 4. 一种新 Artifact 至少要回答的 6 个问题

新增前请先把这 6 个问题答出来：

### 4.1 它的正文是怎么流式更新的

是：

- 文本追加
- 整体替换
- 结构化 JSON
- 二进制/URL

### 4.2 它的 metadata 是什么

例如：

- `text` 有 suggestions
- `code` 有 console outputs
- `html` 有当前 view

### 4.3 它在 streaming 中何时自动打开

是否：

- 立即打开
- 内容达到一定长度再打开
- 始终手动打开

### 4.4 它是否支持历史版本浏览

大多数完整 Artifact 都支持，但展示方式可能不同：

- 文本 diff
- 代码 diff
- 表格版本切换

### 4.5 用户手工编辑后，如何保存

是否：

- 原地改写当前最新版本
- 或者每次都生成新版本

当前主面板默认倾向前者。

### 4.6 模型该在什么场景下选择它

你需要让 tool 描述足够清楚，例如：

- 什么类型的问题应该走这个 kind
- 它和已有 kind 的边界是什么

---

## 5. 一个完整改造清单

下面是一份更贴近实战的 checklist。

### 5.1 客户端

- 新建 `artifacts/<kind>/client.tsx`
- 在 `components/chat/artifact.tsx` 注册到 `artifactDefinitions`
- 如果需要专属编辑器，新建或复用内容组件
- 视需要补 `toolbar` / `actions`

### 5.2 流协议

- 在 `lib/types.ts` 增加新的 `CustomUIDataTypes`
- 在服务端写出对应 `data-*`
- 在客户端 `onStreamPart()` 消费这些事件

### 5.3 服务端

- 新建 `artifacts/<kind>/server.ts`
- 在 `lib/artifacts/server.ts` 注册 handler
- 确保 `create-document` / `update-document` / `edit-document` 能走到它

### 5.4 路由与数据库

- 在 `/api/document` 的 schema 中允许该 kind
- 确认 `saveDocument()` / 查询逻辑对它没有特殊阻碍

### 5.5 文档与测试

- 更新 Artifact 文档索引
- 更新 extension guide 中的类型列表
- 如果仓库已有相关测试，补上最小覆盖

---

## 6. 一个非常常见的漏改点

很多人会只改：

- `artifacts/<kind>/client.tsx`
- `artifactDefinitions`

结果面板能渲染，但模型始终创建不出来。

原因往往是漏了服务端三件套：

- `artifactKinds`
- `documentHandlersByArtifactKind`
- `create-document` 的 schema / 描述

所以要记住：

> “前端会显示”只代表面板认识它，不代表整条 Artifact 主链已经接通。

---

## 7. 如果只想做一个前端展示型 Artifact

如果你的目标不是让模型创建，而只是想让前端能展示某种特殊文档类型，可以只做：

- `artifacts/<kind>/client.tsx`
- `artifactDefinitions`
- `api/document` kind 校验
- 必要的 UI 打开入口

这类模式更轻，但也要接受它的限制：

- 模型不能通过标准 create tool 直接产出它
- 服务端可能没有对应 handler

---

## 8. 推荐的验收标准

一个完整新 Artifact 至少应该满足：

1. 面板能正确打开
2. streaming 时能实时显示内容
3. 生成结束后能从 `/api/document` 读回版本
4. 手工编辑能保存
5. 版本切换逻辑正常
6. 模型能在正确场景选择该 kind

如果缺其中任何一项，都说明它还没有真正融入 Artifact 主链。
