import { canReadChat, requireUser } from "@/app/(auth)/auth";
import { getChatById, getMessagesByChatId } from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import { convertToUIMessages } from "@/lib/utils";

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

    const user = await requireUser("chat");
    const [chat, messages] = await Promise.all([
      getChatById({ id: chatId }),
      getMessagesByChatId({ id: chatId }),
    ]);

    if (!chat) {
      return Response.json({
        messages: [],
        visibility: "private",
        userId: null,
        isReadonly: false,
      });
    }

    if (!canReadChat(chat, user.id)) {
      return new ChatbotError("forbidden:chat").toResponse();
    }

    return Response.json({
      messages: convertToUIMessages(messages),
      visibility: chat.visibility,
      userId: chat.userId,
      isReadonly: chat.userId !== user.id,
    });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    throw error;
  }
}
