"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { deleteTrailingMessages } from "@/app/(chat)/actions";
import type { ChatMessage } from "@/lib/types";

export async function submitEditedMessage({
  message,
  text,
  sendMessage,
}: {
  message: ChatMessage;
  text: string;
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
}) {
  await deleteTrailingMessages({ id: message.id });

  await sendMessage({
    messageId: message.id,
    role: "user",
    parts: [{ type: "text", text }],
  });
}
