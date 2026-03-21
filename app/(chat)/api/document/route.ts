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
      const result = await updateDocumentContent({ id, content });
      return Response.json(result, { status: 200 });
    }

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
