import { z } from "zod";
import { assertResourceOwner, requireUser } from "@/app/(auth)/auth";
import { getChatById, getVotesByChatId, voteMessage } from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";

const voteSchema = z.object({
  chatId: z.string(),
  messageId: z.string(),
  type: z.enum(["up", "down"]),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get("chatId");

    if (!chatId) {
      return new ChatbotError(
        "bad_request:api",
        "Parameter chatId is required."
      ).toResponse();
    }

    const user = await requireUser("vote");
    const chat = await getChatById({ id: chatId });

    assertResourceOwner(chat, user.id, {
      forbidden: "forbidden:vote",
      notFound: "not_found:chat",
    });

    const votes = await getVotesByChatId({ id: chatId });

    return Response.json(votes, { status: 200 });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    throw error;
  }
}

export async function PATCH(request: Request) {
  try {
    const parsed = voteSchema.parse(await request.json());
    const user = await requireUser("vote");
    const chat = await getChatById({ id: parsed.chatId });

    assertResourceOwner(chat, user.id, {
      forbidden: "forbidden:vote",
      notFound: "not_found:vote",
    });

    await voteMessage({
      chatId: parsed.chatId,
      messageId: parsed.messageId,
      type: parsed.type,
    });

    return new Response("Message voted", { status: 200 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return new ChatbotError(
        "bad_request:api",
        "Parameters chatId, messageId, and type are required."
      ).toResponse();
    }

    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    throw error;
  }
}
