import { assertResourceOwner, requireUser } from "@/app/(auth)/auth";
import { getSuggestionsByDocumentId } from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const documentId = searchParams.get("documentId");

    if (!documentId) {
      return new ChatbotError(
        "bad_request:api",
        "Parameter documentId is required."
      ).toResponse();
    }

    const user = await requireUser("suggestions");
    const suggestions = await getSuggestionsByDocumentId({
      documentId,
    });

    const [suggestion] = suggestions;

    if (!suggestion) {
      return Response.json([], { status: 200 });
    }

    assertResourceOwner(suggestion, user.id, {
      forbidden: "forbidden:suggestions",
    });

    return Response.json(suggestions, { status: 200 });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    throw error;
  }
}
