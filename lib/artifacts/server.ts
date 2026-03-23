import type { UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { codeDocumentHandler } from "@/artifacts/code/server";
import { htmlDocumentHandler } from "@/artifacts/html/server";
import { sheetDocumentHandler } from "@/artifacts/sheet/server";
import { textDocumentHandler } from "@/artifacts/text/server";
import type { ArtifactKind } from "@/components/chat/artifact";
import { saveDocument } from "../db/queries";
import type { Document } from "../db/schema";
import type { ChatMessage } from "../types";

// 这一层是 Artifact 服务端的统一注册表。
// 各 kind 自己只负责“如何生成/更新内容”，而保存 Document 版本、
// 暴露统一调用接口等共性逻辑都收敛在这里。
export type SaveDocumentProps = {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  userId: string;
};

export type CreateDocumentCallbackProps = {
  id: string;
  title: string;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  session: Session;
  modelId: string;
};

export type UpdateDocumentCallbackProps = {
  document: Document;
  description: string;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  session: Session;
  modelId: string;
};

export type DocumentHandler<T = ArtifactKind> = {
  kind: T;
  onCreateDocument: (args: CreateDocumentCallbackProps) => Promise<void>;
  onUpdateDocument: (args: UpdateDocumentCallbackProps) => Promise<void>;
};

export function createDocumentHandler<T extends ArtifactKind>(config: {
  kind: T;
  onCreateDocument: (params: CreateDocumentCallbackProps) => Promise<string>;
  onUpdateDocument: (params: UpdateDocumentCallbackProps) => Promise<string>;
}): DocumentHandler<T> {
  return {
    kind: config.kind,
    onCreateDocument: async (args: CreateDocumentCallbackProps) => {
      // 具体类型返回“最终完整内容”；版本落库由公共层统一完成。
      const draftContent = await config.onCreateDocument({
        id: args.id,
        title: args.title,
        dataStream: args.dataStream,
        session: args.session,
        modelId: args.modelId,
      });

      await saveDocument({
        id: args.id,
        title: args.title,
        content: draftContent,
        kind: config.kind,
        userId: args.session.user.id,
      });

      return;
    },
    onUpdateDocument: async (args: UpdateDocumentCallbackProps) => {
      // 更新也是同样模式：类型层负责生成新内容，公共层负责保存新版本。
      const draftContent = await config.onUpdateDocument({
        document: args.document,
        description: args.description,
        dataStream: args.dataStream,
        session: args.session,
        modelId: args.modelId,
      });

      await saveDocument({
        id: args.document.id,
        title: args.document.title,
        content: draftContent,
        kind: config.kind,
        userId: args.session.user.id,
      });

      return;
    },
  };
}

// 只有出现在这个注册表中的 kind，才能真正走完整的服务端 Artifact 链路。
export const documentHandlersByArtifactKind: DocumentHandler[] = [
  textDocumentHandler,
  codeDocumentHandler,
  htmlDocumentHandler,
  sheetDocumentHandler,
];

// 给工具输入 schema 复用的 kind 枚举。注意它代表的是“服务端可创建的 kind”，
// 不一定和前端 UI 已经定义的所有 ArtifactKind 完全一致。
export const artifactKinds = ["text", "code", "html", "sheet"] as const;
