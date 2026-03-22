import type { ChatMessage } from "@/lib/types";
import { getTextFromMessage } from "@/lib/utils";

type AskUserQuestionPart = Extract<
  ChatMessage["parts"][number],
  { type: "tool-askUserQuestion" }
>;

type AskUserQuestionOption = {
  label: string;
  value?: string;
  description?: string;
};

type PendingAskUserQuestion = {
  messageId: string;
  toolCallId: string;
};

export function getAskUserQuestionPart(
  message: ChatMessage,
  toolCallId?: string
): AskUserQuestionPart | null {
  for (const part of message.parts) {
    if (part.type !== "tool-askUserQuestion") {
      continue;
    }

    if (!toolCallId || part.toolCallId === toolCallId) {
      return part;
    }
  }

  return null;
}

export function getAskUserQuestionAnswer(
  messages: ChatMessage[],
  messageId: string,
  toolCallId: string
) {
  const messageIndex = messages.findIndex(
    (message) => message.id === messageId && getAskUserQuestionPart(message, toolCallId)
  );

  if (messageIndex === -1) {
    return null;
  }

  for (let index = messageIndex + 1; index < messages.length; index++) {
    const candidate = messages[index];

    if (candidate.role !== "user") {
      continue;
    }

    const text = getTextFromMessage(candidate).trim();

    return text.length > 0 ? text : null;
  }

  return null;
}

export function getAskUserQuestionAnswerLabel(
  part: AskUserQuestionPart,
  answer: string | null
) {
  const questionInput = part.input;
  const options = (questionInput?.options ?? []) as AskUserQuestionOption[];

  if (!answer || !questionInput) {
    return null;
  }

  const matchedOption = options.find(
    (option) => option.value === answer || option.label === answer
  );

  return matchedOption?.label ?? answer;
}

export function findLatestPendingAskUserQuestion(
  messages: ChatMessage[]
): PendingAskUserQuestion | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];

    if (message.role !== "assistant") {
      continue;
    }

    const part = getAskUserQuestionPart(message);

    if (!part) {
      continue;
    }

    const answer = getAskUserQuestionAnswer(messages, message.id, part.toolCallId);

    if (!answer) {
      return {
        messageId: message.id,
        toolCallId: part.toolCallId,
      };
    }
  }

  return null;
}

export function hasPendingAskUserQuestion(messages: ChatMessage[]) {
  return findLatestPendingAskUserQuestion(messages) !== null;
}

export function getAskUserQuestionCardState(
  messages: ChatMessage[],
  messageId: string,
  toolCallId: string
) {
  const message = messages.find((candidate) => candidate.id === messageId);
  const part = message ? getAskUserQuestionPart(message, toolCallId) : null;
  const answer = getAskUserQuestionAnswer(messages, messageId, toolCallId);
  const latestPending = findLatestPendingAskUserQuestion(messages);

  return {
    answer,
    answerLabel: part ? getAskUserQuestionAnswerLabel(part, answer) : answer,
    isPending:
      latestPending?.messageId === messageId &&
      latestPending.toolCallId === toolCallId,
    part,
  };
}
