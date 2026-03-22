import test from "node:test";
import assert from "node:assert/strict";
import type { ChatMessage } from "@/lib/types";
import {
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

function createAnsweredAskUserQuestionMessage(
  id: string,
  answer: { answer: string; label: string; source: "option" | "other" }
): ChatMessage {
  const message = createAskUserQuestionMessage(id);

  return {
    ...message,
    parts: [
      {
        ...message.parts[0],
        output: answer,
        state: "output-available",
      },
    ],
  } as ChatMessage;
}

test("finds the latest unanswered ask-user-question card", () => {
  const messages = [
    createUserMessage("user-1", "Build the app"),
    createAskUserQuestionMessage("assistant-1"),
  ];

  assert.equal(hasPendingAskUserQuestion(messages), true);
});

test("marks an ask-user-question card answered once the tool output is available", () => {
  const answeredQuestion = createAnsweredAskUserQuestionMessage("assistant-1", {
    answer: "nextjs",
    label: "Next.js",
    source: "option",
  });

  const messages = [
    createUserMessage("user-1", "Build the app"),
    answeredQuestion,
    {
      id: "assistant-2",
      metadata: { createdAt: new Date().toISOString() },
      parts: [{ type: "text", text: "Thanks" }],
      role: "assistant",
    } as ChatMessage,
  ];

  assert.equal(hasPendingAskUserQuestion(messages), false);

  assert.deepEqual(
    getAskUserQuestionCardState(messages, "assistant-1", "assistant-1-tool"),
    {
      answer: "nextjs",
      answerLabel: "Next.js",
      isPending: false,
      part: answeredQuestion.parts[0],
    }
  );
});

test("keeps historical ask-user-question cards read-only when a newer one is pending", () => {
  const firstQuestion = createAnsweredAskUserQuestionMessage("assistant-1", {
    answer: "remix",
    label: "Remix",
    source: "option",
  });
  const secondQuestion = createAskUserQuestionMessage("assistant-3");
  const messages = [
    createUserMessage("user-1", "Build the app"),
    firstQuestion,
    {
      id: "assistant-2",
      metadata: { createdAt: new Date().toISOString() },
      parts: [{ type: "text", text: "Need one more detail." }],
      role: "assistant",
    } as ChatMessage,
    secondQuestion,
  ];

  assert.equal(hasPendingAskUserQuestion(messages), true);

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
