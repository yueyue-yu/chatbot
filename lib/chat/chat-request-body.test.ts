import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessage } from "@/lib/types";
import {
  buildChatRequestBody,
  type ChatRequestBody,
  isResolvedAskUserQuestionMessage,
} from "./chat-request-body";

function createUserMessage(id: string, text: string): ChatMessage {
  return {
    id,
    metadata: { createdAt: new Date().toISOString() },
    parts: [{ type: "text", text }],
    role: "user",
  } as ChatMessage;
}

function createResolvedAskUserQuestionMessage(): ChatMessage {
  return {
    id: "assistant-1",
    metadata: { createdAt: new Date().toISOString() },
    parts: [
      {
        type: "tool-askUserQuestion",
        input: {
          options: [
            { label: "Next.js", value: "nextjs" },
            { label: "Remix", value: "remix" },
          ],
          question: "Which stack should we target?",
        },
        output: {
          answer: "nextjs",
          label: "Next.js",
          source: "option",
        },
        state: "output-available",
        toolCallId: "tool-1",
      },
    ],
    role: "assistant",
  } as ChatMessage;
}

function getUserMessageBody(body: ChatRequestBody) {
  if (!("message" in body)) {
    throw new Error("Expected a user-message request body.");
  }

  return body as Extract<ChatRequestBody, { message: unknown }>;
}

function getToolMessageBody(body: ChatRequestBody) {
  if (!("toolMessage" in body)) {
    throw new Error("Expected a tool-message request body.");
  }

  return body as Extract<ChatRequestBody, { toolMessage: unknown }>;
}

test("builds a user-message request body when the last message is from the user", () => {
  const body = buildChatRequestBody({
    chatId: "chat-1",
    messages: [createUserMessage("user-1", "Build the app")],
    searchEnabled: true,
    selectedChatModel: "model-1",
    selectedVisibilityType: "private",
  });

  assert.equal(body.id, "chat-1");
  assert.equal(body.searchEnabled, true);
  const userBody = getUserMessageBody(body);
  assert.equal(userBody.message.role, "user");
  assert.equal(userBody.message.parts[0]?.type, "text");
});

test("builds a tool-message request body when askUserQuestion has a client result", () => {
  const assistantMessage = createResolvedAskUserQuestionMessage();
  const body = buildChatRequestBody({
    chatId: "chat-1",
    messages: [createUserMessage("user-1", "Build the app"), assistantMessage],
    searchEnabled: false,
    selectedChatModel: "model-1",
    selectedVisibilityType: "private",
  });

  assert.equal(body.searchEnabled, false);
  const toolBody = getToolMessageBody(body);
  assert.equal(toolBody.toolMessage.id, assistantMessage.id);
  assert.equal(toolBody.toolMessage.role, "assistant");
});

test("detects when the last assistant message is a resolved ask-user-question", () => {
  assert.equal(
    isResolvedAskUserQuestionMessage(createResolvedAskUserQuestionMessage()),
    true
  );
  assert.equal(isResolvedAskUserQuestionMessage(undefined), false);
});
