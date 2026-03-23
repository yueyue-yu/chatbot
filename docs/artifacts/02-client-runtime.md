# Artifact 客户端状态与面板运行时

这一章关注前端主链：

- 当前打开哪个 Artifact
- 面板为什么知道该显示什么
- 编辑、版本切换、移动端展开这些交互是怎么组织的

---

## 1. 客户端最核心的三个文件

### 1.1 `hooks/use-artifact.ts`

职责：

- 保存当前激活中的 `UIArtifact`
- 保存与当前文档绑定的 metadata

### 1.2 `components/chat/create-artifact.tsx`

职责：

- 定义“注册一种 Artifact 类型”所需的统一契约

### 1.3 `components/chat/artifact.tsx`

职责：

- 真正承载右侧面板 UI
- 根据当前 `kind` 选择内容组件
- 拉版本、切版本、保存手工编辑

这三个文件组合起来，基本构成了 Artifact 前端骨架。

---

## 2. `useArtifact()` 存的到底是什么

`hooks/use-artifact.ts` 暴露两层状态：

### 2.1 主状态：`artifact`

它来自 SWR key：

```ts
"artifact"
```

代表：

- 当前面板打开的是谁
- 文档标题是什么
- 当前正文缓存是什么
- 当前是否可见
- 当前是在 `streaming` 还是 `idle`

注意：

- 这不是数据库里的 `Document`
- 也不是聊天消息
- 它只是“面板当前 UI 运行时状态”

### 2.2 附加状态：`metadata`

它来自另一个按 `documentId` 分区的 key：

```ts
artifact-metadata-${artifact.documentId}
```

用于存各 kind 自己的附加运行时数据，例如：

- `text` 的 suggestions
- `code` 的 console outputs
- `html` 的当前视图 `source | preview`

这个拆分很关键，因为 metadata 的结构是类型专属的，不适合混在统一 `UIArtifact` 里。

---

## 3. `initialArtifactData` 为什么重要

默认状态中最重要的字段是：

- `documentId: "init"`
- `isVisible: false`
- `status: "idle"`

其中 `documentId = "init"` 是一个哨兵值，表示：

> 当前还没有真正打开任何 Artifact。

主面板和文档预览卡片都会依赖它来判断：

- 现在是不是空态
- 需不需要触发初始化逻辑
- 要不要请求 `/api/document`

---

## 4. `create-artifact.tsx` 为什么不是普通 UI 文件

这个文件定义的不是单个组件，而是一套类型注册契约。

每一种 Artifact 本质上都是：

```ts
new Artifact({
  kind,
  description,
  content,
  actions,
  toolbar,
  initialize,
  onStreamPart,
})
```

各字段职责：

- `kind`
  - 类型标识
- `description`
  - 给模型和 UI 使用的文字说明
- `content`
  - 面板主体渲染器
- `actions`
  - 面板右侧操作按钮
- `toolbar`
  - 面板底部悬浮工具栏动作
- `initialize`
  - 打开已有文档时的初始化逻辑
- `onStreamPart`
  - 消费类型专属 `data-*` 事件

这套设计让所有 kind 都能复用一套宿主面板，而不是每种类型重新写一套侧栏壳子。

---

## 5. `artifact.tsx` 的真实角色

`components/chat/artifact.tsx` 不是单纯的渲染层，它同时承担了多种职责。

### 5.1 注册表出口

它定义了：

- `artifactDefinitions`
- `ArtifactKind`
- `UIArtifact`

这意味着它既是面板宿主，也是前端 Artifact 类型系统的公共出口。

### 5.2 文档版本读取

只有在以下条件同时满足时才请求：

- `artifact.documentId !== "init"`
- `artifact.status !== "streaming"`

原因是：

- 还没打开文档时不该请求
- 正在 streaming 时应该优先显示实时内容，而不是被数据库版本回流覆盖

### 5.3 最新版本对齐

拿到 `documents` 后，组件会：

- 默认选中最后一个版本
- 更新 `document`
- 更新 `currentVersionIndex`
- 在没有本地脏内容时，把最新版本正文写回 `artifact.content`

