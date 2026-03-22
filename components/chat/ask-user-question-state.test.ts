import test from "node:test";
import assert from "node:assert/strict";
import type { ChatMessage } from "@/lib/types";
import {
  findLatestPendingAskUserQuestion,
  getAskUserQuestionCardState,
  hasPendingAskUserQuestion,
} from "./ask-user-question-state";

function createUserMessage(id: string, text: string): ChatMessage {
  return {
    id,
    metadata: { createdAt: new Date().toISOString() },
    parts: [{ type: "text", text }],
    role: "user",
  } as ChatMessage;
}

function createAskUserQuestionMessage(id: string): ChatMessage {
  return {
    id,
    metadata: { createdAt: new Date().toISOString() },
    parts: [
      {
        type: "tool-askUserQuestion",
        input: {
          options: [
            { description: "Use App Router", label: "Next.js", value: "nextjs" },
            { description: "Use nested routes", label: "Remix", value: "remix" },
          ],
          placeholder: "Describe your stack",
          question: "Which stack should we target?",
        },
        state: "input-available",
        toolCallId: `${id}-tool`,
      },
    ],
    role: "assistant",
  } as ChatMessage;
}

test("finds the latest unanswered ask-user-question card", () => {
  const messages = [
    createUserMessage("user-1", "Build the app"),
    createAskUserQuestionMessage("assistant-1"),
  ];

  assert.deepEqual(findLatestPendingAskUserQuestion(messages), {
    messageId: "assistant-1",
    toolCallId: "assistant-1-tool",
  });
  assert.equal(hasPendingAskUserQuestion(messages), true);
});

test("marks an ask-user-question card answered once a user reply exists after it", () => {
  const messages = [
    createUserMessage("user-1", "Build the app"),
    createAskUserQuestionMessage("assistant-1"),
    createUserMessage("user-2", "nextjs"),
    {
      id: "assistant-2",
      metadata: { createdAt: new Date().toISOString() },
      parts: [{ type: "text", text: "Thanks" }],
      role: "assistant",
    } as ChatMessage,
  ];

  assert.equal(findLatestPendingAskUserQuestion(messages), null);
  assert.equal(hasPendingAskUserQuestion(messages), false);

  assert.deepEqual(
    getAskUserQuestionCardState(messages, "assistant-1", "assistant-1-tool"),
    {
      answer: "nextjs",
      answerLabel: "Next.js",
      isPending: false,
      part: messages[1].parts[0],
    }
  );
});

test("keeps historical ask-user-question cards read-only when a newer one is pending", () => {
  const firstQuestion = createAskUserQuestionMessage("assistant-1");
  const secondQuestion = createAskUserQuestionMessage("assistant-3");
  const messages = [
    createUserMessage("user-1", "Build the app"),
    firstQuestion,
    createUserMessage("user-2", "remix"),
    {
      id: "assistant-2",
      metadata: { createdAt: new Date().toISOString() },
      parts: [{ type: "text", text: "Need one more detail." }],
      role: "assistant",
    } as ChatMessage,
    secondQuestion,
  ];

  assert.deepEqual(findLatestPendingAskUserQuestion(messages), {
    messageId: "assistant-3",
    toolCallId: "assistant-3-tool",
  });

  assert.deepEqual(
    getAskUserQuestionCardState(messages, "assistant-1", "assistant-1-tool"),
    {
      answer: "remix",
      answerLabel: "Remix",
      isPending: false,
      part: firstQuestion.parts[0],
    }
  );
});
