import type { NextRequest } from "next/server";
import { requireUser } from "@/app/(auth)/auth";
import { deleteAllChatsByUserId, getChatsByUserId } from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    const limit = Math.min(
      Math.max(Number.parseInt(searchParams.get("limit") || "10", 10), 1),
      50
    );
    const startingAfter = searchParams.get("starting_after");
    const endingBefore = searchParams.get("ending_before");

    if (startingAfter && endingBefore) {
      return new ChatbotError(
        "bad_request:api",
        "Only one of starting_after or ending_before can be provided."
      ).toResponse();
    }

    const user = await requireUser("chat");
    const chats = await getChatsByUserId({
      id: user.id,
      limit,
      startingAfter,
      endingBefore,
    });

    return Response.json(chats);
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    throw error;
  }
}

export async function DELETE() {
  try {
    const user = await requireUser("chat");
    const result = await deleteAllChatsByUserId({ userId: user.id });

    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    throw error;
  }
}