所以这里实际上在做两件事：

- 维护“版本链视图”
- 维护“当前面板正文缓存”

---

## 6. 手工编辑保存是怎么做的

Artifact 面板的正文编辑并不是直接每次敲字都发请求。

主面板内部有两层逻辑：

### 6.1 `saveContent(updatedContent, debounce)`

职责：

- 标记 `isContentDirty`
- 记录最新正文到 `latestContentRef`
- 按需去抖

### 6.2 `handleContentChange(updatedContent)`

职责：

- 调 `POST /api/document?id=...`
- 使用 `isManualEdit: true`
- 通过 SWR mutate 只更新本地最新版本内容

这里的关键语义是：

> 手工编辑默认是“改写当前最新版本”，不是再追加一条新历史版本。

因此它和 AI 工具产生新版本的语义不一样。

---

## 7. 版本切换是怎么组织的

面板内部维护：

- `mode: "edit" | "diff"`
- `currentVersionIndex`

统一通过：

```ts
handleVersionChange("next" | "prev" | "toggle" | "latest")
```

来切换。

这带来两个好处：

- 版本控制逻辑集中，不散在按钮组件里
- `ArtifactActions` 和 `VersionFooter` 都可以复用同一套切换入口

其中：

- 当前最新版本：可编辑、可继续触发工具栏动作
- 历史版本：只用于查看与 diff 对比

所以工具栏只会在 `isCurrentVersion` 时显示。

---

## 8. 自动滚动与用户滚动是怎么兼容的

流式生成时，正文默认会自动滚到底部。

但如果用户主动向上滚动，就会把：

```ts
userScrolledArtifact.current = true
```

这时自动滚动会停止。

它解决的是一个典型体验问题：

- 如果始终强制滚到底部，用户没法查看前面的内容
- 如果从不自动滚动，生成长内容时用户又看不到最新部分

当前实现是一个中间策略：

- 默认跟随
- 用户一旦介入，就尊重用户滚动位置

---

## 9. HTML Artifact 为什么有特殊逻辑

HTML 类型有一个额外元数据：

- `view: "source" | "preview"`

但在 streaming 时，主面板会强制把它切回 `source`。

原因很实际：

- streaming 中的 HTML 往往还是半成品
- 此时预览 iframe 很容易展示出结构不完整页面

所以当前策略是：

- 生成过程中只看源码
- 生成完成后再允许切换预览

---

## 10. 移动端和桌面端为什么分两套外壳

主面板最后分成两种渲染方式：

### 10.1 桌面端

- 作为固定右侧面板展示
- 宽度随聊天主区联动

### 10.2 移动端

- 从消息卡片触发位置展开为全屏层
- 使用 `artifact.boundingBox` 作为动画起点

这也是 `UIArtifact` 里为什么会有：

- `boundingBox.top`
- `boundingBox.left`
- `boundingBox.width`
- `boundingBox.height`

这些字段看起来像布局数据，但实际是给移动端展开动画用的。

---

## 11. 文档预览卡片和主面板的关系

`components/chat/document-preview.tsx` 并不持有独立状态，而是复用：

- `useArtifact()`

它点击后会：

- 把当前文档信息写入 `artifact`
- 设置 `boundingBox`
- 决定主面板从哪里展开

所以预览卡片不是“另一个 Artifact 系统”，而是主 Artifact 面板的入口之一。

---

## 12. 客户端维护时最常见的问题

### 12.1 改了 `artifacts/*/client.tsx`，但面板没反应

先检查：

- 是否已加入 `artifactDefinitions`
- `kind` 是否匹配
- `onStreamPart` 是否处理了正确的 `data-*`

### 12.2 streaming 内容总被旧版本覆盖

先检查：

- 面板是否在 `artifact.status === "streaming"` 时还去请求 `/api/document`
- 是否把数据库回流内容不小心写回了 `artifact.content`

### 12.3 metadata 串到了别的文档

先检查：

- 是否按 `artifact.documentId` 做 metadata key 分区
- `initialize()` 是否在切换文档时正确重置了 metadata
