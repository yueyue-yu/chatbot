import { z } from "zod";
import { assertResourceOwner, requireUser } from "@/app/(auth)/auth";
import type { ArtifactKind } from "@/components/chat/artifact";
import {
  deleteDocumentsByIdAfterTimestamp,
  getDocumentsById,
  saveDocument,
  updateDocumentContent,
} from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";

// 这个路由服务的是 Artifact 文档本身，而不是聊天消息：
// - GET: 拉某个 documentId 的所有版本
// - POST: 新增一个版本，或对最新版本做“原地手工编辑”
// - DELETE: 删除某个时间点之后的版本
const documentSchema = z.object({
  content: z.string(),
  title: z.string(),
  kind: z.enum(["text", "code", "image", "sheet", "html"]),
  isManualEdit: z.boolean().optional(),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return new ChatbotError(
        "bad_request:api",
        "Parameter id is missing"
      ).toResponse();
    }

    const user = await requireUser("document");
    const documents = await getDocumentsById({ id });
    const [document] = documents;

    // documentId 级别的权限校验只需要验证其中任意一个版本的归属即可。
    assertResourceOwner(document, user.id, {
      forbidden: "forbidden:document",
      notFound: "not_found:document",
    });

    return Response.json(documents, { status: 200 });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return new ChatbotError(
        "bad_request:api",
        "Parameter id is required."
      ).toResponse();
    }

    const user = await requireUser("document");

    let content: string;
    let title: string;
    let kind: ArtifactKind;
    let isManualEdit: boolean | undefined;

    try {
      const parsed = documentSchema.parse(await request.json());
      content = parsed.content;
      title = parsed.title;
      kind = parsed.kind;
      isManualEdit = parsed.isManualEdit;
    } catch {
      return new ChatbotError(
        "bad_request:api",
        "Invalid request body."
      ).toResponse();
    }

    const documents = await getDocumentsById({ id });
    const [document] = documents;

    if (document) {
      assertResourceOwner(document, user.id, {
        forbidden: "forbidden:document",
      });
    }

    if (isManualEdit && document) {
      // 手工编辑走“更新当前版本内容”语义，不新增一个新的历史版本。
      const result = await updateDocumentContent({ id, content });
      return Response.json(result, { status: 200 });
    }

    // 普通保存走“新增版本”语义。
    const savedDocument = await saveDocument({
      id,
      content,
      title,
      kind,
      userId: user.id,
    });

    return Response.json(savedDocument, { status: 200 });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    throw error;
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const timestamp = searchParams.get("timestamp");

    if (!id) {
      return new ChatbotError(
        "bad_request:api",
        "Parameter id is required."
      ).toResponse();
    }

    if (!timestamp) {
      return new ChatbotError(
        "bad_request:api",
        "Parameter timestamp is required."
      ).toResponse();
    }

    const user = await requireUser("document");
    const [document] = await getDocumentsById({ id });

    assertResourceOwner(document, user.id, {
      forbidden: "forbidden:document",
      notFound: "not_found:document",
    });

    const parsedTimestamp = new Date(timestamp);

    if (Number.isNaN(parsedTimestamp.getTime())) {
      return new ChatbotError(
        "bad_request:api",
        "Invalid timestamp."
      ).toResponse();
    }

    // 这里的删除语义是“删除某个版本时间点之后的所有版本”，
    // 供 Artifact 版本回退/裁剪场景使用。
    const documentsDeleted = await deleteDocumentsByIdAfterTimestamp({
      id,
      timestamp: parsedTimestamp,
    });

    return Response.json(documentsDeleted, { status: 200 });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    throw error;
  }
}
