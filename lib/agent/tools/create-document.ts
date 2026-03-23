import { tool, type UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import {
  artifactKinds,
  documentHandlersByArtifactKind,
} from "@/lib/artifacts/server";
import type { ChatMessage } from "@/lib/types";
import { generateUUID } from "@/lib/utils";

type CreateDocumentProps = {
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  modelId: string;
};

// createDocument 是 Artifact 主链路的起点之一：
// - 给模型暴露“创建一个新文档/代码/表格/HTML Artifact”的工具
// - 先通过 data-* 事件把前端右侧面板切到对应 Artifact
// - 再委托服务端 handler 生成并保存真正的文档内容
export const createDocument = ({
  session,
  dataStream,
  modelId,
}: CreateDocumentProps) =>
  tool({
    description:
      "Create an artifact. You MUST specify kind: use 'code' for any programming/algorithm request (creates a script), 'text' for essays/writing (creates a document), 'sheet' for spreadsheets/data, and 'html' for self-contained HTML pages or web demos.",
    inputSchema: z.object({
      title: z.string().describe("The title of the artifact"),
      kind: z
        .enum(artifactKinds)
        .describe(
          "REQUIRED. 'code' for programming/algorithms, 'text' for essays/writing, 'sheet' for spreadsheets, 'html' for self-contained HTML pages"
        ),
    }),
    execute: async ({ title, kind }) => {
      const id = generateUUID();

      // 这几条 data-* 事件先把前端面板切到“正在生成某个新 Artifact”的状态。
      dataStream.write({
        type: "data-kind",
        data: kind,
        transient: true,
      });

      dataStream.write({
        type: "data-id",
        data: id,
        transient: true,
      });

      dataStream.write({
        type: "data-title",
        data: title,
        transient: true,
      });

      dataStream.write({
        type: "data-clear",
        data: null,
        transient: true,
      });

      // 再从服务端注册表中找到对应 kind 的内容生成器。
      const documentHandler = documentHandlersByArtifactKind.find(
        (documentHandlerByArtifactKind) =>
          documentHandlerByArtifactKind.kind === kind
      );

      if (!documentHandler) {
        throw new Error(`No document handler found for kind: ${kind}`);
      }

      await documentHandler.onCreateDocument({
        id,
        title,
        dataStream,
        session,
        modelId,
      });

      // 内容生成与落库完成后，用 finish 把前端 Artifact 状态从 streaming 收尾到 idle。
      dataStream.write({ type: "data-finish", data: null, transient: true });

      return {
        id,
        title,
        kind,
        content:
          kind === "code"
            ? "A script was created and is now visible to the user."
            : kind === "html"
              ? "An HTML page was created and is now visible to the user."
              : "A document was created and is now visible to the user.",
      };
    },
  });
