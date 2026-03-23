import type { VisibilityType } from "@/components/chat/visibility-selector";
import type { ChatMessage } from "@/lib/types";

type UserChatMessage = ChatMessage & { role: "user" };

export type ChatRequestBody =
  | {
      id: string;
      message: UserChatMessage;
      searchEnabled: boolean;
      selectedChatModel: string;
      selectedVisibilityType: VisibilityType;
    }
  | {
      id: string;
      searchEnabled: boolean;
      toolMessage: {
        id: string;
        role: "assistant";
        parts: ChatMessage["parts"];
      };
      selectedChatModel: string;
      selectedVisibilityType: VisibilityType;
    };

export function isResolvedAskUserQuestionMessage(
  message: ChatMessage | undefined
) {
  return (
    message?.role === "assistant" &&
    message.parts.some(
      (part) =>
        part.type === "tool-askUserQuestion" &&
        part.state === "output-available"
    ) &&
    !message.parts.some(
      (part) =>
        part.type === "tool-askUserQuestion" && part.state === "input-available"
    )
  );
}

export function buildChatRequestBody({
  chatId,
  messages,
  searchEnabled,
  selectedChatModel,
  selectedVisibilityType,
}: {
  chatId: string;
  messages: ChatMessage[];
  searchEnabled: boolean;
  selectedChatModel: string;
  selectedVisibilityType: VisibilityType;
}): ChatRequestBody {
  const lastMessage = messages.at(-1);

  if (!lastMessage) {
    throw new Error("Chat submissions require at least one message.");
  }

  if (lastMessage.role === "user") {
    return {
      id: chatId,
      message: lastMessage as UserChatMessage,
      searchEnabled,
      selectedChatModel,
      selectedVisibilityType,
    };
  }

  if (isResolvedAskUserQuestionMessage(lastMessage)) {
    return {
      id: chatId,
      searchEnabled,
      selectedChatModel,
      selectedVisibilityType,
      toolMessage: {
        id: lastMessage.id,
        parts: lastMessage.parts,
        role: "assistant",
      },
    };
  }

  throw new Error(
    "Chat submissions must end with a user message or a resolved askUserQuestion tool."
  );
}
